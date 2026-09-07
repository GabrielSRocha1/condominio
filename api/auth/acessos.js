/* POST /api/auth/acessos  (Authorization: Bearer — SÓ diretor do condomínio)
   Gerenciar Acessos do condomínio, agora 100% no servidor:
     { acao: "criar",   perfil, nome?, email?, senha, unidadeId? }
     { acao: "listar" }
     { acao: "remover", usuarioId }

   Por que saiu do navegador: com escrita client-side em usuarios e
   usuario_perfis, qualquer perfil de gestão conseguia se promover a diretor
   e ler hashes de senha via supabase-js. Aqui a service role executa, mas a
   AUTORIZAÇÃO é conferida no topo (diretor do próprio condomínio), o perfil
   criável é whitelist (nunca "diretor") e a senha nasce em scrypt+salt. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import { lerClaimsReq, gerarHashSenha, origemBloqueada, prepararIdempotencia, logSeguro } from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const PERFIS_CRIAVEIS = ["sindico", "tesouraria", "morador"];

/* e-mail sintético do morador (entra pelo nome) — mesmo formato do frontend */
const emailMorador = (nome, condominioId) =>
  `morador+${nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".")}@${condominioId.slice(0, 8)}.local`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_SERVICE_ROLE_KEY no servidor." });

  const claims = lerClaimsReq(req);
  if (!claims?.condominio_id || claims.perfil !== "diretor")
    return res.status(403).json({ error: "Apenas o diretor gerencia os acessos." });
  if (origemBloqueada(req, res)) return;
  const condominioId = claims.condominio_id;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      acao:      { tipo: "enum", valores: ["criar", "listar", "remover"], obrigatorio: true },
      perfil:    { tipo: "enum", valores: PERFIS_CRIAVEIS },
      nome:      { tipo: "texto", max: 120 },
      email:     { tipo: "email" },
      senha:     { tipo: "texto", max: 200 },
      unidadeId: { tipo: "uuid" },
      usuarioId: { tipo: "uuid" },
    });
    if (!f) return;

    /* mutações (criar/remover) com retry de rede não podem duplicar */
    if (f.acao !== "listar") {
      const idem = await prepararIdempotencia(supabase, req, res,
        { usuarioId: claims.sub, rota: `auth/acessos:${f.acao}` });
      if (idem.repetida) return;
    }

    /* ── listar ── */
    if (f.acao === "listar") {
      const { data: rows, error } = await supabase.from("usuario_perfis")
        .select("perfis(nome), usuarios(id, email, pessoas(nome, pessoa_vinculos(papel, unidades(numero, blocos(nome)))))")
        .eq("condominio_id", condominioId);
      if (error) throw new Error(error.message);
      const acessos = (rows || [])
        .filter((r) => r.perfis?.nome && r.perfis.nome !== "diretor" && r.usuarios)
        .map((r) => {
          const u = r.usuarios, p = u.pessoas;
          const vinc = (p?.pessoa_vinculos || []).find((v) => v.papel === "morador");
          return {
            id: u.id, role: r.perfis.nome, nome: p?.nome || null,
            email: u.email.endsWith(".local") ? null : u.email,
            unidade: vinc?.unidades ? `${vinc.unidades.numero}-${vinc.unidades.blocos?.nome || "?"}` : null,
          };
        });
      return res.status(200).json({ acessos });
    }

    /* ── remover ── */
    if (f.acao === "remover") {
      if (!f.usuarioId) return res.status(400).json({ error: "Informe usuarioId." });
      /* o alvo precisa pertencer AO MEU condomínio e nunca ser um diretor */
      const { data: alvo } = await supabase.from("usuario_perfis")
        .select("id, perfis(nome)").eq("usuario_id", f.usuarioId).eq("condominio_id", condominioId);
      if (!alvo?.length) return res.status(404).json({ error: "Acesso não encontrado." });
      if (alvo.some((a) => a.perfis?.nome === "diretor"))
        return res.status(403).json({ error: "A conta do diretor não pode ser removida por aqui." });

      const { data: u } = await supabase.from("usuarios").select("pessoa_id").eq("id", f.usuarioId).maybeSingle();
      await supabase.from("auth_sessoes").update({ revogada: true }).eq("usuario_id", f.usuarioId)
        .then(() => {}, () => {}); // derruba sessões vivas do removido
      await supabase.from("usuario_perfis").delete().eq("usuario_id", f.usuarioId).eq("condominio_id", condominioId);
      const { error: eDel } = await supabase.from("usuarios").delete().eq("id", f.usuarioId);
      if (eDel) throw new Error(eDel.message);
      if (u?.pessoa_id) {
        await supabase.from("pessoa_vinculos").delete().eq("pessoa_id", u.pessoa_id).eq("condominio_id", condominioId);
        await supabase.from("pessoas").delete().eq("id", u.pessoa_id).then(() => {}, () => {}); // falha se referenciada — ok
      }
      return res.status(200).json({ ok: true });
    }

    /* ── criar ── */
    if (!f.perfil) return res.status(400).json({ error: "Informe o perfil do acesso." });
    const ehMorador = f.perfil === "morador";
    if (ehMorador && !f.nome) return res.status(400).json({ error: "Informe o nome do morador." });
    if (!ehMorador && !f.email) return res.status(400).json({ error: "Informe o e-mail do acesso." });
    if (!f.senha || f.senha.length < 8)
      return res.status(400).json({ error: "A senha precisa de pelo menos 8 caracteres." });

    const nome = ehMorador ? f.nome : f.email.split("@")[0];
    const email = ehMorador ? emailMorador(f.nome, condominioId) : f.email;

    const { data: dup } = await supabase.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (dup) return res.status(409).json({ error: ehMorador
      ? "Já existe um morador cadastrado com este nome." : "Já existe um acesso cadastrado com este e-mail." });

    if (f.unidadeId) {
      const { data: un } = await supabase.from("unidades")
        .select("id").eq("id", f.unidadeId).eq("condominio_id", condominioId).maybeSingle();
      if (!un) return res.status(404).json({ error: "Unidade não encontrada." });
    }

    const { data: pessoa, error: eP } = await supabase.from("pessoas").insert({
      condominio_id: condominioId, nome, tipo_pessoa: "fisica",
      cpf_cnpj: `P-${crypto.randomUUID().slice(0, 12)}`, email: ehMorador ? null : email,
    }).select().single();
    if (eP) throw new Error(eP.message);

    const { data: usuario, error: eU } = await supabase.from("usuarios").insert({
      pessoa_id: pessoa.id, email, senha_hash: gerarHashSenha(f.senha),
    }).select("id").single();
    if (eU) throw new Error(eU.message);

    const { data: perfil, error: ePf } = await supabase.from("perfis").select("id").eq("nome", f.perfil).single();
    if (ePf) throw new Error(ePf.message);
    const { error: eUp } = await supabase.from("usuario_perfis").insert({
      usuario_id: usuario.id, condominio_id: condominioId, perfil_id: perfil.id,
    });
    if (eUp) throw new Error(eUp.message);

    await supabase.from("pessoa_vinculos").insert({
      condominio_id: condominioId, pessoa_id: pessoa.id, unidade_id: f.unidadeId || null,
      papel: f.perfil, inicio: new Date().toISOString().slice(0, 10),
    });
    /* morador vinculado à unidade vira o responsável financeiro dela */
    if (ehMorador && f.unidadeId)
      await supabase.from("unidades").update({ responsavel_financeiro_id: pessoa.id }).eq("id", f.unidadeId);

    return res.status(200).json({ id: usuario.id });
  } catch (e) {
    logSeguro("[auth/acessos]", e);
    return res.status(500).json({ error: "Erro ao gerenciar os acessos." });
  }
}
