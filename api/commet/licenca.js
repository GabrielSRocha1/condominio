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

    /* active = pagamento confirmado; trialing = teste gratuito em andamento
       (cartão salvo, nada cobrado ainda) — os dois liberam o acesso */
    const ativa = assinatura?.status === "active";
    const teste = assinatura?.status === "trialing";
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
      /* sem cancelamento agendado no Commet: apaga o aviso da tela Planos
         (best-effort — não trava a sincronização se a coluna não existir).
         Com cancelAtPeriodEnd o aviso permanece: a assinatura segue "active"
         até o fim do período, mas o cancelamento está marcado. */
      if (!assinatura.cancelAtPeriodEnd)
        await supabase.from("saas_assinaturas")
          .update({ cancelamento_agendado_em: null, acesso_ate: null })
          .eq("condominio_id", condominioId).neq("status", "cancelada");
    } else if (teste) {
      /* sincroniza o fim do teste — fallback para quando o webhook
         trial.started não alcança o servidor (ex.: desenvolvimento local) */
      const novo = { status: "teste" };
      if (assinatura.trialEndsAt) novo.teste_fim = String(assinatura.trialEndsAt).slice(0, 10);
      const { error } = await supabase
        .from("saas_assinaturas")
        .update(novo)
        .eq("condominio_id", condominioId)
        .neq("status", "cancelada");
      if (error) throw new Error(error.message);
    } else if (!assinatura) {
      /* o Commet NÃO tem assinatura NENHUMA para este cliente. Se a licença
         local ainda diz "ativa" (ou teste em andamento), ela foi cancelada
         por fora — ex.: no dashboard do Commet — e o webhook não alcançou
         este ambiente. Sincroniza o bloqueio aqui, no mesmo caminho do botão
         "Verificar pagamento". Conta pré-checkout (teste sem teste_fim) fica
         intocada, e assinatura pending_payment (checkout aberto aguardando
         pagamento) também — não é cancelamento, é reativação em andamento. */
      const { data: local } = await supabase
        .from("saas_assinaturas")
        .select("status, teste_fim")
        .eq("condominio_id", condominioId)
        .neq("status", "cancelada")
        .limit(1)
        .maybeSingle();
      if (local?.status === "ativa" || (local?.status === "teste" && local?.teste_fim)) {
        const { error } = await supabase
          .from("saas_assinaturas")
          .update({ status: "cancelada" })
          .eq("condominio_id", condominioId)
          .neq("status", "cancelada");
        if (error) throw new Error(error.message);
        return res.status(200).json({ ativa: false, teste: false, cancelada: true, statusCommet: assinatura?.status || null });
      }
    }

    return res.status(200).json({ ativa, teste, statusCommet: assinatura?.status || null });
  } catch (e) {
    console.error("[commet/licenca]", e);
    return res.status(500).json({ error: e.message || "Erro ao verificar a licença." });
  }
}
