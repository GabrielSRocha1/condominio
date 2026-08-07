/* Teste manual: compara os planos da Commet (sandbox) com os saas_planos do
   Supabase e tenta gerar um checkout de assinatura de verdade.
   Uso: node scripts/teste-commet.mjs */
import { readFileSync } from "node:fs";
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";

/* carrega o .env na mão (script roda fora do Vite/Vercel) */
for (const linha of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("═══ 1. Planos no Supabase (saas_planos) ═══");
const { data: planosDb, error: e1 } = await supabase
  .from("saas_planos")
  .select("id, nome, preco_mensal, preco_anual, ativo");
if (e1) { console.error("Erro Supabase:", e1.message); process.exit(1); }
for (const p of planosDb) {
  console.log(`  ${p.nome}: mensal $${p.preco_mensal} · anual $${p.preco_anual} · ativo=${p.ativo}`);
}

console.log("\n═══ 2. Planos na Commet (sandbox) ═══");
const planosCommet = dado(await commet.plans.list({ includePrivate: true })) || [];
if (!planosCommet.length) console.log("  (nenhum plano na Commet ainda)");
for (const p of planosCommet) {
  const precos = (p.prices || p.planPrices || []).map(
    (pr) => `${pr.billingInterval}: ${(pr.price / 100).toFixed(2)} ${pr.currency || ""}`
  ).join(" · ");
  console.log(`  [${p.code || "sem code"}] ${p.name} — ${precos || JSON.stringify(p).slice(0, 200)}`);
}

console.log("\n═══ 3. Comparação site × Commet ═══");
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
for (const p of planosDb.filter((p) => p.ativo)) {
  const codigo = `condomaster_${slug(p.nome)}_usd`;
  const c = planosCommet.find((x) => x.code === codigo || x.name === `CondoMaster ${p.nome} (USD)`);
  if (!c) { console.log(`  ${p.nome}: ainda NÃO existe na Commet (será criado no 1º checkout)`); continue; }
  const precos = c.prices || c.planPrices || [];
  const m = precos.find((x) => x.billingInterval === "monthly");
  const a = precos.find((x) => x.billingInterval === "yearly");
  const okM = m && Math.round(Number(p.preco_mensal) * 100) === m.price;
  const okA = !Number(p.preco_anual) || (a && Math.round(Number(p.preco_anual) * 100) === a.price);
  console.log(`  ${p.nome}: mensal ${okM ? "OK" : `DIVERGE (site ${p.preco_mensal} × commet ${m ? m.price / 100 : "—"})`} · anual ${okA ? "OK" : `DIVERGE (site ${p.preco_anual} × commet ${a ? a.price / 100 : "—"})`}`);
}

console.log("\n═══ 4. Assinatura pendente para testar checkout ═══");
const { data: ass, error: e2 } = await supabase
  .from("saas_assinaturas")
  .select("id, status, condominio_id, condominios(nome_fantasia), saas_planos(nome)")
  .neq("status", "cancelada")
  .neq("status", "ativa")
  .limit(1)
  .maybeSingle();
if (e2) { console.error("Erro Supabase:", e2.message); process.exit(1); }
if (!ass) { console.log("  Nenhuma assinatura pendente encontrada — nada para testar."); process.exit(0); }
console.log(`  Condomínio: ${ass.condominios?.nome_fantasia} · plano ${ass.saas_planos?.nome} · status ${ass.status}`);

console.log("\n═══ 5. Chamando o handler /api/commet/assinatura ═══");
const { default: handler } = await import("../api/commet/assinatura.js");
const req = {
  method: "POST",
  body: { condominioId: ass.condominio_id, ciclo: "anual" },
  headers: { origin: "https://administracion.mastter.digital" },
};
const res = {
  statusCode: 200,
  status(c) { this.statusCode = c; return this; },
  json(obj) { this.resultado = obj; return this; },
};
await handler(req, res);
console.log(`  HTTP ${res.statusCode}:`, JSON.stringify(res.resultado, null, 2));

if (res.resultado?.checkoutUrl) {
  console.log("\n═══ 6. Acessando a página de pagamento ═══");
  const r = await fetch(res.resultado.checkoutUrl, { redirect: "follow" });
  const html = await r.text();
  const titulo = (html.match(/<title>(.*?)<\/title>/i) || [])[1];
  console.log(`  GET ${res.resultado.checkoutUrl}`);
  console.log(`  → HTTP ${r.status} · título da página: ${titulo || "(sem <title>)"} · ${html.length} bytes`);
}
