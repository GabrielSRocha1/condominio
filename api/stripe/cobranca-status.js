/* POST /api/stripe/cobranca-status  { cobrancaId }
   (Authorization: Bearer — qualquer perfil do condomínio da cobrança)
   Confere na Stripe se o checkout da cobrança foi pago e, se sim, dá a baixa
   pela MESMA RPC idempotente do webhook (registrar_pagamento_stripe) — é o
   caminho do polling do retorno ?pagamento=ok e o fallback quando o webhook
   não alcança o ambiente (npm run dev). Devolve { paga }. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, integracaoStripe, deMenorUnidade } from "./_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const { cobrancaId } = corpoJson(req);
    if (!cobrancaId) return res.status(400).json({ error: "Informe cobrancaId." });
    const claims = lerClaims(req);
    if (!claims?.condominio_id) return res.status(401).json({ error: "Sessão inválida — entre de novo." });

    const { data: cobranca, error } = await supabase.from("cobrancas")
      .select("id, condominio_id, status, provider_charge_id")
      .eq("id", cobrancaId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!cobranca || cobranca.condominio_id !== claims.condominio_id)
      return res.status(404).json({ error: "Cobrança não encontrada." });
    if (["paga", "paga_em_atraso"].includes(cobranca.status))
      return res.status(200).json({ paga: true });
    /* sem checkout aberto (provider_charge_id = session id "cs_...") */
    if (!String(cobranca.provider_charge_id || "").startsWith("cs_"))
      return res.status(200).json({ paga: false });

    const integ = await integracaoStripe(supabase, cobranca.condominio_id);
    const accountId = integ?.credenciais?.account_id;
    if (!accountId) return res.status(200).json({ paga: false });

    /* opções de request (stripeAccount) vão no 3º argumento — no 2º o SDK
       as enviaria como query param e a API recusa */
    const session = await stripe.checkout.sessions
      .retrieve(cobranca.provider_charge_id, {}, { stripeAccount: accountId }).catch(() => null);
    if (session?.payment_status !== "paid") return res.status(200).json({ paga: false });

    let chargeId = null;
    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {}, { stripeAccount: accountId }).catch(() => null);
      chargeId = typeof pi?.latest_charge === "string" ? pi.latest_charge : pi?.latest_charge?.id || null;
    }
    const { data: resultado, error: eRpc } = await supabase.rpc("registrar_pagamento_stripe", {
      p_cobranca_id: cobranca.id,
      p_valor_pago: deMenorUnidade(session.amount_total, session.currency),
      p_pago_em: new Date().toISOString(),
      p_payment_intent: String(session.payment_intent || session.id),
      p_charge: chargeId,
    });
    if (eRpc) throw new Error(eRpc.message);
    return res.status(200).json({ paga: resultado?.ok !== false });
  } catch (e) {
    console.error("[stripe/cobranca-status]", e);
    return res.status(500).json({ error: e.message || "Erro ao verificar o pagamento." });
  }
}
