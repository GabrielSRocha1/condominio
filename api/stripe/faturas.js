/* POST /api/stripe/faturas  { condominioId }
   (Authorization: Bearer — licenca.gerir ou licenca.pagar)
   Histórico de faturas da LICENÇA da plataforma (não as cobranças dos
   moradores). Lê direto da Stripe — não existe tabela local de faturas, e
   nem deve: a fatura é um fato da Stripe, e espelhá-la criaria duas versões
   da verdade sobre dinheiro.

   Devolve { faturas: [...] } com `pagarUrl` preenchido só nas que estão em
   aberto ou vencidas — é a página de fatura hospedada pela Stripe, onde
   também não há como cancelar nada. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, dataISO, deMenorUnidade } from "./_lib/comum.js";
import { corpoValidado } from "../_lib/validar.js";
import { limitar, origemBloqueada, logSeguro } from "../_lib/seguranca.js";
import { carregarPerms, doClaims } from "../_lib/permissoes.js";

/* "em aberto" na Stripe: `open` é a fatura finalizada e não paga; a vencida
   continua `open` (o que muda é a subscription ir para past_due). `draft` é
   fatura em rascunho — não se paga, e a Stripe a finaliza sozinha. */
const PAGAVEIS = new Set(["open"]);

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
    /* autorização pela MATRIZ: o dono (licenca.gerir) e quem paga a conta
       (licenca.pagar) veem as mesmas faturas. Ler a fatura não move dinheiro
       nem muda o contrato. */
    const perms = await carregarPerms(supabase, doClaims(claims));
    if (!(perms.has("licenca.gerir") || perms.has("licenca.pagar")))
      return res.status(403).json({ error: "Seu perfil não pode ver a fatura da licença." });
    if (origemBloqueada(req, res)) return;
    const ritmo = await limitar(supabase, `stripe-faturas:${claims.sub}`,
      { janelaSeg: 10 * 60, max: 60, bloqueioSeg: 5 * 60 });
    if (ritmo.bloqueado)
      return res.status(429).json({ error: "Muitas consultas — aguarde alguns minutos e tente de novo." });

    const { data: ass, error } = await supabase
      .from("saas_assinaturas").select("stripe_customer_id")
      .eq("condominio_id", condominioId).neq("status", "cancelada")
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    /* conta que nunca falou com a Stripe (pré-checkout): zero faturas, sem
       erro — a tela mostra o aviso de licença não contratada */
    if (!ass?.stripe_customer_id) return res.status(200).json({ faturas: [], semCliente: true });

    /* "No such customer" é CONDIÇÃO, não falha: acontece sempre que a chave
       configurada aponta para o outro ambiente da Stripe (condomínio live
       aberto no dev local, que roda em test), e também se o cliente foi
       removido do dashboard. Um 500 genérico aqui vira "Erro ao buscar as
       faturas" na tela — vermelho, alarmante e que não diz o que houve. */
    let lista;
    try {
      lista = await stripe.invoices.list({ customer: ass.stripe_customer_id, limit: 12 });
    } catch (e) {
      if (e?.code === "resource_missing" || /No such customer/i.test(e?.message || "")) {
        logSeguro("[stripe/faturas] cliente fora do ambiente desta chave", e);
        return res.status(200).json({ faturas: [], clienteAusente: true });
      }
      throw e;
    }

    const faturas = lista.data
      .filter((inv) => inv.status !== "draft")
      .map((inv) => ({
        id: inv.id,
        numero: inv.number || null,
        status: inv.status,                       // open | paid | uncollectible | void
        criadaEm: dataISO(inv.created),
        vencimento: dataISO(inv.due_date) || dataISO(inv.next_payment_attempt) || null,
        pagaEm: dataISO(inv.status_transitions?.paid_at) || null,
        /* o total vem na MENOR UNIDADE da moeda da fatura, e com Adaptive
           Pricing a moeda varia (uma fatura em guarani não tem centavos):
           deMenorUnidade usa a lista zero-decimal da Stripe — nunca /100 */
        total: deMenorUnidade(inv.total, inv.currency),
        aPagar: deMenorUnidade(inv.amount_remaining, inv.currency),
        moeda: String(inv.currency || "").toUpperCase(),
        pagarUrl: PAGAVEIS.has(inv.status) && inv.amount_remaining > 0 ? inv.hosted_invoice_url || null : null,
        pdfUrl: inv.invoice_pdf || null,
      }));

    return res.status(200).json({ faturas });
  } catch (e) {
    logSeguro("[stripe/faturas]", e);
    return res.status(500).json({ error: "Erro ao buscar as faturas da licença." });
  }
}
