/* POST /api/stripe/webhook-connect — eventos das CONTAS CONECTADAS
   (condomínios recebedores). Direct charges acontecem NA conta conectada,
   então o checkout de cobrança condominial chega aqui — não no webhook da
   conta própria. Valida com STRIPE_CONNECT_WEBHOOK_SECRET (endpoint criado
   com connect: true em scripts/preparar-stripe-producao.mjs).
   · account.updated → sincroniza as flags da conta em integracoes_pagamento;
   · checkout.session.completed / async_payment_succeeded (pago) → RPC
     registrar_pagamento_stripe: INSERT pagamentos (idempotente por payment
     intent) + cobranca → paga/paga_em_atraso + receita "Entrada" no caixa.
   Teste local: stripe listen --forward-connect-to localhost:5173/api/stripe/webhook-connect */
import { stripeClient, supabaseAdmin, envVal, lerCorpoBruto, deMenorUnidade } from "./_lib/comum.js";

export const config = { api: { bodyParser: false } }; // a assinatura exige o corpo bruto

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  const secret = envVal("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!stripe || !secret)
    return res.status(503).json({ error: "STRIPE_SECRET_KEY/STRIPE_CONNECT_WEBHOOK_SECRET não configurados no .env do servidor." });

  const corpo = await lerCorpoBruto(req);
  let event;
  try {
    event = stripe.webhooks.constructEvent(corpo, req.headers["stripe-signature"], secret);
  } catch (e) {
    return res.status(401).json({ error: `Assinatura inválida: ${e.message}` });
  }

  const supabase = supabaseAdmin();
  try {
    if (event.type === "account.updated") {
      const conta = event.data.object;
      const condominioId = conta.metadata?.condominio_id;
      const flags = {
        account_id: conta.id,
        charges_enabled: !!conta.charges_enabled,
        payouts_enabled: !!conta.payouts_enabled,
        requirements_due: conta.requirements?.currently_due || [],
      };
      const alvo = condominioId
        ? supabase.from("integracoes_pagamento").update({ credenciais: flags, ativa: flags.charges_enabled })
            .eq("condominio_id", condominioId).eq("provedor", "stripe")
        : supabase.from("integracoes_pagamento").update({ credenciais: flags, ativa: flags.charges_enabled })
            .eq("provedor", "stripe").contains("credenciais", { account_id: conta.id });
      const { error } = await alvo;
      if (error) console.error("[stripe/webhook-connect] account.updated não gravado:", error.message);
      else console.log(`[stripe/webhook-connect] conta ${conta.id} → charges_enabled=${flags.charges_enabled}`);
      return res.status(200).json({ ok: true });
    }

    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const session = event.data.object;
      const cobrancaId = session.metadata?.cobranca_id;
      /* só cobranças condominiais pagas (Pix confirma já no completed; boleto
         futuro chegaria pelo async_payment_succeeded) */
      if (session.mode !== "payment" || session.payment_status !== "paid" || !cobrancaId)
        return res.status(200).json({ ok: true, ignorado: "sem_cobranca_paga" });

      /* charge id para o rastro (best-effort — o payment intent é a chave).
         stripeAccount vai no 3º argumento (opções de request). */
      let chargeId = null;
      if (session.payment_intent && event.account) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent, {}, { stripeAccount: event.account }).catch(() => null);
        chargeId = typeof pi?.latest_charge === "string" ? pi.latest_charge : pi?.latest_charge?.id || null;
      }

      const { data: resultado, error } = await supabase.rpc("registrar_pagamento_stripe", {
        p_cobranca_id: cobrancaId,
        p_valor_pago: deMenorUnidade(session.amount_total, session.currency),
        p_pago_em: new Date().toISOString(),
        p_payment_intent: String(session.payment_intent || session.id),
        p_charge: chargeId,
      });
      if (error) {
        /* 500 → a Stripe reentrega (a RPC é idempotente, reprocessar é seguro) */
        console.error("[stripe/webhook-connect] registrar_pagamento_stripe:", error.message);
        return res.status(500).json({ error: error.message });
      }
      console.log(`[stripe/webhook-connect] cobrança ${cobrancaId} → ${resultado?.status || JSON.stringify(resultado)}`);
      return res.status(200).json({ ok: true, resultado });
    }

    if (event.type === "checkout.session.async_payment_failed")
      console.log(`[stripe/webhook-connect] pagamento assíncrono falhou — cobrança ${event.data.object?.metadata?.cobranca_id || "?"} segue em aberto.`);

    return res.status(200).json({ ok: true }); // 200 rápido evita reentregas desnecessárias
  } catch (e) {
    console.error("[stripe/webhook-connect]", e);
    return res.status(500).json({ error: e.message });
  }
}
