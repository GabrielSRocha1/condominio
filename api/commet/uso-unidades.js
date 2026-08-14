/* POST /api/commet/uso-unidades  { condominioId }
   Espelha no Commet o total de unidades ativas do condomínio (feature medida
   "UND", franquia por plano + excedente por unidade). O front chama após
   criar/excluir unidade; o Commet cobra o excedente automaticamente na
   fatura da assinatura — nada é bloqueado no app. */
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

/* code da feature de unidades no painel do Commet (exibida como "UND") */
const FEATURE_UNIDADES = envVal("COMMET_FEATURE_UNIDADES") || "100_unidades";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.COMMET_API_KEY || process.env.COMMET_API_KEY.startsWith("COLE_AQUI"))
    return res.status(503).json({ error: "COMMET_API_KEY não configurada no .env do servidor." });

  try {
    const { condominioId } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });

    /* total real de unidades ativas — o valor é sempre o espelho do cadastro,
       nunca um incremento (usage.set é idempotente por natureza) */
    const { count, error } = await supabase.from("unidades")
      .select("id", { count: "exact", head: true })
      .eq("condominio_id", condominioId)
      .is("deletado_em", null);
    if (error) throw new Error(error.message);

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    const cliente = dado(await commet.customers.get({ id: condominioId }).catch(() => null));
    /* condomínio ainda sem assinatura no Commet (teste não iniciado):
       nada a reportar — o próximo create/delete de unidade sincroniza */
    if (!cliente?.id) return res.status(200).json({ ok: false, motivo: "sem_cliente_commet", unidades: count || 0 });

    try {
      /* a feature pode ser do tipo "seats" (contagem, é o caso da UND) ou
         "usage" (medida) — resolve pelo cadastro e usa o recurso certo */
      const feats = dado(await commet.features.list().catch(() => null));
      const feat = (feats?.items || feats?.data || (Array.isArray(feats) ? feats : [])).find((f) => f.code === FEATURE_UNIDADES);
      if (feat?.type === "usage") {
        await commet.usage.set({ customerId: cliente.id, featureCode: FEATURE_UNIDADES, value: count || 0, reason: "sincronizacao_cadastro_unidades" });
      } else {
        /* seats: ajusta pela diferença — add rateia no período corrente,
           remove passa a valer no próximo ciclo (semântica padrão de cobrança) */
        const saldo = dado(await commet.seats.getBalance({ customerId: cliente.id, featureCode: FEATURE_UNIDADES }).catch(() => null));
        const atual = Number(saldo?.current ?? 0);
        const alvo = count || 0;
        if (alvo > atual) await commet.seats.add({ customerId: cliente.id, featureCode: FEATURE_UNIDADES, count: alvo - atual });
        else if (alvo < atual) await commet.seats.remove({ customerId: cliente.id, featureCode: FEATURE_UNIDADES, count: atual - alvo });
      }
    } catch (e) {
      /* assinatura sem a feature ou ainda não ativa — não interrompe o cadastro */
      console.error("[commet/uso-unidades] sincronização falhou:", e?.message || e);
      return res.status(200).json({ ok: false, motivo: "uso_nao_aceito", unidades: count || 0 });
    }

    console.log(`[commet/uso-unidades] condomínio ${condominioId} → ${count || 0} unidade(s) reportada(s) na feature ${FEATURE_UNIDADES}`);
    return res.status(200).json({ ok: true, unidades: count || 0 });
  } catch (e) {
    console.error("[commet/uso-unidades]", e);
    return res.status(500).json({ error: e.message || "Erro ao sincronizar o uso de unidades." });
  }
}
