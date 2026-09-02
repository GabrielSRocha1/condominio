/* POST /api/stripe/assinatura  { condominioId, ciclo, troca, codigo? }
   (Authorization: Bearer — diretor do condomínio)
   Abre o Stripe Checkout da ASSINATURA recorrente da licença SaaS (BRL) e
   devolve { checkoutUrl }. Na troca com assinatura ativa, atualiza o preço da
   assinatura existente (rateio always_invoice) e devolve { trocaAplicada }.
   codigo: código de ativação de PAGAMENTO MANUAL — promotion code da Stripe
   usado como chave de autorização de uso único (nunca como desconto): cria a
   assinatura NO VALOR CHEIO sem cartão, em modo send_invoice (fatura por
   e-mail a cada ciclo; a administração marca como paga quando o dinheiro
   entra; vencida → past_due → paywall bloqueia sozinho) → { ativado: true }.
   A confirmação chega pelo webhook (customer.subscription.*). */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, lookupKey, envVal, sincronizarLicenca } from "./_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const corpo = corpoJson(req);
    const { condominioId, ciclo, troca } = corpo;
    const codigoAtivacao = String(corpo.codigo || "").trim().toUpperCase();
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });

    const claims = lerClaims(req);
    if (!claims || claims.condominio_id !== condominioId || claims.perfil !== "diretor")
      return res.status(401).json({ error: "Sessão inválida — entre de novo como diretor." });

    const CAMPOS_ASS = "id, status, teste_fim, stripe_customer_id, stripe_subscription_id, condominios(id, nome_fantasia, cnpj), saas_planos(id, nome, preco_mensal, preco_anual)";
    let { data: ass, error } = await supabase
      .from("saas_assinaturas").select(CAMPOS_ASS)
      .eq("condominio_id", condominioId).neq("status", "cancelada")
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass) {
      /* licença cancelada querendo voltar: "cancelada" é terminal para os
         webhooks (todos os updates usam .neq status cancelada), então a linha
         precisa ser ressuscitada ANTES do checkout — senão a confirmação do
         pagamento nunca gravaria. Volta para "teste" (com o teste_fim antigo,
         já consumido → o checkout sai sem trial e cobra direto). */
      const { data: cancelada, error: eCanc } = await supabase
        .from("saas_assinaturas").select(CAMPOS_ASS)
        .eq("condominio_id", condominioId).eq("status", "cancelada")
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
      if (eCanc) throw new Error(eCanc.message);
      if (!cancelada) return res.status(404).json({ error: "Condomínio sem assinatura cadastrada." });
      const { error: eRev } = await supabase.from("saas_assinaturas")
        .update({ status: "teste", cancelamento_agendado_em: null, acesso_ate: null, bloqueada_em: null, stripe_subscription_id: null })
        .eq("id", cancelada.id);
      if (eRev) throw new Error(eRev.message);
      ass = { ...cancelada, status: "teste", stripe_subscription_id: null };
    }
    if (ass.status === "ativa" && !troca) return res.status(409).json({ error: "A licença deste condomínio já está ativa." });
    /* teste gratuito de 30 dias: só na PRIMEIRA assinatura do condomínio —
       quem já iniciou um teste (teste_fim preenchido) paga direto; troca idem */
    const elegivelTeste = ass.status === "teste" && !ass.teste_fim && !troca && !codigoAtivacao;

    const plano = ass.saas_planos;
    const cond = ass.condominios;
    const anual = ciclo === "anual" && Number(plano.preco_anual) > 0;

    /* preço pela lookup_key (criada por scripts/preparar-stripe-producao.mjs) */
    const chavePreco = lookupKey(plano.nome, anual ? "anual" : "mensal");
    const precos = await stripe.prices.list({ lookup_keys: [chavePreco], active: true, limit: 1 });
    const price = precos.data[0];
    if (!price) return res.status(502).json({ error: `Preço "${chavePreco}" não existe na Stripe — rode scripts/preparar-stripe-producao.mjs.` });

    /* cliente Stripe: 1 por condomínio, persistido JÁ AQUI (o webhook e a
       verificação dependem desse vínculo — nada de id implícito) */
    let customerId = ass.stripe_customer_id;
    if (customerId) {
      const cli = await stripe.customers.retrieve(customerId).catch(() => null);
      if (!cli || cli.deleted) customerId = null;
    }
    if (!customerId) {
      const { data: usuario } = await supabase
        .from("usuarios").select("email, pessoas!inner(condominio_id)")
        .eq("pessoas.condominio_id", condominioId).limit(1).maybeSingle();
      const cliente = await stripe.customers.create({
        name: cond.nome_fantasia,
        email: usuario?.email || undefined,
        metadata: { condominio_id: condominioId, cnpj: cond.cnpj || "" },
      });
      customerId = cliente.id;
      const { error: eCli } = await supabase.from("saas_assinaturas")
        .update({ stripe_customer_id: customerId }).eq("id", ass.id);
      if (eCli) throw new Error(eCli.message);
    }

    const origem = req.headers.origin || `https://${req.headers.host}`;

    /* upgrade/downgrade com assinatura ativa: troca o preço DA ASSINATURA
       EXISTENTE (always_invoice cobra/credita a diferença com rateio na hora
       — sem cobrança dupla e sem novo checkout) */
    if (troca && ass.stripe_subscription_id) {
      const atual = await stripe.subscriptions.retrieve(ass.stripe_subscription_id).catch(() => null);
      /* trocar durante o trial converteria o teste e cobraria na hora — bloqueia */
      if (atual?.status === "trialing")
        return res.status(409).json({ error: "A troca de plano durante o teste gratuito é cobrada imediatamente — aguarde o fim do teste para trocar." });
      if (atual && ["active", "past_due"].includes(atual.status)) {
        await stripe.subscriptions.update(atual.id, {
          items: [{ id: atual.items.data[0].id, price: price.id }],
          proration_behavior: "always_invoice",
        });
        return res.status(200).json({ trocaAplicada: true, agendadaPara: null });
      }
      /* sem assinatura viva na Stripe: segue para um checkout novo */
    }

    /* ── código de ativação = PAGAMENTO MANUAL (send_invoice) ──
       Sem checkout: a assinatura nasce ativa no valor cheio, sem cartão, e a
       Stripe emite a fatura de cada ciclo com prazo de vencimento. O cliente
       paga em dinheiro; a administração marca a fatura como "paga fora da
       Stripe" no dashboard. Fatura vencida → past_due (configurável no
       dashboard: cancelar após N dias) → webhook marca inadimplente →
       paywall bloqueia sem intervenção. */
    if (codigoAtivacao) {
      const lista = await stripe.promotionCodes.list({ code: codigoAtivacao, active: true, limit: 1 });
      const promo = lista.data[0];
      if (!promo) return res.status(400).json({ error: "Código de ativação inválido ou expirado." });

      const diasVencimento = Number(envVal("STRIPE_DIAS_VENCIMENTO_FATURA")) || 10;
      const sub = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: price.id }],
        collection_method: "send_invoice",
        days_until_due: diasVencimento,
        description: `Licença CondoMaster · ${cond.nome_fantasia} (pagamento manual)`,
        metadata: { condominio_id: condominioId, codigo_ativacao: codigoAtivacao },
      });

      /* uso único: o código é invalidado AQUI (a Stripe só "resgataria" um
         promotion code aplicado como desconto — como ele é só autorização,
         somos nós que o desativamos), com rastro de quem o consumiu */
      await stripe.promotionCodes.update(promo.id, {
        active: false,
        metadata: { usado_por_condominio: condominioId, usado_em: new Date().toISOString().slice(0, 10) },
      }).catch((e) => console.error("[stripe/assinatura] código não desativado:", e.message));

      /* primeira fatura: finaliza e envia já (senão a Stripe finaliza
         sozinha em ~1h). Best-effort — sem e-mail no cliente o envio falha,
         mas a fatura existe e é gerenciada pelo dashboard. */
      try {
        const invId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
        if (invId) {
          await stripe.invoices.finalizeInvoice(invId).catch(() => {});
          await stripe.invoices.sendInvoice(invId);
        }
      } catch (e) { console.log("[stripe/assinatura] fatura criada; envio por e-mail indisponível:", e.message); }

      /* espelha no banco na hora — o webhook faz o mesmo, mas em dev local
         ele não chega e o acesso libera por este caminho */
      await sincronizarLicenca(supabase, sub, condominioId);
      return res.status(200).json({ ativado: true, subscriptionId: sub.id, pagamentoManual: true, diasVencimento });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: condominioId,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: {
        ...(elegivelTeste ? { trial_period_days: 30 } : {}),
        description: `Licença CondoMaster · ${cond.nome_fantasia}`,
        metadata: { condominio_id: condominioId },
      },
      /* sem allow_promotion_codes de propósito: códigos de ativação passam
         SÓ pelo campo do app (fluxo de pagamento manual acima) — digitados
         no checkout dariam desconto de verdade */
      payment_method_collection: "always",
      success_url: `${origem}/?licenca=ok`,
      cancel_url: `${origem}/`,
    });

    return res.status(200).json({
      checkoutUrl: session.url,
      sessionId: session.id,
      trial: elegivelTeste,
      trialDays: elegivelTeste ? 30 : 0,
    });
  } catch (e) {
    console.error("[stripe/assinatura]", e);
    return res.status(500).json({ error: e.message || "Erro ao criar a assinatura." });
  }
}
