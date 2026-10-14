/* Sonda da rotação ATÔMICA do refresh token (corrida de renovação).

   O caso real (produção, 14/10/2026): dois timers de renovação acordando
   juntos disparavam dois POST /api/auth/refresh com o MESMO cookie; o
   perdedor caía na detecção anti-roubo e revogava a família inteira — a
   pessoa era deslogada no servidor e o app ficava preso no ErrorState.

   O que se prova aqui, contra o dev server (localhost:5173) e o condomínio
   TESTE Manuais:
   · A: login do diretor emite token + cookie cm_refresh;
   · B: DOIS refresh simultâneos com o mesmo cookie → exatamente um 200 e um
     401; UMA só sessão filha criada (CAS); família segue sem revogação; o
     cookie do vencedor continua rotacionando normalmente;
   · C: replay TARDIO (usado_em forçado a 60s atrás, além da graça de 30s)
     → 401, família INTEIRA revogada e cookie limpo — o anti-roubo fica;
   · D: a ponta da cadeia morre junto (família revogada) → 401;
   · E: sem cookie → 401;
   · F: o reuso tardio foi auditado (auditoria_eventos; pula sem a tabela).

   A família usada é criada pela própria sonda e termina revogada (estado
   final limpo — ninguém mais usa esses tokens). */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BASE = process.env.BASE || "http://localhost:5173";
const EMAIL_DIRETOR = "diretor.manuais@teste.condomaster.dev";
const SENHA = "teste123";
const sha256 = (t) => createHash("sha256").update(t).digest("hex");

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* POST que devolve também os Set-Cookie (o refresh vive num cookie HttpOnly) */
const post = async (rota, body, { cookie } = {}) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const setCookies = r.headers.getSetCookie?.() || [];
  const refreshCookie = setCookies.map((c) => c.match(/^cm_refresh=([^;]*)/)).find(Boolean)?.[1] ?? null;
  return { http: r.status, corpo: await r.json().catch(() => ({})), setCookies, refreshCookie };
};
const refresh = (token) => post("auth/refresh", null, { cookie: token == null ? undefined : `cm_refresh=${token}` });
const sessoesDe = async (familia) => (await admin.from("auth_sessoes")
  .select("id, token_hash, usado_em, revogada").eq("familia", familia).order("criado_em")).data || [];

const inicio = new Date().toISOString();

/* ── A: login emite token + refresh cookie ───────────────────────────── */
const lg = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
ok("A1 login do diretor Manuais (200 + JWT)", lg.http === 200 && !!lg.corpo.token, `http ${lg.http}`);
const c0 = lg.refreshCookie;
ok("A2 cookie cm_refresh emitido no login", !!c0);
if (!c0) { console.log("\nSem cookie não há o que sondar — rode o dev server (npm run dev) e o supabase-seguranca.sql."); process.exit(1); }

const { data: linhaC0 } = await admin.from("auth_sessoes")
  .select("familia").eq("token_hash", sha256(c0)).maybeSingle();
ok("A3 sessão do cookie registrada em auth_sessoes", !!linhaC0);
const familia = linhaC0?.familia;

/* ── B: corrida — dois refresh SIMULTÂNEOS com o mesmo cookie ────────── */
const [r1, r2] = await Promise.all([refresh(c0), refresh(c0)]);
const statuses = [r1.http, r2.http].sort();
ok("B1 exatamente um vence (200) e um perde (401)", statuses[0] === 200 && statuses[1] === 401, `httpS ${statuses.join(",")}`);
const vencedor = r1.http === 200 ? r1 : r2;
const perdedor = r1.http === 200 ? r2 : r1;
ok("B2 vencedor recebe JWT novo + cookie novo", !!vencedor.corpo.token && !!vencedor.refreshCookie);
ok("B3 perdedor NÃO mexe no cookie (sem Set-Cookie)", perdedor.setCookies.length === 0,
  `set-cookies: ${perdedor.setCookies.length}`);
let s = await sessoesDe(familia);
ok("B4 CAS: uma única sessão filha criada (2 linhas na família)", s.length === 2, `${s.length} linha(s)`);
ok("B5 duplicata benigna não revoga a família", s.every((x) => !x.revogada));
const c1 = vencedor.refreshCookie;
const r3 = await refresh(c1);
ok("B6 cookie do vencedor segue rotacionando (200)", r3.http === 200 && !!r3.refreshCookie, `http ${r3.http}`);
const c2 = r3.refreshCookie;

/* ── C: replay tardio (além da graça) = roubo → família inteira cai ──── */
await admin.from("auth_sessoes").update({ usado_em: new Date(Date.now() - 60_000).toISOString() })
  .eq("token_hash", sha256(c1));
const roubo = await refresh(c1);
ok("C1 replay tardio nega (401)", roubo.http === 401, `http ${roubo.http}`);
s = await sessoesDe(familia);
ok("C2 família inteira revogada", s.length === 3 && s.every((x) => x.revogada), `${s.filter((x) => x.revogada).length}/${s.length} revogadas`);
ok("C3 cookie limpo na resposta (Max-Age=0)", roubo.setCookies.some((c) => /^cm_refresh=;.*Max-Age=0/.test(c)));

/* ── D: a ponta da cadeia morre junto ────────────────────────────────── */
const ponta = await refresh(c2);
ok("D1 token da ponta (família revogada) nega (401)", ponta.http === 401, `http ${ponta.http}`);

/* ── E: sem cookie ───────────────────────────────────────────────────── */
const sem = await refresh(null);
ok("E1 refresh sem cookie nega (401)", sem.http === 401, `http ${sem.http}`);

/* ── F: trilha de auditoria do reuso tardio ──────────────────────────── */
const aud = await admin.from("auditoria_eventos").select("id").eq("evento", "sessao_reuso_detectado")
  .gte("quando", inicio).limit(5);
if (aud.error) pula("F1 evento sessao_reuso_detectado auditado", "auditoria_eventos ausente (supabase-seguranca3.sql)");
else ok("F1 evento sessao_reuso_detectado auditado", (aud.data || []).length >= 1, `${(aud.data || []).length} evento(s)`);

console.log(`\n${falhas === 0 ? "🎉 Rotação atômica de refresh: tudo verde" : `⚠️  ${falhas} falha(s)`}${puladas ? ` · ${puladas} pulada(s)` : ""}`);
process.exit(falhas === 0 ? 0 : 1);
