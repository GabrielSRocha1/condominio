/* Testa a integração Commet sem precisar de vercel dev nem da CLI do Commet.
   Uso:  node scripts/testar-commet.mjs            → roda os 3 testes
         node scripts/testar-commet.mjs --pagar    → também cria um link de
                                                     pagamento real para a 1ª
                                                     cobrança pendente e mostra
                                                     a URL para você abrir

   Testes:
   1. API key — chamada de leitura (payments.list) confirma a credencial.
   2. Webhook — dispara um evento payment.received FALSO, assinado com o
      COMMET_WEBHOOK_SECRET, contra o handler real (api/commet/webhook.js)
      rodando num servidor local temporário; verifica se a cobrança de teste
      vira "paga" e se o pagamento é registrado; depois DESFAZ tudo.
   3. (--pagar) Checkout — cria o link de pagamento real no Commet. */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { Commet } from "@commet/node";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
/* o handler do webhook lê de process.env — injeta o .env nele */
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const ok = (m) => console.log(`  ✔ ${m}`);
const falha = (m) => { console.log(`  ✘ ${m}`); process.exitCode = 1; };

/* ── 1. API key ──────────────────────────────────────────────── */
console.log("\n1) API key do Commet");
const commet = new Commet({ apiKey: env.COMMET_API_KEY });
const lista = await commet.payments.list({ limit: 1 });
if (lista?.success) ok("credencial válida (payments.list respondeu)");
else falha(`credencial recusada: ${JSON.stringify(lista?.error || lista)}`);

/* ── 2. Webhook (evento falso assinado, com desfazer) ───────────── */
console.log("\n2) Webhook — simulação de payment.received");
const { data: cobs } = await sb
  .from("cobrancas")
  .select("id, condominio_id, status, vencimento, valor_original, encargos, competencia")
  .in("status", ["emitida", "vencida"])
  .limit(1);
const cob = cobs?.[0];
if (!cob) {
  console.log("  – nenhuma cobrança pendente no banco; crie uma na tela Cobranças e rode de novo.");
} else {
  const { default: webhook } = await import("../api/commet/webhook.js");
  const server = createServer((req, res) => {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
    webhook(req, res);
  });
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;

  const idFalso = `pay_teste_${cob.id.slice(0, 8)}`;
  const corpo = JSON.stringify({
    event: "payment.received",
    timestamp: new Date().toISOString(),
    data: {
      id: idFalso,
      amount: Math.round((Number(cob.valor_original || 0) + Number(cob.encargos || 0)) * 100),
      metadata: { cobrancaId: cob.id },
    },
  });
  const assinatura = createHmac("sha256", env.COMMET_WEBHOOK_SECRET).update(corpo).digest("hex");

  const semAssinatura = await fetch(`http://localhost:${porta}/`, {
    method: "POST", body: corpo,
    headers: { "content-type": "application/json", "commet-signature": "assinatura-errada" },
  });
  if (semAssinatura.status === 401) ok("assinatura inválida é rejeitada (401)");
  else falha(`assinatura errada deveria dar 401, deu ${semAssinatura.status}`);

  const r = await fetch(`http://localhost:${porta}/`, {
    method: "POST", body: corpo,
    headers: { "content-type": "application/json", "commet-signature": assinatura },
  });
  server.close();
  if (r.status !== 200) {
    falha(`webhook respondeu ${r.status}: ${await r.text()}`);
  } else {
    const { data: depois } = await sb.from("cobrancas").select("status").eq("id", cob.id).single();
    const { data: pags } = await sb.from("pagamentos").select("id").eq("provider_event_id", idFalso);
    if (["paga", "paga_em_atraso"].includes(depois?.status)) ok(`cobrança ${cob.competencia} marcada como ${depois.status}`);
    else falha(`status da cobrança ficou "${depois?.status}"`);
    if (pags?.length) ok("pagamento registrado na tabela pagamentos");
    else falha("pagamento não foi registrado");

    /* desfaz: o banco volta exatamente como estava */
    await sb.from("pagamentos").delete().eq("provider_event_id", idFalso);
    await sb.from("cobrancas").update({ status: cob.status, provider_charge_id: null }).eq("id", cob.id);
    ok("teste desfeito — cobrança voltou a ficar pendente");
  }
}

/* ── 3. Checkout real (opcional) ────────────────────────────── */
if (process.argv.includes("--pagar")) {
  console.log("\n3) Link de pagamento real");
  if (!cob) {
    console.log("  – sem cobrança pendente, nada a criar.");
  } else {
    const r = await commet.payments.create({
      amount: Math.round((Number(cob.valor_original || 0) + Number(cob.encargos || 0)) * 100),
      currency: env.COMMET_CURRENCY || "brl",
      description: `TESTE CondoMaster · ${cob.competencia}`,
      metadata: { cobrancaId: cob.id },
    });
    const pag = r && typeof r === "object" && "data" in r ? r.data : r;
    const urlCheckout = pag?.checkoutUrl || pag?.url;
    if (urlCheckout) {
      await sb.from("cobrancas").update({ provider_charge_id: pag.id }).eq("id", cob.id);
      ok(`link criado (${pag.id})`);
      console.log(`\n  Abra para pagar:  ${urlCheckout}\n`);
    } else falha(`Commet não devolveu checkoutUrl: ${JSON.stringify(r?.error || r)}`);
  }
}

console.log(process.exitCode ? "\nHouve falhas — veja acima." : "\nTudo certo!");
