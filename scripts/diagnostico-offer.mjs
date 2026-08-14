/* Diagnóstico do erro "This code can't be used with this plan" na ativação
   por código (Offer PAGOMANUAL).
   Cruza três coisas, SEM alterar nada no Commet:
     1. todos os planos existentes no Commet (id, code, name, preços) —
        apontando duplicados de nome/code;
     2. qual planId o backend (api/commet/assinatura.js) escolheria para cada
        plano do Supabase (mesmo lookup: code condomaster_<slug>_usd ou nome);
     3. a(s) Offer(s)/promo code cadastradas e a quais planIds se aplicam.
   Se o planId do passo 2 não estiver na lista do passo 3, achamos a causa.

   Uso:  node scripts/diagnostico-offer.mjs
         node scripts/diagnostico-offer.mjs --offer ofr_XXXX   (id direto)
   Lê COMMET_API_KEY do .env. */
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const chave = env.COMMET_API_KEY || "";
const modo = chave.startsWith("ck_live") ? "LIVE" : chave.startsWith("ck_sandbox") ? "SANDBOX" : "desconhecido";
console.log(`Chave Commet do .env: modo ${modo}\n`);

const commet = new Commet({ apiKey: chave });
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
const argOffer = process.argv[process.argv.indexOf("--offer") + 1];

/* ── 1. planos no Commet ── */
const planos = dado(await commet.plans.list({ includePrivate: true })) || [];
console.log(`── ${planos.length} plano(s) no Commet ──`);
for (const p of planos) {
  const precos = (p.prices || []).map((pr) =>
    `${pr.billingInterval || "?"} $${(pr.price ?? 0) / 100}${pr.trialDays ? ` trial ${pr.trialDays}d` : ""}`).join(" · ");
  console.log(`  ${p.id}  code=${p.code || "—"}  "${p.name}"  [${precos}]`);
}
const porNome = {};
for (const p of planos) (porNome[p.name] = porNome[p.name] || []).push(p.id);
for (const [nome, ids] of Object.entries(porNome))
  if (ids.length > 1) console.log(`  ⚠ nome duplicado: "${nome}" → ${ids.join(", ")}`);

/* ── 2. lookup do backend por plano do Supabase ── */
const { data: planosDb, error } = await sb.from("saas_planos")
  .select("nome").eq("ativo", true).order("preco_mensal");
if (error) { console.error("Supabase:", error.message); process.exit(1); }
console.log("\n── planId que o backend usaria (mesmo lookup de assinatura.js) ──");
const idsBackend = {};
for (const { nome } of planosDb) {
  const codigo = `condomaster_${slug(nome)}_usd`;
  const nomeCommet = `CondoMaster ${nome} (USD)`;
  const escolhido = planos.find((p) => p.code === codigo || p.name === nomeCommet);
  idsBackend[nome] = escolhido?.id || null;
  console.log(`  ${nome}: ${escolhido ? `${escolhido.id} (code=${escolhido.code || "—"})` : "NÃO ENCONTRADO"}`);
}

/* ── 3. offers / promo codes ── */
console.log("\n── offers/promo codes no Commet ──");
const tentativas = [
  ["offers.list", () => commet.offers?.list?.({ limit: 50 })],
  ["offers.get(--offer)", () => (argOffer ? commet.offers?.get?.({ id: argOffer }) : null)],
  ["promoCodes.list", () => commet.promoCodes?.list?.({ limit: 50 })],
  ["coupons.list", () => commet.coupons?.list?.({ limit: 50 })],
];
let offers = [];
for (const [rotulo, fn] of tentativas) {
  try {
    const r = dado(await fn?.());
    if (!r) continue;
    const lista = r.items || r.data || (Array.isArray(r) ? r : [r]);
    if (lista.length) { console.log(`  via ${rotulo}:`); offers = offers.concat(lista); }
    for (const o of lista) console.log("   ", JSON.stringify(o).slice(0, 600));
  } catch (e) { console.log(`  ${rotulo}: ${e.message?.slice(0, 120)}`); }
}
if (!offers.length) console.log("  (nenhuma API de offers respondeu — compare manualmente com o dashboard)");

/* ── 4. cruzamento ── */
console.log("\n── cruzamento ──");
for (const o of offers) {
  const aplicaA = o.planIds || o.plans || o.appliesTo || o.applicable_plans || [];
  const ids = (Array.isArray(aplicaA) ? aplicaA : []).map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean);
  if (!ids.length) { console.log(`  offer ${o.id || o.code || "?"}: sem lista de planos legível na resposta`); continue; }
  for (const [nome, id] of Object.entries(idsBackend)) {
    const ok = id && ids.includes(id);
    console.log(`  offer ${o.promoCode || o.code || o.id} × plano ${nome} (${id || "?"}): ${ok ? "✔ coberto" : "✘ NÃO coberto"}`);
  }
}
console.log("\nSe algum plano aparecer como NÃO coberto (ou houver nome duplicado acima),");
console.log("anexe a Offer, no dashboard, exatamente aos planIds listados na seção 2.");
