/* POST /api/stripe/plano  { condominioId, plano }
   (Authorization: Bearer — diretor do condomínio)
   Upgrade/downgrade da licença SaaS: troca o plano da assinatura no banco
   (saas_assinaturas.plano_id). A cobrança do novo valor é feita em seguida
   por /api/stripe/assinatura (novo checkout ou troca na assinatura ativa). */
import { supabaseAdmin, corpoJson, lerClaims } from "./_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const supabase = supabaseAdmin();
  try {
    const { condominioId, plano } = corpoJson(req);
    if (!condominioId || !plano) return res.status(400).json({ error: "Informe condominioId e plano." });
    const claims = lerClaims(req);
    if (!claims || claims.condominio_id !== condominioId || claims.perfil !== "diretor")
      return res.status(401).json({ error: "Sessão inválida — entre de novo como diretor." });

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
    console.error("[stripe/plano]", e);
    return res.status(500).json({ error: e.message || "Erro ao trocar o plano." });
  }
}
