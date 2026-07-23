/* POST /api/auth/registrar  { nome, email, senha }
   Cria a conta do diretor na tabela usuarios (senha com hash) e devolve o
   token de acesso. Roda no servidor com a service_role — com o RLS por
   condomínio ativo, o navegador não consegue mais criar contas sozinho. */
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "crypto";

const envVal = (k) => (process.env[k] && !process.env[k].startsWith("COLE_AQUI") ? process.env[k] : undefined);
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
    const nome = String(f.nome || "").trim();
    const email = String(f.email || "").trim().toLowerCase();
    const senha = String(f.senha || "");
    if (!nome || !email || senha.length < 4) return res.status(400).json({ error: "Informe nome, e-mail e senha (mínimo 4 caracteres)." });

    const { data: dup } = await supabase.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (dup) return res.status(409).json({ error: "Este e-mail já está cadastrado. Use a opção de entrar com e-mail e senha." });

    /* multi-tenant: a conta nasce sem vínculo — o condomínio DELA é criado
       no passo seguinte (/api/auth/condominio) */
    const senhaHash = createHash("sha256").update(senha).digest("hex");
    const { data: novo, error } = await supabase.from("usuarios")
      .insert({ email, senha_hash: senhaHash, pessoa_id: null }).select().single();
    if (error) throw new Error(error.message);

    const token = assinarToken({ sub: novo.id, email, nome, perfil: "diretor", condominio_id: null }, secret);
    return res.status(200).json({ token, conta: { nome, email, condominioId: null } });
  } catch (e) {
    console.error("[auth/registrar]", e);
    return res.status(500).json({ error: e.message || "Erro ao criar a conta." });
  }
}
