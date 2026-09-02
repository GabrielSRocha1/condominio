/* POST /api/stripe/licenca  { condominioId }
   (Authorization: Bearer — qualquer perfil do condomínio)
   Confere na Stripe se a assinatura da licença está ativa e sincroniza o
   status no Supabase. É o caminho do botão "Já paguei — verificar" do paywall
   e do polling do retorno ?licenca=ok — funciona mesmo quando o webhook ainda
   não chegou (ou não alcança o ambiente, como em npm run dev). */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, sincronizarLicenca } from "./_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const { condominioId } = corpoJson(req);
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });
    const claims = lerClaims(req);
    if (!claims || claims.condominio_id !== condominioId)
      return res.status(401).json({ error: "Sessão inválida — entre de novo." });

    const { data: local, error } = await supabase.from("saas_assinaturas")
      .select("status, teste_fim, stripe_customer_id")
      .eq("condominio_id", condominioId).neq("status", "cancelada")
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    /* conta pré-checkout (nunca falou com a Stripe): nada a verificar — o
       paywall chama isto a cada focus da janela, então precisa ser barato */
    if (!local?.stripe_customer_id)
      return res.status(200).json({ ativa: false, teste: false });

    /* a assinatura mais recente do cliente decide (status: all pega também
       trialing/past_due/canceled — a lista vem ordenada da mais nova) */
    const lista = await stripe.subscriptions.list({ customer: local.stripe_customer_id, status: "all", limit: 5 });
    const viva = lista.data.find((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status)) || null;

    if (viva) {
      await sincronizarLicenca(supabase, viva, condominioId);
      return res.status(200).json({
        ativa: viva.status === "active",
        teste: viva.status === "trialing",
        statusStripe: viva.status,
      });
    }

    /* a Stripe NÃO tem assinatura viva para este cliente. Se a licença local
       ainda diz "ativa" (ou teste iniciado), ela foi cancelada por fora —
       ex.: no dashboard da Stripe — e o webhook não alcançou este ambiente.
       Conta pré-checkout (teste sem teste_fim) fica intocada. */
    if (local.status === "ativa" || (local.status === "teste" && local.teste_fim)) {
      const { error: eSync } = await supabase.from("saas_assinaturas")
        .update({ status: "cancelada" })
        .eq("condominio_id", condominioId).neq("status", "cancelada");
      if (eSync) throw new Error(eSync.message);
      return res.status(200).json({ ativa: false, teste: false, cancelada: true });
    }

    return res.status(200).json({ ativa: false, teste: false });
  } catch (e) {
    console.error("[stripe/licenca]", e);
    return res.status(500).json({ error: e.message || "Erro ao verificar a licença." });
  }
}
