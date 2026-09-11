/* Cria um CÓDIGO DE ATIVAÇÃO de uso único para um cliente indicado
   (pagamento manual). O código autoriza a assinatura em modo send_invoice
   (valor cheio, fatura por e-mail, sem cartão) e é desativado
   automaticamente pelo backend no primeiro uso — um código por cliente.

   Uso:  node scripts/criar-codigo-ativacao.mjs PAGO-JOAO26 [dias-validade] [--live]
         (dias-validade opcional: o código expira sozinho se não for usado)

   Letras, números e hífens; maiúsculas recomendadas. Lê STRIPE_SECRET_KEY
   do .env — o código nasce no modo (test/live) da chave. Com --live usa
   STRIPE_SECRET_KEY_LIVE, sem precisar trocar a chave no .env. */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const args = process.argv.slice(2);
const live = args.includes("--live");
const [codigoArg, diasArg] = args.filter((a) => a !== "--live");
const codigo = String(codigoArg || "").trim().toUpperCase();
const dias = Number(diasArg) || 0;
if (!codigo || !/^[A-Z0-9-]{4,40}$/.test(codigo)) {
  console.error("Informe o código (4-40 caracteres, letras/números/hífen). Ex.: node scripts/criar-codigo-ativacao.mjs PAGO-JOAO26 30 [--live]");
  process.exit(1);
}

const chave = live ? env.STRIPE_SECRET_KEY_LIVE : env.STRIPE_SECRET_KEY;
if (live && !chave?.startsWith("sk_live")) {
  console.error("--live exige STRIPE_SECRET_KEY_LIVE (sk_live_...) no .env.");
  process.exit(1);
}
const stripe = new Stripe(chave);
console.log(`Chave Stripe do .env: modo ${chave?.startsWith("sk_live") ? "LIVE" : "TEST"}`);

/* o cupom é só o CONTÊINER exigido pela API para promotion codes existirem —
   o backend nunca o aplica como desconto (o código vira assinatura
   send_invoice no valor cheio) */
const CUPOM_ID = "condomaster-ativacao-100";
let cupom = await stripe.coupons.retrieve(CUPOM_ID).catch(() => null);
if (!cupom) cupom = await stripe.coupons.create({
  id: CUPOM_ID, percent_off: 100, duration: "forever",
  name: "Código de ativação (pagamento manual)",
});

const ja = await stripe.promotionCodes.list({ code: codigo, limit: 1 });
if (ja.data[0]) {
  console.error(`O código ${codigo} já existe (${ja.data[0].id}, ativo: ${ja.data[0].active}).`);
  process.exit(1);
}

const promo = await stripe.promotionCodes.create({
  promotion: { type: "coupon", coupon: CUPOM_ID },
  code: codigo,
  ...(dias > 0 ? { expires_at: Math.floor(Date.now() / 1000) + dias * 86400 } : {}),
});
console.log(`✔ código ${promo.code} criado (${promo.id})${dias > 0 ? ` — expira em ${dias} dia(s) se não for usado` : ""}`);
console.log("  Uso único: o backend desativa o código no primeiro resgate.");
console.log("  Entregue ao cliente indicado — ele informa em \"Tenho um código de ativação\" no paywall.");
