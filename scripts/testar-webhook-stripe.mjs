/* Sondas da AUTENTICAÇÃO DOS WEBHOOKS DA STRIPE (api/stripe/_lib/comum.js).

   Existe por causa de um incidente real: o webhook live ficou semanas
   devolvendo 401 e NENHUM evento de assinatura chegou ao banco (0 de 6 —
   cancelamento, inadimplência e troca de plano nunca sincronizaram). A
   causa era `lerCorpoBruto` reconstruir o corpo com JSON.stringify quando a
   plataforma já o havia parseado: a Stripe assina os BYTES, e re-serializar
   muda os bytes (1.0 volta 1, espaço some). Nenhuma sonda pegou porque em
   `npm run dev` o corpo chega como stream e o caminho certo roda — o defeito
   só existia em produção.

   Bloco U (puro, sem rede): lerCorpoBruto preserva bytes em cada forma de
   entrada e ADMITE quando os perdeu; autenticarEvento confere a assinatura
   quando há corpo e cai na confirmação pela Stripe quando não há.
   Bloco L (servidor local, opcional): o endpoint aceita payload assinado que
   NÃO sobrevive ao round-trip de JSON — a regressão exata do incidente.

   Uso: node scripts/testar-webhook-stripe.mjs   (bloco L exige npm run dev) */
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { lerCorpoBruto, autenticarEvento } from "../api/stripe/_lib/comum.js";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* req de mentira: stream (produção sem parser / dev) ou já parseado (Vercel) */
const reqStream = (texto, pedacos = 1) => {
  const b = Buffer.from(texto, "utf8");
  const tam = Math.ceil(b.length / pedacos);
  const partes = [];
  for (let i = 0; i < b.length; i += tam) partes.push(b.subarray(i, i + tam));
  const r = Readable.from(partes);
  r.headers = {};
  return r;
};

console.log("━━ U · corpo bruto e autenticação (puro) ━━");

/* 1 · stream de um pedaço só */
{
  const cru = '{"id":"evt_1","n":1.0}';
  ok("stream: bytes preservados", await lerCorpoBruto(reqStream(cru)) === cru);
}

/* 2 · multibyte PARTIDO entre chunks — o `data += chunk` antigo corrompia o
   caractere na emenda, e só aparecia em payload grande */
{
  const cru = '{"nome":"Consórcio Progreso — çãé 😀","v":1.0}';
  const lido = await lerCorpoBruto(reqStream(cru, 7));
  ok("stream: multibyte partido em 7 chunks", lido === cru,
    lido === cru ? `${Buffer.byteLength(cru)} bytes intactos` : `corrompeu: ${lido.slice(0, 40)}`);
}

/* 3 · corpo já parseado: tem de ADMITIR a perda, não inventar bytes */
{
  const req = { body: { id: "evt_1", n: 1 }, headers: {} };
  const lido = await lerCorpoBruto(req);
  ok("parseado: devolve null (não re-serializa)", lido === null,
    lido === null ? "" : `devolveu ${JSON.stringify(lido)}`);
}

/* 4 · string e Buffer passam intactos */
{
  const cru = '{"id":"evt_1","n":1.0}';
  ok("body string: intacto", await lerCorpoBruto({ body: cru, headers: {} }) === cru);
  ok("body Buffer: intacto", await lerCorpoBruto({ body: Buffer.from(cru), headers: {} }) === cru);
  ok("rawBody tem precedência", await lerCorpoBruto({ rawBody: cru, body: { id: "x" }, headers: {} }) === cru);
}

/* 5 · autenticarEvento com corpo bruto: assina e confere de verdade */
{
  const SEG = "whsec_sonda";
  const cru = '{"id":"evt_assinado","type":"ping","data":{"object":{"n":1.0}}}';
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=` + createHmac("sha256", SEG).update(`${t}.${cru}`).digest("hex");
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe("sk_test_sonda");

  const bom = await autenticarEvento({
    stripe, req: { headers: { "stripe-signature": sig } }, secret: SEG, corpo: cru });
  ok("assinatura válida sobre o corpo bruto", bom.event?.id === "evt_assinado", bom.erro || "");

  /* o mesmo evento RE-SERIALIZADO tem de ser recusado: é a prova de que a
     assinatura é sobre os bytes, e de que o bug antigo era real */
  const reserializado = JSON.stringify(JSON.parse(cru));
  const ruim = await autenticarEvento({
    stripe, req: { headers: { "stripe-signature": sig } }, secret: SEG, corpo: reserializado });
  ok("corpo re-serializado é RECUSADO", !!ruim.erro && !ruim.event,
    reserializado === cru ? "payload escolhido não serve de teste" : "401 como deve ser");
}

/* 6 · contingência: sem corpo bruto, a autenticidade vem da Stripe */
{
  const chamadas = [];
  const stripeFake = {
    events: {
      retrieve: async (id, _p, opts) => {
        chamadas.push({ id, opts });
        if (id === "evt_1UWcrERtL3V8lKdY") return { id, type: "customer.subscription.deleted", data: { object: {} } };
        throw new Error("No such event");
      },
    },
  };
  const r1 = await autenticarEvento({
    stripe: stripeFake, req: { body: { id: "evt_1UWcrERtL3V8lKdY" }, headers: {} }, secret: "x", corpo: null });
  ok("sem corpo bruto: confirma o evento na Stripe", r1.event?.id === "evt_1UWcrERtL3V8lKdY" && r1.porConsulta === true, r1.erro || "");

  const r2 = await autenticarEvento({
    stripe: stripeFake, req: { body: { id: "evt_0000FORJADO0000" }, headers: {} }, secret: "x", corpo: null });
  ok("id inexistente na Stripe é RECUSADO", !!r2.erro && !r2.event, r2.erro || "aceitou forjado");

  const r3 = await autenticarEvento({
    stripe: stripeFake, req: { body: { id: "nao_e_um_id" }, headers: {} }, secret: "x", corpo: null });
  ok("id fora do formato nem consulta a Stripe", !!r3.erro && chamadas.every((c) => c.id !== "nao_e_um_id"));

  /* evento de conta conectada precisa ser lido no contexto dela */
  await autenticarEvento({
    stripe: stripeFake, req: { body: { id: "evt_1UWcrERtL3V8lKdY", account: "acct_123" }, headers: {} }, secret: "x", corpo: null });
  const comConta = chamadas.find((c) => c.opts?.stripeAccount === "acct_123");
  ok("evento Connect consulta com stripeAccount", !!comConta);

  /* o objeto usado é o DA STRIPE, nunca o do corpo (senão a consulta seria decorativa) */
  const r5 = await autenticarEvento({
    stripe: stripeFake,
    req: { body: { id: "evt_1UWcrERtL3V8lKdY", type: "mentira", data: { object: { valor: 999999 } } }, headers: {} },
    secret: "x", corpo: null });
  ok("usa o objeto da Stripe, não o do corpo",
    r5.event?.type === "customer.subscription.deleted" && !r5.event?.data?.object?.valor);
}

/* ══════════════ BLOCO L — endpoint local ══════════════ */
console.log("\n━━ L · endpoint local (regressão do incidente) ━━");
const BASE = process.env.BASE || "http://localhost:5173";
const { readFileSync } = await import("node:fs");
let env = {};
try {
  env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
} catch { /* sem .env */ }

const SEGREDO = env.STRIPE_WEBHOOK_SECRET;
const vivo = await fetch(`${BASE}/api/geo`).then((r) => r.ok).catch(() => false);
const NOMES_L = ["payload que NÃO sobrevive ao round-trip é aceito", "assinatura errada continua recusada"];

if (!vivo) for (const n of NOMES_L) pula(n, `dev server de pé em ${BASE}? (npm run dev)`);
else if (!SEGREDO || SEGREDO.startsWith("COLE_AQUI")) for (const n of NOMES_L) pula(n, "STRIPE_WEBHOOK_SECRET ausente no .env");
else {
  /* o `1.0` é o ponto: JSON.parse+stringify devolveria `1` e a assinatura
     quebraria — exatamente o que acontecia em produção */
  const cru = '{"id":"evt_sonda_local","object":"event","type":"ping","data":{"object":{"n":1.0}}}';
  const assinar = (seg) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=` + createHmac("sha256", seg).update(`${t}.${cru}`).digest("hex");
  };
  const enviar = (sig) => fetch(`${BASE}/api/stripe/webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig }, body: cru,
  }).then((r) => r.status).catch(() => 0);

  const bom = await enviar(assinar(SEGREDO));
  ok(NOMES_L[0], bom === 200, `HTTP ${bom}` + (JSON.stringify(JSON.parse(cru)) === cru ? " (payload round-trippable — teste fraco)" : ""));
  const ruim = await enviar(assinar("whsec_errado"));
  ok(NOMES_L[1], ruim === 401, `HTTP ${ruim}`);
}

console.log(`\n${falhas ? "❌" : "✅"} webhook stripe: ${falhas} falha(s)${puladas ? `, ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
