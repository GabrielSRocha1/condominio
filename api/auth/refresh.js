/* POST /api/auth/refresh  (sem corpo — usa o cookie HttpOnly cm_refresh)
   Renova a sessão: valida e ROTACIONA o refresh token (auth_sessoes) e
   devolve um JWT de acesso novo (1h) com as claims RE-DERIVADAS do banco —
   se o perfil foi removido em Gerenciar Acessos, a renovação nega na hora
   (revogação de verdade, coisa que um JWT de 7 dias nunca teve).
   Reuso de um refresh já rotacionado = indício de roubo → derruba a família
   inteira de tokens. Respostas de falha são sempre 401 genéricas. */
import { createClient } from "@supabase/supabase-js";
import { assinarToken, rotacionarRefresh, revogarRefresh, origemBloqueada, logSeguro } from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const secret = envVal("SUPABASE_JWT_SECRET");
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_JWT_SECRET e SUPABASE_SERVICE_ROLE_KEY no servidor." });

  /* defesa extra anti-CSRF (SameSite=Strict já segura o grosso): Origin
     presente precisa estar na allowlist explícita (host da API + APP_ORIGINS) */
  if (origemBloqueada(req, res)) return;

  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);
  try {
    const sessao = await rotacionarRefresh(supabase, req, res);
    if (!sessao) return res.status(401).json({ error: "Sessão expirada — entre de novo." });

    const { data: usuario } = await supabase.from("usuarios")
      .select("id, email, pessoas(nome, pessoa_vinculos(papel, unidades(numero, blocos(nome)))), usuario_perfis(condominio_id, perfis(nome))")
      .eq("id", sessao.usuario_id).maybeSingle();
    if (!usuario) { await revogarRefresh(supabase, req, res); return res.status(401).json({ error: "Sessão expirada — entre de novo." }); }

    /* o vínculo que autorizou a sessão precisa continuar de pé */
    const aindaVale = sessao.condominio_id
      ? (usuario.usuario_perfis || []).some((up) =>
          up.perfis?.nome === sessao.perfil && up.condominio_id === sessao.condominio_id)
      : sessao.perfil === "diretor";
    if (!aindaVale) { await revogarRefresh(supabase, req, res); return res.status(401).json({ error: "Sessão expirada — entre de novo." }); }

    const nome = usuario.pessoas?.nome || (sessao.perfil === "diretor" ? "Diretor" : "");
    const token = assinarToken({
      sub: usuario.id, perfil: sessao.perfil, condominio_id: sessao.condominio_id,
      ...(sessao.perfil === "morador" ? { nome } : { email: usuario.email, nome }),
    }, secret);

    const vincUnidade = (usuario.pessoas?.pessoa_vinculos || []).find((v) => v.papel === "morador");
    return res.status(200).json({ token, conta: {
      nome, condominioId: sessao.condominio_id,
      ...(sessao.perfil === "morador"
        ? { unidade: vincUnidade?.unidades ? `${vincUnidade.unidades.numero}-${vincUnidade.unidades.blocos?.nome || "?"}` : null }
        : { email: usuario.email }),
    } });
  } catch (e) {
    logSeguro("[auth/refresh]", e);
    return res.status(500).json({ error: "Erro ao renovar a sessão." });
  }
}
