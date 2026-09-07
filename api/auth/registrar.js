/* POST /api/auth/registrar  { nome, email, senha }
   Cria a conta do diretor na tabela usuarios (senha com hash) e devolve o
   token de acesso. Roda no servidor com a service_role — com o RLS por
   condomínio ativo, o navegador não consegue mais criar contas sozinho.

   Blindagem (Etapa 1): payload validado, senha mínima de 8 caracteres com
   hash scrypt+salt, rate-limit de criação por IP (anti-spam de contas),
   JWT de 1h + refresh em cookie HttpOnly. */
import { createClient } from "@supabase/supabase-js";
import { corpoValidado } from "../_lib/validar.js";
import { assinarToken, gerarHashSenha, emitirRefresh, limitar, ipDoRequest, origemBloqueada, logSeguro } from "../_lib/seguranca.js";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const secret = envVal("SUPABASE_JWT_SECRET");
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_JWT_SECRET e SUPABASE_SERVICE_ROLE_KEY no servidor." });
  if (origemBloqueada(req, res)) return;
  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);

  try {
    const f = corpoValidado(res, typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}), {
      nome:  { tipo: "texto", max: 120, obrigatorio: true },
      email: { tipo: "email", obrigatorio: true },
      senha: { tipo: "texto", max: 200, obrigatorio: true },
    });
    if (!f) return;
    if (f.senha.length < 8)
      return res.status(400).json({ error: "A senha precisa de pelo menos 8 caracteres." });

    /* anti-spam: criação de conta limitada por IP */
    const ritmo = await limitar(supabase, `registrar:ip:${ipDoRequest(req)}`,
      { janelaSeg: 60 * 60, max: 10, bloqueioSeg: 60 * 60 });
    if (ritmo.bloqueado)
      return res.status(429).json({ error: "Muitas contas criadas deste endereço — tente mais tarde." });

    const { data: dup } = await supabase.from("usuarios").select("id").eq("email", f.email).maybeSingle();
    if (dup) return res.status(409).json({ error: "Este e-mail já está cadastrado. Use a opção de entrar com e-mail e senha." });

    /* multi-tenant: a conta nasce sem vínculo — o condomínio DELA é criado
       no passo seguinte (/api/auth/condominio) */
    const { data: novo, error } = await supabase.from("usuarios")
      .insert({ email: f.email, senha_hash: gerarHashSenha(f.senha), pessoa_id: null }).select().single();
    if (error) throw new Error(error.message);

    const token = assinarToken({ sub: novo.id, email: f.email, nome: f.nome, perfil: "diretor", condominio_id: null }, secret);
    await emitirRefresh(supabase, res, { usuarioId: novo.id, perfil: "diretor", condominioId: null });
    return res.status(200).json({ token, conta: { nome: f.nome, email: f.email, condominioId: null } });
  } catch (e) {
    logSeguro("[auth/registrar]", e);
    return res.status(500).json({ error: "Erro ao criar a conta." });
  }
}
