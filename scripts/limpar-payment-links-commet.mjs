/* Cancela os payment links PENDENTES criados no Commet (testes antigos).
   O Commet não permite apagar o histórico: links pagos ou já cancelados
   permanecem no dashboard — pendente é o único estado cancelável.
   Uso:  node scripts/limpar-payment-links-commet.mjs           (só lista)
         node scripts/limpar-payment-links-commet.mjs --cancelar (cancela) */
import { Commet } from "@commet/node";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
if (!env.COMMET_API_KEY) { console.error("COMMET_API_KEY não encontrada no .env"); process.exit(1); }

const commet = new Commet({ apiKey: env.COMMET_API_KEY });
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
const executar = process.argv.includes("--cancelar");

/* lista tudo, paginando pelo cursor */
const links = [];
let cursor;
do {
  const pag = dado(await commet.payments.list({ limit: 100, ...(cursor ? { cursor } : {}) }));
  const itens = pag?.items || pag?.payments || (Array.isArray(pag) ? pag : []);
  links.push(...itens);
  cursor = pag?.nextCursor || pag?.cursor || null;
} while (cursor);

const fmt = (p) => `${p.id}  ${String(p.status).padEnd(10)} ${(p.currency || "").toUpperCase()} ${(p.amount / 100).toFixed(2).padStart(8)}  ${p.description || "—"}`;
console.log(`${links.length} payment link(s) no total:`);
for (const p of links) console.log("  " + fmt(p));

const pendentes = links.filter((p) => String(p.status).toLowerCase() === "pending");
if (!pendentes.length) { console.log("\nNenhum link pendente para cancelar."); process.exit(0); }

if (!executar) {
  console.log(`\n${pendentes.length} link(s) pendente(s) seriam cancelados. Rode com --cancelar para efetivar.`);
  process.exit(0);
}

console.log(`\nCancelando ${pendentes.length} link(s) pendente(s)…`);
for (const p of pendentes) {
  try { await commet.payments.cancel({ id: p.id }); console.log("  ✔ cancelado: " + fmt(p)); }
  catch (e) { console.log(`  ✖ falhou ${p.id}: ${e?.message || e}`); }
}
