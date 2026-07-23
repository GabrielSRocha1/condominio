/* POST /api/commet/webhook — recebe os eventos do Commet.
   É este endpoint que CONFIRMA que o pagamento foi feito:
   - valida a assinatura HMAC-SHA256 (header "commet-signature") com o COMMET_WEBHOOK_SECRET;
   - em payment.received: marca a cobrança como paga e registra o pagamento no Supabase.
   Registre-o no Commet com:
     commet webhooks create --url https://SEU-DOMINIO/api/commet/webhook \
       --events '["payment.received","payment.failed"]'
   Para testar localmente: commet listen 3000 */
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } }; // assinatura exige o corpo bruto

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => (process.env[k] && !process.env[k].startsWith("COLE_AQUI") ? process.env[k] : undefined);
const supabase = createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

const lerCorpoBruto = (req) =>
  new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const assinaturaValida = (corpo, assinatura, secret) => {
  if (!assinatura || !secret) return false;
  const esperada = crypto.createHmac("sha256", secret).update(corpo).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(assinatura)); } catch { return false; }
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const corpo = await lerCorpoBruto(req);
  const secret = process.env.COMMET_WEBHOOK_SECRET;
  if (!secret || secret.startsWith("COLE_AQUI"))
    return res.status(503).json({ error: "COMMET_WEBHOOK_SECRET não configurado no .env do servidor." });
  if (!assinaturaValida(corpo, req.headers["commet-signature"], secret))
    return res.status(401).json({ error: "Assinatura inválida." });

  try {
    const payload = JSON.parse(corpo);
    const { event, data, timestamp } = payload;

    if (event === "payment.received") {
      /* localiza a cobrança pelo metadata (preferência) ou pelo id do pagamento */
      const cobrancaId = data?.metadata?.cobrancaId || null;
      const filtro = cobrancaId
        ? supabase.from("cobrancas").select("id, condominio_id, vencimento, status").eq("id", cobrancaId)
        : supabase.from("cobrancas").select("id, condominio_id, vencimento, status").eq("provider_charge_id", data.id);
      const { data: cobs, error } = await filtro.limit(1);
      if (error) throw new Error(error.message);
      const cob = cobs?.[0];
      if (!cob) { console.warn("[commet/webhook] cobrança não encontrada para", data?.id); return res.status(200).json({ ok: true }); }

      const pagoEm = timestamp || new Date().toISOString();
      const atrasado = cob.vencimento && pagoEm.slice(0, 10) > cob.vencimento;

      /* idempotência: provider_event_id é único — reentregas do webhook não duplicam */
      const { error: ePag } = await supabase.from("pagamentos").insert({
        condominio_id: cob.condominio_id, cobranca_id: cob.id,
        valor_pago: Number(data.amount || 0) / 100, pago_em: pagoEm,
        origem: "webhook", provider_event_id: data.id, provider_tx_id: data.id,
      });
      if (ePag && !ePag.message.includes("duplicate")) throw new Error(ePag.message);

      await supabase.from("cobrancas")
        .update({ status: atrasado ? "paga_em_atraso" : "paga", provider_charge_id: data.id })
        .eq("id", cob.id);
    }

    if (event === "payment.failed") {
      console.warn("[commet/webhook] pagamento falhou:", data?.id, data?.customerId || "");
    }

    /* ── Licença SaaS (assinatura da mensalidade do CondoMaster) ──
       customerId volta como o externalId informado na criação = condominio_id */
    const STATUS_ASSINATURA = {
      "subscription.activated": "ativa",
      "subscription.reactivated": "ativa",
      "trial.converted": "ativa",
      "subscription.past_due": "inadimplente",
      "subscription.canceled": "cancelada",
    };
    if (STATUS_ASSINATURA[event] && data?.customerId) {
      const novo = { status: STATUS_ASSINATURA[event] };
      if (novo.status === "ativa") {
        novo.bloqueada_em = null;
        if (data.currentPeriodEnd) novo.renovacao = data.currentPeriodEnd.slice(0, 10);
      }
      const { error: eAss } = await supabase
        .from("saas_assinaturas")
        .update(novo)
        .eq("condominio_id", data.customerId)
        .neq("status", "cancelada");
      if (eAss) console.error("[commet/webhook] licença não atualizada:", eAss.message);
      else console.log(`[commet/webhook] licença do condomínio ${data.customerId} → ${novo.status}`);
    }

    return res.status(200).json({ ok: true }); // 200 rápido evita reentregas desnecessárias
  } catch (e) {
    console.error("[commet/webhook]", e);
    return res.status(500).json({ error: e.message });
  }
}
