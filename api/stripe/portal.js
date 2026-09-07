/* POST /api/stripe/portal  { condominioId }
   (Authorization: Bearer — diretor do condomínio)
   Abre o Billing Portal da Stripe para o cliente da licença: trocar o cartão,
   ver faturas e recibos. Exige a configuração padrão do portal salva no
   dashboard (Billing → Portal do cliente). Devolve { url }. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims } from "./_lib/comum.js";
import { corpoValidado } from "../_lib/validar.js";
import { origemBloqueada, logSeguro } from "../_lib/seguranca.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const corpo = corpoValidado(res, corpoJson(req), { condominioId: { tipo: "uuid", obrigatorio: true } });
    if (!corpo) return;
    const { condominioId } = corpo;
    const claims = lerClaims(req);
    if (!claims || claims.condominio_id !== condominioId || claims.perfil !== "diretor")
      return res.status(401).json({ error: "Sessão inválida — entre de novo como diretor." });
    if (origemBloqueada(req, res)) return;

    const { data: ass, error } = await supabase
      .from("saas_assinaturas").select("stripe_customer_id")
      .eq("condominio_id", condominioId).neq("status", "cancelada")
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass?.stripe_customer_id)
      return res.status(404).json({ error: "Este condomínio ainda não tem pagamento cadastrado na Stripe." });

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const portal = await stripe.billingPortal.sessions.create({
      customer: ass.stripe_customer_id,
      return_url: `${origem}/`,
    });
    return res.status(200).json({ url: portal.url });
  } catch (e) {
    logSeguro("[stripe/portal]", e);
    return res.status(500).json({ error: "Erro ao abrir o portal de pagamento." });
  }
}
