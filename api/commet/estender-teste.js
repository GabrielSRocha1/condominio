/* POST /api/commet/estender-teste  { condominioId }
   Extensão ÚNICA do teste gratuito: +30 dias no mesmo cadastro.
   O Commet não tem API para mover o fim de um trial em andamento, então a
   extensão cancela a assinatura em teste e recria outra com customTrialDays
   (dias restantes + 30), reaproveitando o cartão já salvo do cliente.
   Validações server-side impedem abuso: 1 extensão por condomínio. */
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
  const moedaEnv = (envVal("COMMET_CURRENCY") || "usd").toLowerCase();
  if (moedaEnv !== "usd")
    return res.status(503).json({ error: `COMMET_CURRENCY deve ser "usd" — a licença é cobrada sempre em dólar (valor atual: "${moedaEnv}").` });

  try {
    const { condominioId } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });

    const { data: ass, error } = await supabase
      .from("saas_assinaturas")
      .select("id, status, teste_fim, teste_estendido, condominios(nome_fantasia), saas_planos(nome)")
      .eq("condominio_id", condominioId)
      .neq("status", "cancelada")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass) return res.status(404).json({ error: "Condomínio sem assinatura cadastrada." });
    if (ass.status !== "teste") return res.status(409).json({ error: "A extensão só vale durante o período de teste." });
    if (!ass.teste_fim) return res.status(409).json({ error: "Inicie o teste gratuito antes de estendê-lo." });
    if (ass.teste_estendido) return res.status(409).json({ error: "Este condomínio já usou a extensão única de 30 dias." });

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    const cliente = dado(await commet.customers.get({ id: condominioId }).catch(() => null));
    if (!cliente?.id) return res.status(502).json({ error: "Cliente não encontrado no Commet — inicie o teste antes." });

    /* dias restantes do teste atual + 30, com teto de 60 */
    const resta = Math.max(0, Math.ceil((new Date(`${ass.teste_fim}T23:59:59Z`) - Date.now()) / 86400000));
    const novoTrial = Math.min(resta + 30, 60);

    /* a assinatura em trial precisa sair de cena para a nova entrar (índice de
       1 assinatura ativa por cliente no Commet). Se sumiu por uma tentativa
       anterior interrompida, segue direto para a recriação. */
    const atual = dado(await commet.subscriptions.getActive({ customerId: cliente.id }).catch(() => null));
    let planId = atual?.planId || null;
    const intervalo = atual?.billingInterval || "monthly";
    if (atual?.id) {
      if (atual.status !== "trialing")
        return res.status(409).json({ error: "A assinatura no Commet não está mais em teste — use \"Verificar pagamento\" para sincronizar a licença." });
      await commet.subscriptions.cancel({ id: atual.id, immediate: true, reason: "extensao_teste_30d" });
    }
    if (!planId) {
      /* fallback: resolve o plano pelo code, como em assinatura.js */
      const planos = dado(await commet.plans.list({ includePrivate: true })) || [];
      planId = planos.find((p) => p.code === `condomaster_${slug(ass.saas_planos.nome)}_usd`)?.id || null;
      if (!planId) return res.status(502).json({ error: "Plano do condomínio não encontrado no Commet." });
    }

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const nova = dado(await commet.subscriptions.create({
      planId,
      customerId: cliente.id,
      billingInterval: intervalo,
      customTrialDays: novoTrial, // SDK v9 — exclusivo com offerId/promoCode
      name: `Licença CondoMaster · ${ass.condominios.nome_fantasia}`,
      successUrl: `${origem}/?licenca=ok`,
    }));
    if (!nova?.id) return res.status(502).json({ error: "Commet não recriou a assinatura — tente novamente (a extensão continua disponível)." });

    /* cartão já salvo: o Commet pode iniciar o trial direto (trialing) ou pedir
       a reconfirmação no checkout — nos dois casos o acesso local segue por teste_fim */
    const precisaCheckout = nova.status !== "trialing" && !!nova.checkoutUrl;

    /* +30 dias e trava da extensão. O webhook trial.started da nova assinatura
       reescreve teste_fim com o valor exato do Commet, sem tocar na flag. */
    const novoFim = new Date(new Date(`${ass.teste_fim}T12:00:00Z`).getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const { error: eUp } = await supabase.from("saas_assinaturas")
      .update({ teste_fim: novoFim, teste_estendido: true })
      .eq("condominio_id", condominioId)
      .neq("status", "cancelada");
    if (eUp) throw new Error(eUp.message);

    return res.status(200).json({
      estendido: true, testeFim: novoFim, trialDays: novoTrial,
      checkoutUrl: precisaCheckout ? nova.checkoutUrl : null,
    });
  } catch (e) {
    console.error("[commet/estender-teste]", e);
    return res.status(500).json({ error: e.message || "Erro ao estender o teste." });
  }
}
