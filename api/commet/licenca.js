/* POST /api/commet/licenca  { condominioId }
   Confere no Commet se a assinatura da licença do condomínio está ativa e
   sincroniza o status no Supabase. É o caminho do botão "Já paguei — verificar"
   do paywall — funciona mesmo quando o webhook ainda não chegou (ou não
   alcança o servidor, como em desenvolvimento local). */
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const supabase = createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

/* o SDK ora devolve { success, data, error }, ora o objeto direto — normaliza */
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.COMMET_API_KEY || process.env.COMMET_API_KEY.startsWith("COLE_AQUI"))
    return res.status(503).json({ error: "COMMET_API_KEY não configurada no .env do servidor." });

  try {
    const { condominioId } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    /* o customer foi criado com externalId = condominioId */
    const assinatura = dado(await commet.subscriptions.getActive({ customerId: condominioId }).catch(() => null));

    /* active/trialing/past_due concedem acesso segundo o Commet; aqui o
       produto só libera com pagamento confirmado (active) */
    const ativa = assinatura?.status === "active";
    if (ativa) {
      const novo = { status: "ativa", bloqueada_em: null };
      if (assinatura.nextBillingDate || assinatura.endDate)
        novo.renovacao = String(assinatura.nextBillingDate || assinatura.endDate).slice(0, 10);
      const { error } = await supabase
        .from("saas_assinaturas")
        .update(novo)
        .eq("condominio_id", condominioId)
        .neq("status", "cancelada");
      if (error) throw new Error(error.message);
    }

    return res.status(200).json({ ativa, statusCommet: assinatura?.status || null });
  } catch (e) {
    console.error("[commet/licenca]", e);
    return res.status(500).json({ error: e.message || "Erro ao verificar a licença." });
  }
}
