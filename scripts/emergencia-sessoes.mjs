/* RESPOSTA A INCIDENTE — revogação de sessões em massa.
   Derruba refresh tokens (auth_sessoes.revogada = true); os JWTs de acesso
   restantes morrem sozinhos em até 1h. Ninguém perde dados — só precisa
   logar de novo.

   Uso:
     node scripts/emergencia-sessoes.mjs --todas
     node scripts/emergencia-sessoes.mjs --usuario email@dominio.com
     node scripts/emergencia-sessoes.mjs --condominio <uuid>

   Quando usar: vazamento suspeito de token/segredo, conta comprometida,
   desligamento de colaborador com acesso, ou após rotacionar o
   SUPABASE_JWT_SECRET (ver SEGURANCA.md). */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const flag = (nome) => { const i = args.indexOf(nome); return i >= 0 ? (args[i + 1] ?? true) : null; };

let alvo = admin.from("auth_sessoes").update({ revogada: true }).eq("revogada", false);
let descricao;
if (flag("--todas") === true) {
  descricao = "TODAS as sessões";
} else if (typeof flag("--usuario") === "string") {
  const email = flag("--usuario");
  const { data: u } = await admin.from("usuarios").select("id").eq("email", email.toLowerCase()).maybeSingle();
  if (!u) { console.error(`usuário não encontrado: ${email}`); process.exit(1); }
  alvo = alvo.eq("usuario_id", u.id);
  descricao = `sessões de ${email}`;
} else if (typeof flag("--condominio") === "string") {
  alvo = alvo.eq("condominio_id", flag("--condominio"));
  descricao = `sessões do condomínio ${flag("--condominio")}`;
} else {
  console.log("Informe o alvo: --todas | --usuario <email> | --condominio <uuid>");
  process.exit(1);
}

const { data, error } = await alvo.select("id");
if (error) { console.error("falhou:", error.message); process.exit(1); }
console.log(`🔒 revogadas ${data?.length ?? 0} ${descricao} — relogin obrigatório; JWTs ativos expiram em até 1h.`);

await admin.from("auditoria_eventos").insert({
  evento: "revogacao_em_massa", severidade: "alta",
  detalhe: { alvo: descricao, sessoes: data?.length ?? 0, via: "emergencia-sessoes.mjs" },
}).then(({ error: e }) => { if (e) console.log("(auditoria não registrada — rode supabase-seguranca3.sql)"); });
