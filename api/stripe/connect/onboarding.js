/* POST /api/stripe/connect/onboarding
   (Authorization: Bearer — diretor do condomínio; condominioId vem do token)
   Cria (ou reaproveita) a conta conectada Stripe do CONDOMÍNIO — é ela que
   recebe as cobranças condominiais pagas online (direct charge; a plataforma
   retém 1% de application fee) — e devolve { url } do onboarding hospedado.

   Configuração da conta (controller properties):
   · fees.payer 'account' — direct charge exige as taxas Stripe na conta
     conectada (é o condomínio quem processa; recibo no nome dele);
   · losses.payments 'stripe' + requirement_collection 'stripe' + dashboard
     'full' — a Stripe faz o KYC e assume disputas; o condomínio gerencia
     recebimentos em dashboard.stripe.com (equivalente a uma conta Standard).
   O account id fica em integracoes_pagamento (SEM policy de leitura/escrita
   client-side — só os endpoints /api enxergam; um diretor mal-intencionado
   não consegue trocar a conta recebedora via supabase-js). */
import { stripeClient, supabaseAdmin, lerClaims, integracaoStripe } from "../_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const claims = lerClaims(req);
    if (!claims?.condominio_id || claims.perfil !== "diretor")
      return res.status(401).json({ error: "Sessão inválida — entre de novo como diretor." });
    const condominioId = claims.condominio_id;

    const integ = await integracaoStripe(supabase, condominioId);
    let accountId = integ?.credenciais?.account_id || null;
    if (accountId) {
      const conta = await stripe.accounts.retrieve(accountId).catch(() => null);
      if (!conta) accountId = null; // conta apagada na Stripe — recria
    }

    if (!accountId) {
      const { data: cond } = await supabase.from("condominios")
        .select("nome_fantasia, cnpj").eq("id", condominioId).maybeSingle();
      const conta = await stripe.accounts.create({
        country: "BR",
        email: claims.email || undefined,
        controller: {
          fees: { payer: "account" },
          losses: { payments: "stripe" },
          stripe_dashboard: { type: "full" },
          requirement_collection: "stripe",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: cond?.nome_fantasia || undefined,
          product_description: "Taxas condominiais (CondoMaster Pro)",
        },
        metadata: { condominio_id: condominioId, cnpj: cond?.cnpj || "" },
      });
      accountId = conta.id;
      const credenciais = { account_id: accountId, charges_enabled: false, payouts_enabled: false, requirements_due: [] };
      const { error: eUp } = integ
        ? await supabase.from("integracoes_pagamento")
            .update({ credenciais, ativa: false }).eq("id", integ.id)
        : await supabase.from("integracoes_pagamento")
            .insert({ condominio_id: condominioId, provedor: "stripe", credenciais, ativa: false });
      if (eUp) throw new Error(eUp.message);
    }

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: `${origem}/?stripe=retorno`,
      refresh_url: `${origem}/?stripe=refresh`,
    });
    return res.status(200).json({ url: link.url });
  } catch (e) {
    console.error("[stripe/connect/onboarding]", e);
    return res.status(500).json({ error: e.message || "Erro ao iniciar o cadastro de recebimento." });
  }
}
