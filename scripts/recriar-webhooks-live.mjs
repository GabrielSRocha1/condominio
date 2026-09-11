/* Recria os webhook endpoints LIVE quando os secrets em uso se perderam
   (entregas 401 e "Reveal" da dashboard não bate com a assinatura real).
   Cria endpoints NOVOS nas mesmas URLs (a Stripe permite duplicata), grava
   os secrets novos em STRIPE_WEBHOOK_SECRET_LIVE / STRIPE_CONNECT_WEBHOOK_
   SECRET_LIVE no .env e mantém os antigos até você confirmar o corte.

   Uso:  node scripts/recriar-webhooks-live.mjs                (simulação)
         node scripts/recriar-webhooks-live.mjs --executar     (cria + grava no .env)
         node scripts/recriar-webhooks-live.mjs --apagar-antigos we_x we_y
           (depois de validar os novos: apaga os endpoints antigos citados)

   Após criar: cole os 2 valores _LIVE do .env na Vercel (Production) →
   Redeploy → valide (sonda/Resend) → rode --apagar-antigos. */
import Stripe from "stripe";
import { readFileSync, writeFileSync } from "node:fs";

const envURL = new URL("../.env", import.meta.url);
const env = Object.fromEntries(
  readFileSync(envURL, "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
if (!env.STRIPE_SECRET_KEY_LIVE?.startsWith("sk_live")) {
  console.error("STRIPE_SECRET_KEY_LIVE (sk_live_...) ausente no .env.");
  process.exit(1);
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY_LIVE);
const executar = process.argv.includes("--executar");
const apagar = process.argv.indexOf("--apagar-antigos");

if (apagar >= 0) {
  const ids = process.argv.slice(apagar + 1).filter((a) => /^we_[A-Za-z0-9]+$/.test(a));
  if (!ids.length) { console.error("Informe os ids we_... a apagar."); process.exit(1); }
  for (const id of ids) {
    const w = await stripe.webhookEndpoints.retrieve(id);
    await stripe.webhookEndpoints.del(id);
    console.log(`✔ apagado ${id} (${w.url})`);
  }
  process.exit(0);
}

const BASE = env.STRIPE_WEBHOOK_BASE || "https://condomaster.servenowglobal.com";
const HOOKS = [
  { url: `${BASE}/api/stripe/webhook`, connect: false, envVar: "STRIPE_WEBHOOK_SECRET_LIVE",
    events: ["checkout.session.completed", "customer.subscription.created",
      "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"] },
  { url: `${BASE}/api/stripe/webhook-connect`, connect: true, envVar: "STRIPE_CONNECT_WEBHOOK_SECRET_LIVE",
    events: ["account.updated", "checkout.session.completed",
      "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"] },
];

const existentes = await stripe.webhookEndpoints.list({ limit: 50 });
console.log("Endpoints live atuais (ficam até o --apagar-antigos):");
for (const w of existentes.data) console.log(`  ${w.id} | ${w.url} | ${w.status}`);

let conteudo = readFileSync(envURL, "utf8");
for (const h of HOOKS) {
  if (!executar) { console.log(`criaria endpoint novo em ${h.url} e gravaria o secret em ${h.envVar}`); continue; }
  const novo = await stripe.webhookEndpoints.create({
    url: h.url, enabled_events: h.events, connect: h.connect,
    description: "Recriado 11/09/2026 — secret do endpoint anterior perdido (entregas 401)",
  });
  const re = new RegExp(`(${h.envVar}=)\\S+`);
  if (re.test(conteudo)) conteudo = conteudo.replace(re, `$1${novo.secret}`);
  else conteudo = conteudo.replace(/(\r?\n)(# Prazo \(dias\))/, `$1${h.envVar}=${novo.secret}$1$2`);
  console.log(`✔ criado ${novo.id} → ${h.url}\n  secret novo gravado no .env em ${h.envVar}`);
}
if (executar) {
  writeFileSync(envURL, conteudo);
  console.log(`\nAgora: Vercel → Settings → Environment Variables (Production):
  STRIPE_WEBHOOK_SECRET         = valor de STRIPE_WEBHOOK_SECRET_LIVE do .env
  STRIPE_CONNECT_WEBHOOK_SECRET = valor de STRIPE_CONNECT_WEBHOOK_SECRET_LIVE do .env
  → Redeploy → valide as entregas → rode --apagar-antigos com os ids antigos acima.`);
} else console.log("\nSimulação — rode com --executar para efetivar.");
