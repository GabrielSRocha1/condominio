/* Prepara a conta Stripe para o CondoMaster (test mode ou live — depende da
   chave do .env):
     1. cria 1 product por plano do saas_planos e os preços BRL mensal/anual
        com lookup_key condomaster_<plano>_<ciclo>_brl (o backend resolve o
        preço por essa chave — nada de id hardcoded);
     2. cria o cupom-contêiner + promotion code PAGOMANUAL (código de
        ativação para pagamento manual — o backend usa o código só como
        autorização de uso único e cria a assinatura em modo send_invoice
        no valor cheio; o cupom nunca é aplicado como desconto. Códigos
        individuais por cliente: scripts/criar-codigo-ativacao.mjs);
     3. registra os 2 webhook endpoints (conta própria e Connect) e imprime
        os whsec_ — GUARDE-OS no .env e na Vercel (só aparecem uma vez).

   Uso:  node scripts/preparar-stripe-producao.mjs                    (simulação, chave do dia a dia)
         node scripts/preparar-stripe-producao.mjs --executar         (executa com STRIPE_SECRET_KEY)
         node scripts/preparar-stripe-producao.mjs --live [--executar]
           → usa STRIPE_SECRET_KEY_LIVE do .env (exige sk_live_) sem mexer na
             chave de teste usada pelo npm run dev. */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const executar = process.argv.includes("--executar");
const live = process.argv.includes("--live");
const chave = (live ? env.STRIPE_SECRET_KEY_LIVE : env.STRIPE_SECRET_KEY) || "";
const modo = chave.startsWith("sk_live") ? "LIVE" : chave.startsWith("sk_test") ? "TEST" : "desconhecido";
console.log(`Chave Stripe do .env (${live ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY"}): modo ${modo}`);
if (!chave) { console.error(`${live ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY"} ausente no .env.`); process.exit(1); }
if (live && modo !== "LIVE") { console.error("--live exige uma chave sk_live_ em STRIPE_SECRET_KEY_LIVE."); process.exit(1); }

const stripe = new Stripe(chave);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
const brl = (v) => `R$ ${Number(v).toFixed(2)}`;

/* ── 1. products + prices BRL por plano ── */
const { data: planosDb, error } = await sb.from("saas_planos")
  .select("nome, preco_mensal, preco_anual").eq("ativo", true).order("preco_mensal");
if (error) { console.error("Supabase:", error.message); process.exit(1); }
console.log("⚠ Os preços abaixo vêm de saas_planos — rode o RUN F do supabase-stripe.sql (valores BRL) ANTES deste script.");

for (const p of planosDb) {
  const chaveProduto = `condomaster_${slug(p.nome)}`;
  const precos = [["mensal", "month", Number(p.preco_mensal)]];
  if (Number(p.preco_anual) > 0) precos.push(["anual", "year", Number(p.preco_anual)]);

  /* product: reaproveitado pela metadata.plano_key */
  const busca = await stripe.products.search({ query: `metadata["plano_key"]:"${chaveProduto}"`, limit: 1 });
  let produto = busca.data[0] || null;
  if (produto) console.log(`  product ${chaveProduto}: já existe (${produto.id})`);
  else {
    console.log(`  product ${chaveProduto}: criar — "CondoMaster ${p.nome}"`);
    if (executar) produto = await stripe.products.create({
      name: `CondoMaster ${p.nome}`,
      metadata: { plano_key: chaveProduto },
    });
  }

  for (const [ciclo, intervalo, valor] of precos) {
    const lookup = `${chaveProduto}_${ciclo}_brl`;
    const centavos = Math.round(valor * 100);
    const lista = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
    const atual = lista.data[0];
    if (atual && atual.unit_amount === centavos && atual.currency === "brl") {
      console.log(`    price ${lookup}: já existe (${atual.id}, ${brl(valor)})`); continue;
    }
    console.log(`    price ${lookup}: ${atual ? `TROCAR ${brl(atual.unit_amount / 100)} → ` : "criar — "}${brl(valor)}/${ciclo} · trial 30d no checkout`);
    if (!executar || !produto) continue;
    const novo = await stripe.prices.create({
      product: produto.id, currency: "brl", unit_amount: centavos,
      recurring: { interval: intervalo },
      lookup_key: lookup, transfer_lookup_key: true, // migra a chave do preço antigo
    });
    /* desativa o preço substituído — assinaturas existentes nele continuam
       válidas; só não pode mais ser usado em checkouts novos */
    if (atual) await stripe.prices.update(atual.id, { active: false });
    console.log(`      ✔ criado ${novo.id}${atual ? ` (antigo ${atual.id} desativado)` : ""}`);
  }
}

/* ── 2. cupom-contêiner + promotion code PAGOMANUAL ──
   (o cupom existe porque a API exige um por trás de cada promotion code;
   o fluxo de ativação NÃO o aplica — assinatura sai no valor cheio) */
const CUPOM_ID = "condomaster-ativacao-100";
const CODIGO = "PAGOMANUAL";
let cupom = await stripe.coupons.retrieve(CUPOM_ID).catch(() => null);
if (cupom) console.log(`  cupom ${CUPOM_ID}: já existe (100% off, ${cupom.duration})`);
else {
  console.log(`  cupom ${CUPOM_ID}: criar — 100% off, forever`);
  if (executar) cupom = await stripe.coupons.create({
    id: CUPOM_ID, percent_off: 100, duration: "forever",
    name: "Código de ativação (pagamento manual)",
  });
}
const promos = await stripe.promotionCodes.list({ code: CODIGO, limit: 1 });
if (promos.data[0]) console.log(`  promotion code ${CODIGO}: já existe (${promos.data[0].id}, ativo: ${promos.data[0].active})`);
else {
  console.log(`  promotion code ${CODIGO}: criar (aponta para o cupom acima)`);
  if (executar && cupom) {
    /* API 2025+ : o cupom vai dentro de "promotion" (o parâmetro "coupon" saiu) */
    const promo = await stripe.promotionCodes.create({ promotion: { type: "coupon", coupon: CUPOM_ID }, code: CODIGO });
    console.log(`    ✔ criado ${promo.id}`);
  }
}

/* ── 3. webhooks (conta própria + Connect) ── */
const BASE = env.STRIPE_WEBHOOK_BASE || "https://condomaster.servenowglobal.com";
const HOOKS = [
  { url: `${BASE}/api/stripe/webhook`, connect: false, envVar: "STRIPE_WEBHOOK_SECRET",
    events: ["checkout.session.completed", "customer.subscription.created",
      "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"] },
  { url: `${BASE}/api/stripe/webhook-connect`, connect: true, envVar: "STRIPE_CONNECT_WEBHOOK_SECRET",
    events: ["account.updated", "checkout.session.completed",
      "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"] },
];
const existentes = await stripe.webhookEndpoints.list({ limit: 50 });
for (const h of HOOKS) {
  const ja = existentes.data.find((w) => w.url === h.url);
  if (ja) {
    console.log(`  webhook ${h.url}: já existe (${ja.id}) — ${executar ? "atualizando eventos (secret mantido)" : "atualizaria eventos"}`);
    if (executar) await stripe.webhookEndpoints.update(ja.id, { enabled_events: h.events });
  } else {
    console.log(`  webhook ${h.url}: criar (${h.connect ? "eventos de contas CONECTADAS" : "conta própria"}, ${h.events.length} eventos)`);
    if (executar) {
      const novo = await stripe.webhookEndpoints.create({ url: h.url, enabled_events: h.events, connect: h.connect });
      console.log(`    ✔ criado ${novo.id} — GUARDE O SECRET (só aparece uma vez):`);
      console.log(`    ${h.envVar}=${novo.secret}`);
    }
  }
}

if (!executar) console.log("\nSimulação — rode com --executar para efetivar.");
else console.log(`\nFalta (manual, dashboard):
  · Pagamentos → Métodos de pagamento: ativar Pix (conta BR exige solicitação) e cartões
  · Connect → Configurações: completar o platform profile e o branding do onboarding
  · Billing → Portal do cliente: salvar a configuração padrão (troca de cartão/faturas)
  · Colar os whsec_ acima no .env local e nas variáveis da Vercel`);
