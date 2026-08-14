/* POST /api/commet/assinatura  { condominioId }
   Cria (ou reaproveita) o plano e o cliente no Commet e abre uma ASSINATURA
   recorrente da licença SaaS do condomínio — devolve { checkoutUrl }.
   A confirmação chega depois pelo webhook (subscription.activated). */
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const supabase = createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

/* o SDK ora devolve { success, data, error }, ora o objeto direto — normaliza */
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.COMMET_API_KEY || process.env.COMMET_API_KEY.startsWith("COLE_AQUI"))
    return res.status(503).json({ error: "COMMET_API_KEY não configurada no .env do servidor." });

  /* ── Trava de moeda: a licença SaaS é cobrada SEMPRE em dólar (USD). ──
     A moeda nunca é parametrizável pelo cliente; se o .env estiver com outra
     moeda, o handler recusa antes de tocar no Commet. */
  const moedaEnv = (envVal("COMMET_CURRENCY") || "usd").toLowerCase();
  if (moedaEnv !== "usd")
    return res.status(503).json({ error: `COMMET_CURRENCY deve ser "usd" — a licença é cobrada sempre em dólar (valor atual: "${moedaEnv}").` });

  try {
    const corpo = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { condominioId, ciclo, troca } = corpo;
    /* código de ativação (ex.: PAGOMANUAL) — promo code de uma Offer criada no
       dashboard do Commet (100% de desconto, forever). Validação em duas etapas:
       o código é conferido AQUI contra COMMET_CODIGO_ATIVACAO (recusa cedo, sem
       abrir checkout) e, depois do create, a resposta do Commet precisa provar
       que o desconto foi aplicado — senão a assinatura é desfeita na hora. */
    const codigoAtivacao = String(corpo.codigo || "").trim().toUpperCase();
    const codigoEsperado = (envVal("COMMET_CODIGO_ATIVACAO") || "PAGOMANUAL").toUpperCase();
    if (codigoAtivacao && codigoAtivacao !== codigoEsperado)
      return res.status(400).json({ error: "Código de ativação inválido." });
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });
    /* moeda vinda do corpo é ignorada por definição — e recusada se divergir */
    const moedaPedida = String(corpo.currency || corpo.moeda || "").toLowerCase();
    if (moedaPedida && moedaPedida !== "usd")
      return res.status(400).json({ error: "A moeda da licença não é parametrizável: a cobrança é sempre em dólar (USD)." });

    const CAMPOS_ASS = "id, status, teste_fim, teste_estendido, condominios(id, nome_fantasia, cnpj), saas_planos(id, nome, preco_mensal, preco_anual)";
    let { data: ass, error } = await supabase
      .from("saas_assinaturas")
      .select(CAMPOS_ASS)
      .eq("condominio_id", condominioId)
      .neq("status", "cancelada")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass) {
      /* licença cancelada querendo voltar: "cancelada" é terminal para os
         webhooks (todos os updates usam .neq status cancelada), então a linha
         precisa ser ressuscitada ANTES do checkout — senão a confirmação do
         pagamento nunca gravaria. Volta para "teste" (com o teste_fim antigo,
         já consumido → o checkout sai com skipTrial e cobra direto). */
      const { data: cancelada, error: eCanc } = await supabase
        .from("saas_assinaturas")
        .select(CAMPOS_ASS)
        .eq("condominio_id", condominioId)
        .eq("status", "cancelada")
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (eCanc) throw new Error(eCanc.message);
      if (!cancelada) return res.status(404).json({ error: "Condomínio sem assinatura cadastrada." });
      const { error: eRev } = await supabase
        .from("saas_assinaturas")
        .update({ status: "teste", cancelamento_agendado_em: null, acesso_ate: null, bloqueada_em: null })
        .eq("id", cancelada.id);
      if (eRev) throw new Error(eRev.message);
      ass = { ...cancelada, status: "teste" };
    }
    /* troca de plano (upgrade/downgrade): permite abrir um novo checkout mesmo
       com a licença ativa — a nova assinatura substitui a anterior */
    if (ass.status === "ativa" && !troca) return res.status(409).json({ error: "A licença deste condomínio já está ativa." });
    /* teste gratuito de 30 dias: só na PRIMEIRA assinatura do condomínio —
       quem já iniciou um teste (teste_fim preenchido) paga direto; troca idem */
    const elegivelTeste = ass.status === "teste" && !ass.teste_fim && !troca;

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    const plano = ass.saas_planos;
    /* cobrança sempre em dólar (USD): a conta Commet deve estar configurada em USD.
       O sufixo _usd separa estes planos dos antigos criados com preço em real. */
    const codigo = `condomaster_${slug(plano.nome)}_usd`;
    /* o nome também precisa ser único: já existe um "CondoMaster <plano>" antigo (em BRL)
       na Commet, e ela recusa dois planos com o mesmo nome */
    const nomeCommet = `CondoMaster ${plano.nome} (USD)`;
    const anual = ciclo === "anual" && Number(plano.preco_anual) > 0;
    const intervalo = anual ? "yearly" : "monthly";

    /* plano no Commet: reaproveita pelo code ou pelo nome; cria com os preços mensal e anual se não existir */
    const planos = dado(await commet.plans.list({ includePrivate: true })) || [];
    let planoCommet = planos.find((p) => p.code === codigo || p.name === nomeCommet);
    /* plano reaproveitado: garante que continua sendo um plano em dólar puro —
       o preço-base do Commet é USD por construção (moeda da conta); só recusa
       se a API devolver moeda explícita ≠ usd ou se houver preços por mercado
       em moeda local (marketPrices/regionalPrices), que permitiriam checkout
       fora do dólar */
    if (planoCommet) {
      const precoErrado = (planoCommet.prices || []).find((pr) =>
        (pr.currency && String(pr.currency).toLowerCase() !== "usd") ||
        (pr.marketPrices || pr.regionalPrices || []).some((m) => String(m.currency).toLowerCase() !== "usd"));
      if (precoErrado)
        return res.status(502).json({ error: `O plano ${codigo} no Commet não está em dólar puro (USD) — corrija ou remova o plano no painel do Commet.` });
      /* planos criados antes do teste gratuito não têm trial configurado —
         corrige o preço no Commet (o trial só vale quando skipTrial não é enviado) */
      for (const pr of planoCommet.prices || []) {
        if (pr.trialDays !== 30)
          await commet.plans.updatePrice({ id: planoCommet.id, priceId: pr.id, trialDays: 30 });
      }
    }
    if (!planoCommet) {
      planoCommet = dado(await commet.plans.create({ name: nomeCommet, code: codigo, isPublic: false }));
      if (!planoCommet?.id) return res.status(502).json({ error: "Commet não criou o plano." });
      await commet.plans.addPrice({
        id: planoCommet.id,
        billingInterval: "monthly",
        price: Math.round(Number(plano.preco_mensal) * 100), // centavos de dólar
        trialDays: 30, // teste gratuito — aplicado só quando a assinatura não envia skipTrial
        isDefault: true,
      });
      if (Number(plano.preco_anual) > 0) {
        await commet.plans.addPrice({
          id: planoCommet.id,
          billingInterval: "yearly",
          price: Math.round(Number(plano.preco_anual) * 100), // centavos de dólar
          trialDays: 30,
        });
      }
    }

    /* cliente no Commet: 1 por condomínio, identificado pelo externalId */
    const cond = ass.condominios;
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("email, pessoas!inner(condominio_id)")
      .eq("pessoas.condominio_id", condominioId)
      .limit(1)
      .maybeSingle();

    let cliente = dado(await commet.customers.get({ id: condominioId }).catch(() => null));
    if (!cliente?.id) {
      cliente = dado(await commet.customers.create({
        externalId: condominioId,
        fullName: cond.nome_fantasia,
        taxDocument: cond.cnpj || undefined,
        email: usuario?.email || `licenca+${condominioId.slice(0, 8)}@condomaster.app`,
        metadata: { condominioId },
      }));
    }
    if (!cliente?.id) return res.status(502).json({ error: "Commet não criou o cliente." });

    const origem = req.headers.origin || `https://${req.headers.host}`;

    /* upgrade/downgrade com assinatura ativa: troca o plano DA ASSINATURA
       EXISTENTE no Commet (changePlan faz o rateio e substitui a anterior
       automaticamente — sem cobrança dupla e sem precisar cancelar à mão) */
    if (troca) {
      const ativa = dado(await commet.subscriptions.getActive({ customerId: cliente.id }).catch(() => null));
      /* changePlan durante o trial CONVERTE o teste e cobra na hora — bloqueia */
      if (ativa?.status === "trialing")
        return res.status(409).json({ error: "A troca de plano durante o teste gratuito é cobrada imediatamente — aguarde o fim do teste para trocar." });
      if (ativa?.id) {
        const respTroca = await commet.subscriptions.changePlan({
          id: ativa.id, newPlanId: planoCommet.id, newBillingInterval: intervalo,
          successUrl: `${origem}/?licenca=ok`,
        });
        if (respTroca?.error) return res.status(502).json({ error: `Commet: ${respTroca.error.message || respTroca.error}` });
        const mudanca = dado(respTroca);
        /* upgrade normalmente exige checkout da diferença; downgrade é agendado
           para o fim do período já pago — sem checkout */
        return res.status(200).json({
          checkoutUrl: mudanca?.checkoutUrl || null,
          trocaAplicada: !mudanca?.requiresCheckout,
          agendadaPara: mudanca?.scheduledFor || null,
        });
      }
    }

    /* elegível ao teste: o checkout salva o cartão SEM cobrar e o trial de 30
       dias do preço se aplica; caso contrário skipTrial força a cobrança direta.
       Com código de ativação, o trial sai de cena (skipTrial) — a ativação vem
       do desconto de 100% da Offer, e o status segue governado pelos webhooks
       normais (activated/canceled/reactivated), gerenciáveis no dashboard. */
    const resposta = await commet.subscriptions.create({
      planId: planoCommet.id,
      customerId: cliente.id,
      billingInterval: intervalo,
      skipTrial: codigoAtivacao ? true : !elegivelTeste,
      ...(codigoAtivacao ? { promoCode: codigoAtivacao } : {}),
      name: `Licença CondoMaster · ${cond.nome_fantasia}`,
      successUrl: `${origem}/?licenca=ok`,
    });
    if (resposta?.error) {
      const msg = String(resposta.error.message || resposta.error);
      if (codigoAtivacao && /promo|offer|coupon|c(ó|o)digo|cupom/i.test(msg))
        return res.status(400).json({ error: "Código de ativação inválido ou expirado." });
      return res.status(502).json({ error: `Commet: ${msg}` });
    }
    const assinatura = dado(resposta);
    const urlCheckout = assinatura?.checkoutUrl || assinatura?.url;

    if (codigoAtivacao) {
      /* prova de que a Offer foi aplicada: o Commet devolve o desconto na
         assinatura (promoCode/offerId/discount) ou o total zerado. Sem essa
         evidência, o checkout abriria cobrando o preço cheio — desfaz a
         assinatura recém-criada e explica o que falta no dashboard. */
      const total = [assinatura?.totalAmount, assinatura?.amount, assinatura?.price].find((v) => typeof v === "number");
      /* a Offer é de 99.99% (o Commet não aceita 100%) — qualquer evidência de
         desconto próximo do total conta como aplicada */
      const descontoAplicado =
        Boolean(assinatura?.promoCode || assinatura?.offerId || assinatura?.offer || assinatura?.discount) ||
        Number(assinatura?.discountPercent) >= 99 || total === 0;
      if (!descontoAplicado) {
        if (assinatura?.id)
          await commet.subscriptions.cancel({ id: assinatura.id, immediate: true, reason: "codigo_nao_aplicado" }).catch(() => {});
        return res.status(502).json({
          error: "O Commet não aplicou o código de ativação — confira no dashboard se a Offer com o promo code existe (desconto de 99.99%+, sem expiração) e cobre este plano. Nenhuma cobrança foi gerada.",
        });
      }
      /* com 100% de desconto a assinatura pode nascer ativa, sem checkout —
         devolve ativado:true e o front confirma via verificação/webhook */
      if (!urlCheckout)
        return res.status(200).json({ ativado: true, subscriptionId: assinatura.id });
      return res.status(200).json({ checkoutUrl: urlCheckout, subscriptionId: assinatura.id, codigoAplicado: true, trial: false, trialDays: 0 });
    }

    if (!urlCheckout) return res.status(502).json({ error: "Commet não devolveu a URL de checkout da assinatura." });

    const comTrial = elegivelTeste;
    return res.status(200).json({ checkoutUrl: urlCheckout, subscriptionId: assinatura.id, trial: comTrial, trialDays: comTrial ? 30 : 0 });
  } catch (e) {
    console.error("[commet/assinatura]", e);
    return res.status(500).json({ error: e.message || "Erro ao criar a assinatura." });
  }
}
