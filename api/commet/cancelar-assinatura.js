/* POST /api/commet/cancelar-assinatura  { condominioId }
   Cancela a assinatura da licença SaaS no Commet de forma AGENDADA: o acesso
   continua até o fim do período já pago (ou do teste) e nenhuma cobrança
   futura é feita. O webhook subscription.canceled marca a licença como
   "cancelada" quando o período termina. */
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

    const { data: ass, error } = await supabase
      .from("saas_assinaturas")
      .select("id, status")
      .eq("condominio_id", condominioId)
      .neq("status", "cancelada")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass) return res.status(404).json({ error: "Condomínio sem assinatura ativa para cancelar." });

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    const cliente = dado(await commet.customers.get({ id: condominioId }).catch(() => null));
    const atual = cliente?.id
      ? dado(await commet.subscriptions.getActive({ customerId: cliente.id }).catch(() => null))
      : null;
    if (!atual?.id) return res.status(409).json({ error: "Nenhuma assinatura em andamento no Commet para este condomínio." });

    /* pending_payment (checkout nunca concluído) não tem período pago — encerra
       na hora; trialing/active são agendados para o fim do período/teste */
    const imediato = atual.status === "pending_payment";
    const resp = dado(await commet.subscriptions.cancel({
      id: atual.id, immediate: imediato, reason: "cancelamento_cliente",
    }));

    const fim = resp?.endDate || resp?.currentPeriod?.end || atual.trialEndsAt || atual.currentPeriod?.end || null;
    const fimAcesso = fim ? String(fim).slice(0, 10) : null;

    /* persiste as datas para o aviso da tela Planos (voltam a NULL na reativação).
       Não-fatal: se a migração supabase-cancelamento.sql ainda não rodou, o
       cancelamento no Commet já aconteceu — só o aviso deixa de aparecer. */
    const { error: eUp } = await supabase.from("saas_assinaturas")
      .update({ cancelamento_agendado_em: new Date().toISOString().slice(0, 10), acesso_ate: fimAcesso })
      .eq("condominio_id", condominioId)
      .neq("status", "cancelada");
    if (eUp) console.error("[commet/cancelar-assinatura] datas do aviso não gravadas:", eUp.message);

    return res.status(200).json({ cancelada: true, imediato, fimAcesso });
  } catch (e) {
    console.error("[commet/cancelar-assinatura]", e);
    return res.status(500).json({ error: e.message || "Erro ao cancelar a assinatura." });
  }
}
