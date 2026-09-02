/* POST /api/stripe/cancelar-assinatura  { condominioId }
   (Authorization: Bearer — diretor do condomínio)
   Cancela a assinatura da licença SaaS de forma AGENDADA
   (cancel_at_period_end): o acesso continua até o fim do período já pago (ou
   do teste) e nenhuma cobrança futura é feita. O webhook
   customer.subscription.deleted marca "cancelada" quando o período termina. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, dataISO, hojeISO } from "./_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const { condominioId } = corpoJson(req);
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });
    const claims = lerClaims(req);
    if (!claims || claims.condominio_id !== condominioId || claims.perfil !== "diretor")
      return res.status(401).json({ error: "Sessão inválida — entre de novo como diretor." });

    const { data: ass, error } = await supabase
      .from("saas_assinaturas").select("id, status, stripe_subscription_id")
      .eq("condominio_id", condominioId).neq("status", "cancelada")
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass) return res.status(404).json({ error: "Condomínio sem assinatura ativa para cancelar." });

    const atual = ass.stripe_subscription_id
      ? await stripe.subscriptions.retrieve(ass.stripe_subscription_id).catch(() => null)
      : null;

    if (!atual || ["canceled", "incomplete_expired"].includes(atual.status)) {
      /* nada vivo na Stripe: a assinatura já foi cancelada por fora (ex.:
         dashboard) e o webhook não alcançou este ambiente — só sincroniza. */
      const { error: eSync } = await supabase.from("saas_assinaturas")
        .update({ status: "cancelada" })
        .eq("condominio_id", condominioId).neq("status", "cancelada");
      if (eSync) throw new Error(eSync.message);
      return res.status(200).json({ cancelada: true, imediato: true, fimAcesso: null, sincronizada: true });
    }

    /* incomplete (checkout nunca concluído) não tem período pago — encerra na
       hora; trialing/active/past_due são agendados para o fim do período */
    const imediato = atual.status === "incomplete";
    let fimAcesso = null;
    if (imediato) {
      await stripe.subscriptions.cancel(atual.id);
    } else {
      const r = await stripe.subscriptions.update(atual.id, { cancel_at_period_end: true });
      const fim = r.cancel_at || r.trial_end || r.items?.data?.[0]?.current_period_end || r.current_period_end;
      fimAcesso = dataISO(fim);
    }

    /* persiste as datas para o aviso da tela Planos (voltam a NULL na
       reativação). Não-fatal: o cancelamento na Stripe já aconteceu. */
    const { error: eUp } = await supabase.from("saas_assinaturas")
      .update({ cancelamento_agendado_em: hojeISO(), acesso_ate: fimAcesso })
      .eq("condominio_id", condominioId).neq("status", "cancelada");
    if (eUp) console.error("[stripe/cancelar-assinatura] datas do aviso não gravadas:", eUp.message);

    return res.status(200).json({ cancelada: true, imediato, fimAcesso });
  } catch (e) {
    console.error("[stripe/cancelar-assinatura]", e);
    return res.status(500).json({ error: e.message || "Erro ao cancelar a assinatura." });
  }
}
