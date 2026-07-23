/* POST /api/auth/condominio  (Authorization: Bearer <token do cadastro>)
   Primeiro acesso: cria o condomínio DA CONTA LOGADA — condomínio, pessoa do
   diretor, vínculo, perfil e assinatura em teste — e devolve um token novo já
   carimbado com o condominio_id, que passa a valer nas políticas de RLS. */
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const b64u = (s) => Buffer.from(s).toString("base64url");
const assinarToken = (claims, secret) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role: "authenticated", iss: "condomaster",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, ...claims }));
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const lerToken = (token, secret) => {
  try {
    const [h, p, sig] = String(token || "").split(".");
    const esperada = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(esperada))) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (claims.exp && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch { return null; }
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const secret = envVal("SUPABASE_JWT_SECRET");
  const serviceKey = envVal("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !serviceKey)
    return res.status(503).json({ error: "Configure SUPABASE_JWT_SECRET e SUPABASE_SERVICE_ROLE_KEY no servidor." });

  const claims = lerToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""), secret);
  if (!claims?.sub) return res.status(401).json({ error: "Sessão inválida — entre de novo." });
  if (claims.condominio_id) return res.status(409).json({ error: "Esta conta já tem um condomínio." });

  const supabase = createClient(envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL, serviceKey);
  try {
    const f = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const TIPO = { Residencial: "residencial", Comercial: "comercial", Misto: "misto" };
    const PORTE = { "Alto padrão": "alto", "Médio padrão": "medio", "Baixo padrão": "baixo" };

    const { data: usuario, error: eU } = await supabase.from("usuarios")
      .select("id, email, pessoa_id").eq("id", claims.sub).maybeSingle();
    if (eU || !usuario) return res.status(401).json({ error: "Conta não encontrada — entre de novo." });

    const { data: cond, error: e1 } = await supabase.from("condominios").insert({
      nome_fantasia: f.nome, razao_social: f.razao || f.nome, cnpj: f.cnpj,
      endereco: { texto: f.endereco }, tipo: TIPO[f.tipo] || "residencial", porte: PORTE[f.porte] || "medio",
    }).select().single();
    if (e1) throw new Error(e1.message);

    const { data: pessoa, error: e2 } = await supabase.from("pessoas").insert({
      condominio_id: cond.id, nome: claims.nome || "Diretor", tipo_pessoa: "fisica",
      cpf_cnpj: f.cpf, email: usuario.email,
    }).select().single();
    if (e2) throw new Error(e2.message);

    await supabase.from("pessoa_vinculos").insert({
      condominio_id: cond.id, pessoa_id: pessoa.id, papel: "diretor",
      inicio: new Date().toISOString().slice(0, 10),
    });
    await supabase.from("usuarios").update({ pessoa_id: pessoa.id }).eq("id", usuario.id);
    const { data: perfil } = await supabase.from("perfis").select("id").eq("nome", "diretor").single();
    await supabase.from("usuario_perfis").insert({ usuario_id: usuario.id, condominio_id: cond.id, perfil_id: perfil.id });

    /* assinatura em teste no plano escolhido — o paywall cobra em seguida */
    const planoNome = String(f.plano || "Essencial").split(" —")[0].trim();
    let { data: plano } = await supabase.from("saas_planos").select("id").eq("nome", planoNome).maybeSingle();
    if (!plano) ({ data: plano } = await supabase.from("saas_planos").select("id").eq("nome", "Essencial").maybeSingle());
    if (plano) await supabase.from("saas_assinaturas").insert({
      condominio_id: cond.id, plano_id: plano.id, status: "teste",
      inicio: new Date().toISOString().slice(0, 10), forma_pagamento: "verum_pay",
    });

    const token = assinarToken({ sub: usuario.id, email: usuario.email, nome: claims.nome,
      perfil: "diretor", condominio_id: cond.id }, secret);
    return res.status(200).json({ condominioId: cond.id, token });
  } catch (e) {
    console.error("[auth/condominio]", e);
    return res.status(500).json({ error: e.message || "Erro ao criar o condomínio." });
  }
}
