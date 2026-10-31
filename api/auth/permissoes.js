/* POST /api/auth/permissoes  (Authorization: Bearer — SÓ diretor do condomínio)
   Editor da matriz de permissões (Gerenciar Acessos → aba Permissões):
     { acao: "listar" }                    → catálogo + conjunto efetivo de cada perfil
     { acao: "salvar",    perfil, perms }  → grava o override DESTE condomínio
     { acao: "restaurar", perfil }         → apaga o override (volta ao padrão do SaaS)

   Por que só o diretor: editar a matriz é o caminho mais curto para um
   perfil se promover a tudo, então `permissao.gerir` não é delegável — nem
   aqui, nem em public.jwt_pode (que devolve false para esse código a quem
   não é diretor). A escrita passa pela service role porque perfil_overrides
   e perfil_permissoes ficam fora da policy de escrita por tabela,
   justamente para o navegador não alcançá-las.

   O override SUBSTITUI o padrão (não soma): desmarcar tira de verdade. Uma
   lista vazia é legítima — o perfil fica zerado — e é por isso que a
   existência do override vive em perfil_overrides, não na contagem de
   linhas de perfil_permissoes. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import {
  lerClaimsReq, origemBloqueada, prepararIdempotencia, logSeguro, auditar, ipDoRequest,
} from "../_lib/seguranca.js";
import {
  PERMISSOES, PERFIS_EDITAVEIS, PERMISSOES_FIXAS, permsPadrao, sanearPerms, mesmoConjunto,
} from "../../src/lib/permissoes.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const semMatriz = (e) => /does not exist|schema cache/i.test(e?.message || "");
const RECADO_SQL = "A matriz de permissões ainda não existe no banco — rode supabase-permissoes.sql no SQL Editor.";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });

  const claims = lerClaimsReq(req);
  if (!claims?.condominio_id || claims.perfil !== "diretor")
    return res.status(403).json({ error: "Apenas o diretor edita as permissões." });
  if (origemBloqueada(req, res)) return;
  const condominioId = claims.condominio_id;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const bruto = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const f = corpoValidado(res, bruto, {
      acao:   { tipo: "enum", valores: ["listar", "salvar", "restaurar"], obrigatorio: true },
      perfil: { tipo: "enum", valores: PERFIS_EDITAVEIS },
    });
    if (!f) return;
    if (f.acao !== "listar" && !f.perfil)
      return res.status(400).json({ error: "Informe o perfil." });

    /* ids dos perfis editáveis (uma consulta serve para as três ações) */
    const { data: perfis, error: ePf } = await supabase.from("perfis")
      .select("id, nome").in("nome", PERFIS_EDITAVEIS);
    if (ePf) throw new Error(ePf.message);
    const idDoPerfil = new Map((perfis || []).map((p) => [p.nome, p.id]));

    /* ── listar ── */
    if (f.acao === "listar") {
      let overrides = [], linhas = [];
      try {
        const [ov, ln] = await Promise.all([
          supabase.from("perfil_overrides").select("perfil_id").eq("condominio_id", condominioId),
          supabase.from("perfil_permissoes")
            .select("perfil_id, condominio_id, permissoes!inner(codigo)")
            .eq("condominio_id", condominioId),
        ]);
        if (ov.error) throw new Error(ov.error.message);
        if (ln.error) throw new Error(ln.error.message);
        overrides = ov.data || []; linhas = ln.data || [];
      } catch (e) {
        /* sem o SQL, a tela abre em modo leitura mostrando o padrão */
        if (!semMatriz(e)) throw e;
        return res.status(200).json({
          catalogo: PERMISSOES, fixas: PERMISSOES_FIXAS, editaveis: PERFIS_EDITAVEIS,
          semBanco: true, recado: RECADO_SQL,
          perfis: PERFIS_EDITAVEIS.map((p) => ({
            perfil: p, padrao: permsPadrao(p), efetivas: permsPadrao(p), temOverride: false })),
        });
      }
      const comOverride = new Set(overrides.map((o) => o.perfil_id));
      return res.status(200).json({
        catalogo: PERMISSOES, fixas: PERMISSOES_FIXAS, editaveis: PERFIS_EDITAVEIS,
        perfis: PERFIS_EDITAVEIS.map((nome) => {
          const pid = idDoPerfil.get(nome);
          const temOverride = !!pid && comOverride.has(pid);
          const doCond = linhas.filter((l) => l.perfil_id === pid)
            .map((l) => l.permissoes?.codigo).filter(Boolean);
          return {
            perfil: nome, padrao: permsPadrao(nome), temOverride,
            efetivas: temOverride ? doCond.sort() : permsPadrao(nome),
          };
        }),
      });
    }

    /* mutações: retry de rede não pode duplicar nem reordenar */
    const idem = await prepararIdempotencia(supabase, req, res,
      { usuarioId: claims.sub, rota: `auth/permissoes:${f.acao}:${f.perfil}` });
    if (idem.repetida) return;

    const perfilId = idDoPerfil.get(f.perfil);
    if (!perfilId) return res.status(400).json({ error: "Perfil desconhecido." });

    /* ── restaurar: tira o override e o perfil volta ao padrão do SaaS ── */
    if (f.acao === "restaurar") {
      try {
        await supabase.from("perfil_permissoes").delete()
          .eq("condominio_id", condominioId).eq("perfil_id", perfilId);
        const { error } = await supabase.from("perfil_overrides").delete()
          .eq("condominio_id", condominioId).eq("perfil_id", perfilId);
        if (error) throw new Error(error.message);
      } catch (e) {
        if (semMatriz(e)) return res.status(503).json({ error: RECADO_SQL });
        throw e;
      }
      await auditar(supabase, { evento: "permissoes_restauradas", severidade: "aviso",
        usuarioId: claims.sub, condominioId, ip: ipDoRequest(req),
        detalhe: { perfil: f.perfil } });
      return res.status(200).json({ ok: true, perfil: f.perfil, temOverride: false,
        efetivas: permsPadrao(f.perfil) });
    }

    /* ── salvar: substitui o conjunto do perfil neste condomínio ── */
    if (!Array.isArray(bruto.perms) || bruto.perms.length > 200)
      return res.status(400).json({ error: "Envie a lista de permissões." });
    const perms = sanearPerms(f.perfil, bruto.perms);

    try {
      const { data: cat, error: eCat } = await supabase.from("permissoes")
        .select("id, codigo").in("codigo", perms.length ? perms : ["__nenhuma__"]);
      if (eCat) throw new Error(eCat.message);
      const idDaPermissao = new Map((cat || []).map((p) => [p.codigo, p.id]));
      const faltando = perms.filter((c) => !idDaPermissao.has(c));
      if (faltando.length)
        return res.status(503).json({ error: `${RECADO_SQL} (faltam no catálogo: ${faltando.join(", ")})` });

      /* declara o override ANTES de trocar as linhas: se a troca falhar no
         meio, o pior caso é um override com menos permissões que o pedido —
         nunca um conjunto a mais do que o diretor autorizou */
      const { error: eOv } = await supabase.from("perfil_overrides")
        .upsert({ condominio_id: condominioId, perfil_id: perfilId, atualizado_em: new Date().toISOString() },
          { onConflict: "condominio_id,perfil_id" });
      if (eOv) throw new Error(eOv.message);

      const { error: eDel } = await supabase.from("perfil_permissoes").delete()
        .eq("condominio_id", condominioId).eq("perfil_id", perfilId);
      if (eDel) throw new Error(eDel.message);

      if (perms.length) {
        const { error: eIns } = await supabase.from("perfil_permissoes").insert(
          perms.map((c) => ({ condominio_id: condominioId, perfil_id: perfilId,
            permissao_id: idDaPermissao.get(c) })));
        if (eIns) throw new Error(eIns.message);
      }
    } catch (e) {
      if (semMatriz(e)) return res.status(503).json({ error: RECADO_SQL });
      throw e;
    }

    await auditar(supabase, { evento: "permissoes_alteradas", severidade: "aviso",
      usuarioId: claims.sub, condominioId, ip: ipDoRequest(req),
      detalhe: { perfil: f.perfil, perms, igualAoPadrao: mesmoConjunto(perms, permsPadrao(f.perfil)) } });

    return res.status(200).json({ ok: true, perfil: f.perfil, temOverride: true, efetivas: perms });
  } catch (e) {
    logSeguro("[auth/permissoes]", e);
    return res.status(500).json({ error: "Erro ao tratar as permissões." });
  }
}
