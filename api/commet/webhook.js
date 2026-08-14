/* POST /api/commet/webhook — recebe os eventos do Commet.
   O Commet cuida SOMENTE da licença SaaS (assinatura do plano do condomínio);
   as cobranças condominiais são pagas pelos meios cadastrados no condomínio.
   - valida a assinatura HMAC-SHA256 (header "commet-signature") com o COMMET_WEBHOOK_SECRET;
   - em eventos de assinatura: sincroniza o status da licença no Supabase.
   Registre-o no Commet com:
     commet webhooks create --url https://SEU-DOMINIO/api/commet/webhook \
       --events '["subscription.activated","subscription.reactivated","subscription.plan_changed","trial.started","trial.will_end","trial.expired","trial.converted","subscription.past_due","subscription.canceled"]'
   Para testar localmente: commet listen 3000 */
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } }; // assinatura exige o corpo bruto

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
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
    const { event, data } = payload;

    /* ── Licença SaaS (assinatura da mensalidade do CondoMaster) ──
       customerId volta como o externalId informado na criação = condominio_id */
    /* início do teste gratuito: o checkout salvou o cartão sem cobrar — mantém
       "teste" e grava o fim do período (é o teste_fim que governa o acesso no
       app). Não toca em teste_estendido: a recriação feita pela extensão também
       dispara este evento, com o novo trialEndsAt. */
    if (event === "trial.started" && data?.customerId) {
      const novo = { status: "teste" };
      if (data.trialEndsAt) novo.teste_fim = String(data.trialEndsAt).slice(0, 10);
      const { error: eT } = await supabase.from("saas_assinaturas").update(novo)
        .eq("condominio_id", data.customerId).neq("status", "cancelada");
      if (eT) console.error("[commet/webhook] trial.started não gravado:", eT.message);
      else console.log(`[commet/webhook] teste do condomínio ${data.customerId} até ${novo.teste_fim || "?"}`);
      return res.status(200).json({ ok: true });
    }
    if (event === "trial.will_end" && data?.customerId)
      console.log(`[commet/webhook] teste do condomínio ${data.customerId} termina em ${data.trialEndsAt || "3 dias"}`);

    const STATUS_ASSINATURA = {
      "subscription.activated": "ativa",
      "subscription.reactivated": "ativa",
      "subscription.plan_changed": "ativa", // upgrade/downgrade concluído — segue ativa
      "trial.expired": "ativa",  // fim do teste: o Commet cobrou o cartão salvo
      "trial.converted": "ativa", // converteu antes do fim (troca de plano no trial)
      "subscription.past_due": "inadimplente",
      "subscription.canceled": "cancelada",
    };
    if (STATUS_ASSINATURA[event] && data?.customerId) {
      /* cancelamento técnico da extensão do teste (cancela e recria a assinatura
         com o trial maior) — não é um cancelamento do cliente; ignora */
      if (event === "subscription.canceled" && data.cancelReason === "extensao_teste_30d")
        return res.status(200).json({ ok: true, ignorado: "extensao_teste" });
      /* trava de moeda: só ATIVA a licença se a fatura foi cobrada em dólar.
         invoiceCurrency só existe nos eventos activated/reactivated; eventos de
         bloqueio (past_due/canceled) passam sempre — revogar acesso é seguro.
         Responde 200 mesmo assim: 4xx faria o Commet reentregar para sempre. */
      const moedaFatura = String(data.invoiceCurrency || "").toLowerCase();
      if (STATUS_ASSINATURA[event] === "ativa" && moedaFatura && moedaFatura !== "usd") {
        console.error(`[commet/webhook] evento ${event} do condomínio ${data.customerId} IGNORADO: fatura em ${moedaFatura}, esperado usd.`);
        return res.status(200).json({ ok: false, ignorado: "moeda_diferente_de_usd" });
      }
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
      /* licença reativada: apaga o aviso de cancelamento agendado (best-effort —
         update separado para não travar a ativação se a coluna não existir) */
      if (novo.status === "ativa")
        await supabase.from("saas_assinaturas")
          .update({ cancelamento_agendado_em: null, acesso_ate: null })
          .eq("condominio_id", data.customerId).neq("status", "cancelada");
    }

    return res.status(200).json({ ok: true }); // 200 rápido evita reentregas desnecessárias
  } catch (e) {
    console.error("[commet/webhook]", e);
    return res.status(500).json({ error: e.message });
  }
}
