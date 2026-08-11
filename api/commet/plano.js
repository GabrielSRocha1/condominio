/* POST /api/commet/plano  { condominioId, plano }
   Upgrade/downgrade da licença SaaS: troca o plano da assinatura do condomínio
   no banco (saas_assinaturas.plano_id). A cobrança do novo plano é feita em
   seguida pelo checkout de /api/commet/assinatura (chamado pelo painel). */
import { createClient } from "@supabase/supabase-js";

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const supabase = createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  try {
    const { condominioId, plano } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!condominioId || !plano) return res.status(400).json({ error: "Informe condominioId e plano." });

    const { data: novo, error: eP } = await supabase
      .from("saas_planos").select("id, nome").eq("nome", plano).eq("ativo", true).maybeSingle();
    if (eP) throw new Error(eP.message);
    if (!novo) return res.status(404).json({ error: `Plano "${plano}" não encontrado.` });

    const { data: ass, error: eA } = await supabase
      .from("saas_assinaturas").select("id, plano_id, status")
      .eq("condominio_id", condominioId).neq("status", "cancelada").limit(1).maybeSingle();
    if (eA) throw new Error(eA.message);
    if (!ass) return res.status(404).json({ error: "Condomínio sem assinatura cadastrada." });
    if (ass.plano_id === novo.id) return res.status(200).json({ ok: true, plano: novo.nome, inalterado: true });

    const { error: eU } = await supabase.from("saas_assinaturas")
      .update({ plano_id: novo.id }).eq("id", ass.id);
    if (eU) throw new Error(eU.message);

    return res.status(200).json({ ok: true, plano: novo.nome });
  } catch (e) {
    console.error("[commet/plano]", e);
    return res.status(500).json({ error: e.message || "Erro ao trocar o plano." });
  }
}
