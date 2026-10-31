/* Resolução da matriz de permissões no SERVIDOR.

   Mesma regra de src/lib/permissoes.js e de public.jwt_pode — as três
   implementações existem porque as três camadas decidem em momentos
   diferentes (UI esconde, API barra, banco impede), e as sondas de
   scripts/testar-permissoes.mjs provam que não divergem.

   Degrada ABERTO: sem o supabase-permissoes.sql no banco (coluna/tabela
   ausente, matriz vazia), cai no MATRIZ_PADRAO — que é exatamente o
   comportamento anterior à matriz. Nunca tranca o app. */
import { permsEfetivas, PERFIL_TUDO, CODIGOS } from "../../src/lib/permissoes.js";

/* Conjunto efetivo de um (perfil, condomínio). Devolve um Set de códigos. */
export async function carregarPerms(supabase, { perfil, condominioId = null }) {
  const p = String(perfil || "");
  if (p === PERFIL_TUDO) return new Set(CODIGOS); // anti-trava: diretor tem tudo
  const padrao = new Set(permsEfetivas({ perfil: p }));
  try {
    /* o override é declarado em perfil_overrides (não inferido da contagem):
       perfil zerado de propósito continua zerado */
    let temOverride = false;
    if (condominioId) {
      const { data: ov, error: eOv } = await supabase.from("perfil_overrides")
        .select("id, perfis!inner(nome)").eq("condominio_id", condominioId)
        .eq("perfis.nome", p).maybeSingle();
      if (eOv) throw new Error(eOv.message); // tabela ausente cai no catch → padrão
      temOverride = !!ov;
    }
    let q = supabase.from("perfil_permissoes")
      .select("permissoes!inner(codigo), perfis!inner(nome)")
      .eq("perfis.nome", p);
    q = temOverride ? q.eq("condominio_id", condominioId) : q.is("condominio_id", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    /* sem override e sem linhas de padrão = SQL não rodado → degrada aberto.
       Com override, lista vazia é legítima (perfil zerado). */
    if (!temOverride && !data?.length) return padrao;
    return new Set((data || []).map((r) => r.permissoes?.codigo).filter(Boolean));
  } catch (e) {
    console.error("[permissoes] matriz indisponível (rode supabase-permissoes.sql?):", e.message);
    return padrao;
  }
}

export const semMatriz = (e) =>
  !!e && /does not exist|schema cache|column .* does not exist/i.test(e.message || "");

/* Guarda de endpoint. Uso:
     const perms = await carregarPerms(supabase, claims);
     if (!perms.has("acesso.gerir")) return res.status(403).json({ error: … });
   `exigir` encurta o caso comum e já responde o 403. */
export function exigir(res, perms, codigo, mensagem) {
  if (perms.has(codigo)) return false;
  res.status(403).json({ error: mensagem || "Seu perfil não tem permissão para esta ação." });
  return true;
}

/* claims → { perfil, condominioId } no formato que carregarPerms espera */
export const doClaims = (claims) =>
  ({ perfil: claims?.perfil, condominioId: claims?.condominio_id || null });

/* atalho de uma linha para o caso de UMA permissão só */
export const temPerm = async (supabase, claims, codigo) =>
  (await carregarPerms(supabase, doClaims(claims))).has(codigo);
