/* POST /api/stripe/portal  { condominioId }
   (Authorization: Bearer — licenca.gerir ou licenca.pagar)
   Abre o Billing Portal da Stripe para o cliente da licença: trocar o cartão,
   ver faturas e recibos. Exige a configuração padrão do portal salva no
   dashboard (Billing → Portal do cliente). Devolve { url }.

   DUAS PORTAS, pela permissão de quem pede:
     · `licenca.gerir` (dono) → portal COMPLETO, como sempre: ele cancela e
       troca de plano por ali se quiser;
     · só `licenca.pagar` (administrador predial) → portal RESTRITO
       (configPortalRestrito): faturas, recibos e cartão; sem cancelar e sem
       trocar de plano. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, configPortalRestrito } from "./_lib/comum.js";
import { corpoValidado } from "../_lib/validar.js";
import { origemBloqueada, logSeguro } from "../_lib/seguranca.js";
import { carregarPerms, doClaims } from "../_lib/permissoes.js";

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
    if (!claims || claims.condominio_id !== condominioId)
      return res.status(401).json({ error: "Sessão inválida — entre de novo." });
    /* autorização pela MATRIZ (antes era `perfil === "diretor"` cravado).
       Sem o supabase-permissoes.sql, degrada no padrão — onde só o diretor
       tem licenca.gerir, exatamente como antes. */
    const perms = await carregarPerms(supabase, doClaims(claims));
    const gerir = perms.has("licenca.gerir");
    const pagar = gerir || perms.has("licenca.pagar");
    if (!pagar)
      return res.status(403).json({ error: "Seu perfil não pode acessar a fatura da licença." });
    if (origemBloqueada(req, res)) return;

    const { data: ass, error } = await supabase
      .from("saas_assinaturas").select("stripe_customer_id")
      .eq("condominio_id", condominioId).neq("status", "cancelada")
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass?.stripe_customer_id)
      return res.status(404).json({ error: "Este condomínio ainda não tem pagamento cadastrado na Stripe." });

    const origem = req.headers.origin || `https://${req.headers.host}`;

    /* Quem só PAGA vai para a configuração restrita. Aqui o projeto degrada
       FECHADO, contra a convenção da casa: se a configuração não puder ser
       resolvida, a resposta é 503 — cair no portal padrão entregaria o botão
       de cancelar assinatura justamente a quem não pode cancelar. */
    let configuracao;
    if (!gerir) {
      configuracao = await configPortalRestrito(stripe, origem);
      if (!configuracao) return res.status(503).json({
        error: "O portal restrito de pagamento está indisponível agora. Tente de novo em instantes ou peça ao diretor.",
      });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: ass.stripe_customer_id,
      return_url: `${origem}/`,
      ...(configuracao ? { configuration: configuracao } : {}),
    });
    return res.status(200).json({ url: portal.url, restrito: !gerir });
  } catch (e) {
    logSeguro("[stripe/portal]", e);
    return res.status(500).json({ error: "Erro ao abrir o portal de pagamento." });
  }
}
