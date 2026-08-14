/* Prepara o ambiente LIVE do Commet para produção:
     1. cria os 3 planos condomaster_*_usd (preços do saas_planos do Supabase,
        trialDays 30 nos preços mensal e anual) — se ainda não existirem;
     2. registra o webhook com os 9 eventos e imprime o whsec_ novo.
   Depois, no dashboard live (não migra do sandbox): montar o Plan Group
   (Essencial → Standard → Premium) e anexar a feature de unidades aos 3
   planos com franquias 100/500/2000 e excedente por unidade.

   Uso:  node scripts/preparar-commet-producao.mjs            (só mostra o plano)
         node scripts/preparar-commet-producao.mjs --executar (executa)
   Lê COMMET_API_KEY do .env — rode APÓS trocar para a chave ck_live_. */
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const executar = process.argv.includes("--executar");
const chave = env.COMMET_API_KEY || "";
const modo = chave.startsWith("ck_live") ? "LIVE" : chave.startsWith("ck_sandbox") ? "SANDBOX" : "desconhecido";
console.log(`Chave Commet do .env: modo ${modo}`);
if (modo !== "LIVE") console.log("⚠ ATENÇÃO: a chave não é ck_live_ — isto vai preparar o ambiente " + modo + ".");

const commet = new Commet({ apiKey: chave });
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

const { data: planosDb, error } = await sb.from("saas_planos")
  .select("nome, preco_mensal, preco_anual").eq("ativo", true).order("preco_mensal");
if (error) { console.error("Supabase:", error.message); process.exit(1); }

const existentes = dado(await commet.plans.list({ includePrivate: true })) || [];
for (const p of planosDb) {
  const codigo = `condomaster_${slug(p.nome)}_usd`;
  const nome = `CondoMaster ${p.nome} (USD)`;
  const ja = existentes.find((x) => x.code === codigo || x.name === nome);
  if (ja) { console.log(`  plano ${codigo}: já existe (${ja.id})`); continue; }
  console.log(`  plano ${codigo}: criar — mensal $${p.preco_mensal}${p.preco_anual ? ` · anual $${p.preco_anual}` : ""} · trial 30d`);
  if (!executar) continue;
  const novo = dado(await commet.plans.create({ name: nome, code: codigo, isPublic: false }));
  await commet.plans.addPrice({ id: novo.id, billingInterval: "monthly",
    price: Math.round(Number(p.preco_mensal) * 100), trialDays: 30, isDefault: true });
  if (Number(p.preco_anual) > 0)
    await commet.plans.addPrice({ id: novo.id, billingInterval: "yearly",
      price: Math.round(Number(p.preco_anual) * 100), trialDays: 30 });
  console.log(`    ✔ criado ${novo.id}`);
}

const URL_HOOK = "https://administracion.mastter.digital/api/commet/webhook";
const EVENTOS = ["subscription.activated","subscription.reactivated","subscription.plan_changed",
  "trial.started","trial.will_end","trial.expired","trial.converted",
  "subscription.past_due","subscription.canceled"];
const hooks = dado(await commet.webhooks.list({ limit: 50 }).catch(() => null));
const itens = hooks?.items || hooks?.data || (Array.isArray(hooks) ? hooks : []);
const hookJa = itens.find((w) => w.url === URL_HOOK);
if (hookJa) {
  console.log(`  webhook: já existe (${hookJa.id}) — ${executar ? "atualizando eventos (secret mantido)" : "atualizaria eventos"}`);
  if (executar) await commet.webhooks.update({ id: hookJa.id, events: EVENTOS });
} else {
  console.log(`  webhook: criar em ${URL_HOOK} com ${EVENTOS.length} eventos`);
  if (executar) {
    const novo = dado(await commet.webhooks.create({ url: URL_HOOK, events: EVENTOS, description: "CondoMaster licença SaaS" }));
    console.log(`    ✔ criado ${novo?.id} — GUARDE O SECRET no .env e na Vercel (só aparece uma vez):`);
    console.log(`    COMMET_WEBHOOK_SECRET=${novo?.secret || "(não devolvido)"}`);
  }
}
if (!executar) console.log("\nSimulação — rode com --executar para efetivar.");
else console.log("\nFalta (manual, dashboard live): Plan Group + feature de unidades (franquias 100/500/2000, excedente) + moeda USD + KYC/payouts.");
