/* POST /api/stripe/connect/status
   (Authorization: Bearer — qualquer perfil do condomínio; id vem do token)
   Situação da conta de recebimento Stripe do condomínio. Re-consulta a Stripe
   e sincroniza as flags em integracoes_pagamento (o webhook account.updated
   faz o mesmo — este endpoint cobre dev local e o retorno do onboarding).
   Resposta:
   · todos os perfis:  { online }  — cobranças podem ser pagas online
     (conta ativa E moeda de gestão do condomínio em BRL);
   · diretor (a mais): { configurado, chargesEnabled, payoutsEnabled,
     pendencias[], dashboardUrl }. */
import { stripeClient, supabaseAdmin, lerClaims, integracaoStripe } from "../_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const claims = lerClaims(req);
    if (!claims?.condominio_id) return res.status(401).json({ error: "Sessão inválida — entre de novo." });
    const condominioId = claims.condominio_id;
    const ehDiretor = claims.perfil === "diretor";

    const { data: cond } = await supabase.from("condominios")
      .select("regras_internas").eq("id", condominioId).maybeSingle();
    const moeda = cond?.regras_internas?.moeda || "USD";

    const integ = await integracaoStripe(supabase, condominioId);
    if (!integ?.credenciais?.account_id)
      return res.status(200).json({ online: false, moeda, ...(ehDiretor ? { configurado: false } : {}) });

    const conta = await stripe.accounts.retrieve(integ.credenciais.account_id).catch(() => null);
    const chargesEnabled = !!conta?.charges_enabled;
    const payoutsEnabled = !!conta?.payouts_enabled;
    const pendencias = conta?.requirements?.currently_due || [];
    await supabase.from("integracoes_pagamento").update({
      credenciais: { ...integ.credenciais, charges_enabled: chargesEnabled, payouts_enabled: payoutsEnabled, requirements_due: pendencias },
      ativa: chargesEnabled,
    }).eq("id", integ.id);

    const online = chargesEnabled && moeda === "BRL";
    if (!ehDiretor) return res.status(200).json({ online, moeda });
    return res.status(200).json({
      online, moeda,
      configurado: true,
      chargesEnabled, payoutsEnabled, pendencias,
      dashboardUrl: "https://dashboard.stripe.com",
    });
  } catch (e) {
    console.error("[stripe/connect/status]", e);
    return res.status(500).json({ error: e.message || "Erro ao consultar a conta de recebimento." });
  }
}
