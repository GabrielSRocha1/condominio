/* RELATÓRIO DE SEGURANÇA — resumo da trilha de auditoria.
   Uso: node scripts/relatorio-seguranca.mjs [horas]   (padrão 24)
   Mostra: eventos por tipo, ocorrências de severidade ALTA (reuso de
   refresh token, revogações em massa), IPs com mais falhas de login e o
   movimento financeiro auditado (pagamentos/informes). */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const horas = Number(process.argv[2]) || 24;
const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

const { data: eventos, error } = await admin.from("auditoria_eventos")
  .select("quando, evento, severidade, usuario_id, condominio_id, ip, detalhe")
  .gte("quando", desde).order("quando", { ascending: false }).limit(5000);
if (error) {
  console.error(/does not exist|schema cache/i.test(error.message)
    ? "trilha de auditoria ausente — rode supabase-seguranca3.sql no SQL Editor"
    : error.message);
  process.exit(1);
}

console.log(`═══ Relatório de segurança — últimas ${horas}h (${eventos.length} eventos) ═══\n`);

/* contagem por evento */
const porEvento = {};
for (const e of eventos) porEvento[e.evento] = (porEvento[e.evento] || 0) + 1;
console.log("── eventos por tipo ──");
for (const [ev, n] of Object.entries(porEvento).sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(4)} × ${ev}`);

/* severidade alta em detalhe */
const altas = eventos.filter((e) => e.severidade === "alta");
console.log(`\n── severidade ALTA (${altas.length}) ──`);
for (const e of altas.slice(0, 20))
  console.log(`  ${e.quando.slice(0, 19)} ${e.evento} ip=${e.ip || "—"} ${JSON.stringify(e.detalhe || {})}`);
if (!altas.length) console.log("  nenhuma — nada indicando roubo de sessão ou ação de emergência");

/* IPs com mais falhas de login */
const falhasPorIp = {};
for (const e of eventos) if (e.evento === "login_falha" || e.evento === "login_bloqueado")
  falhasPorIp[e.ip || "—"] = (falhasPorIp[e.ip || "—"] || 0) + 1;
const topIps = Object.entries(falhasPorIp).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`\n── IPs com falhas de login ──`);
for (const [ip, n] of topIps) console.log(`  ${String(n).padStart(4)} × ${ip}`);
if (!topIps.length) console.log("  nenhuma falha de login no período");

/* movimento financeiro auditado */
const fin = eventos.filter((e) => ["pagamento_registrado", "informe_criado", "informe_confirmado", "informe_rejeitado"].includes(e.evento));
console.log(`\n── financeiro auditado (${fin.length}) ──`);
for (const e of fin.slice(0, 15))
  console.log(`  ${e.quando.slice(0, 19)} ${e.evento} ${JSON.stringify(e.detalhe || {}).slice(0, 90)}`);

/* sessões vivas agora */
const { data: vivas } = await admin.from("auth_sessoes")
  .select("id").eq("revogada", false).is("usado_em", null).gte("expira_em", new Date().toISOString());
console.log(`\n── sessões de refresh ativas agora: ${vivas?.length ?? "?"} ──`);
