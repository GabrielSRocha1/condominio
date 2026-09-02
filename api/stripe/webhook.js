/* POST /api/stripe/webhook — eventos da CONTA DA PLATAFORMA (licença SaaS).
   Valida a assinatura (header "stripe-signature") com STRIPE_WEBHOOK_SECRET e
   sincroniza saas_assinaturas com o ESTADO VIVO da subscription (re-busca na
   Stripe — imune a eventos fora de ordem e reentregas).
   Eventos de cobranças condominiais chegam no endpoint Connect separado
   (/api/stripe/webhook-connect). Registro: scripts/preparar-stripe-producao.mjs.
   Teste local: stripe listen --forward-to localhost:5173/api/stripe/webhook */
import { stripeClient, supabaseAdmin, envVal, lerCorpoBruto, sincronizarLicenca, condominioDaSub } from "./_lib/comum.js";

export const config = { api: { bodyParser: false } }; // a assinatura exige o corpo bruto

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  const secret = envVal("STRIPE_WEBHOOK_SECRET");
  if (!stripe || !secret)
    return res.status(503).json({ error: "STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET não configurados no .env do servidor." });

  const corpo = await lerCorpoBruto(req);
  let event;
  try {
    event = stripe.webhooks.constructEvent(corpo, req.headers["stripe-signature"], secret);
  } catch (e) {
    return res.status(401).json({ error: `Assinatura inválida: ${e.message}` });
  }

  const supabase = supabaseAdmin();
  try {
    /* checkout da licença concluído: amarra os IDs no banco na hora (o evento
       de subscription pode chegar antes/depois — os dois caminhos convergem) */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription" && session.client_reference_id) {
        await supabase.from("saas_assinaturas")
          .update({ stripe_customer_id: session.customer, stripe_subscription_id: session.subscription })
          .eq("condominio_id", session.client_reference_id).neq("status", "cancelada");
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription).catch(() => null);
          if (sub) {
            const st = await sincronizarLicenca(supabase, sub, session.client_reference_id);
            console.log(`[stripe/webhook] checkout concluído — licença do condomínio ${session.client_reference_id} → ${st}`);
          }
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      /* estado vivo, não o delta: no "deleted" o retrieve devolve a própria
         subscription cancelada — o fallback para o objeto do evento cobre
         qualquer indisponibilidade momentânea */
      const doEvento = event.data.object;
      const sub = (await stripe.subscriptions.retrieve(doEvento.id).catch(() => null)) || doEvento;
      const condominioId = await condominioDaSub(supabase, sub);
      if (!condominioId) {
        console.error(`[stripe/webhook] ${event.type}: subscription ${sub.id} sem condomínio conhecido — ignorada.`);
        return res.status(200).json({ ok: false, ignorado: "condominio_desconhecido" });
      }
      const st = await sincronizarLicenca(supabase, sub, condominioId);
      if (st) console.log(`[stripe/webhook] licença do condomínio ${condominioId} → ${st}`);
      return res.status(200).json({ ok: true });
    }

    if (event.type === "invoice.payment_failed") {
      /* o customer.subscription.updated (→ past_due) já bloqueia; aqui é só rastro */
      console.log(`[stripe/webhook] fatura falhou: customer ${event.data.object?.customer}`);
    }

    return res.status(200).json({ ok: true }); // 200 rápido evita reentregas desnecessárias
  } catch (e) {
    console.error("[stripe/webhook]", e);
    return res.status(500).json({ error: e.message });
  }
}
