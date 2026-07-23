/* POST /api/auth/login  { perfil, email?, nome?, senha }
   Confere as credenciais na tabela usuarios (morador entra pelo nome; os
   demais pelo e-mail) e devolve o token com o condomínio da conta — é esse
   token que o RLS usa para liberar apenas os dados do próprio prédio. */
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "crypto";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const b64u = (s) => Buffer.from(s).toString("base64url");
const assinarToken = (claims, secret) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role: "authenticated", iss: "condomaster",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, ...claims }));
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const secret = envVal("SUPABASE_JWT_SECRET");
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_JWT_SECRET e SUPABASE_SERVICE_ROLE_KEY no servidor." });
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const perfil = String(f.perfil || "");
    const senhaHash = createHash("sha256").update(String(f.senha || "")).digest("hex");
    const nega = () => res.status(401).json({ error: "Credenciais incorretas." });

    /* morador entra pelo nome cadastrado em Gerenciar Emails */
    if (perfil === "morador") {
      const nome = String(f.nome || "").trim();
      const { data: rows, error } = await supabase.from("usuarios")
        .select("id, senha_hash, pessoas!inner(nome, pessoa_vinculos(papel, unidades(numero, blocos(nome)))), usuario_perfis(condominio_id, perfis(nome))")
        .ilike("pessoas.nome", nome);
      if (error) throw new Error(error.message);
      const conta = (rows || []).find((r) => r.senha_hash === senhaHash &&
        (r.usuario_perfis || []).some((up) => up.perfis?.nome === "morador"));
      if (!conta) return nega();
      const vincPerfil = conta.usuario_perfis.find((up) => up.perfis?.nome === "morador");
      const vincUnidade = (conta.pessoas?.pessoa_vinculos || []).find((v) => v.papel === "morador");
      const token = assinarToken({ sub: conta.id, nome: conta.pessoas.nome, perfil: "morador",
        condominio_id: vincPerfil?.condominio_id || null }, secret);
      return res.status(200).json({ token, conta: {
        nome: conta.pessoas.nome, condominioId: vincPerfil?.condominio_id || null,
        unidade: vincUnidade?.unidades ? `${vincUnidade.unidades.numero}-${vincUnidade.unidades.blocos?.nome || "?"}` : null,
      } });
    }

    /* demais perfis entram pelo e-mail */
    const email = String(f.email || "").trim().toLowerCase();
    const { data, error } = await supabase.from("usuarios")
      .select("id, email, senha_hash, pessoas(nome), usuario_perfis(condominio_id, perfis(nome))")
      .eq("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.senha_hash !== senhaHash) return nega();

    let vinculo = (data.usuario_perfis || []).find((up) => up.perfis?.nome === perfil);
    /* diretor recém-cadastrado (sem perfil ainda) também é diretor */
    if (!vinculo && !(perfil === "diretor" && !(data.usuario_perfis || []).length)) return nega();

    const nome = data.pessoas?.nome || "Diretor";
    const token = assinarToken({ sub: data.id, email, nome, perfil,
      condominio_id: vinculo?.condominio_id || null }, secret);
    return res.status(200).json({ token, conta: { nome, email, condominioId: vinculo?.condominio_id || null } });
  } catch (e) {
    console.error("[auth/login]", e);
    return res.status(500).json({ error: e.message || "Erro ao entrar." });
  }
}
