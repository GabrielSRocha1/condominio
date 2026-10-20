/* Migra as assinaturas vivas dos prices ANTIGOS da licença para os prices
   novos (âncora USD — ver preparar-stripe-producao.mjs), SEM proration: o
   ciclo corrente fica intocado e a PRÓXIMA fatura já sai no valor novo
   ("migrar na renovação"). A assinatura mantém a moeda original (BRL) e
   passa a cobrar a base BRL nova.

   Rodar SOMENTE depois de avisar os clientes — é aumento real de preço.

   Uso:  node scripts/migrar-assinaturas-precos-novos.mjs                 (dry-run, chave de teste)
         node scripts/migrar-assinaturas-precos-novos.mjs --executar
         node scripts/migrar-assinaturas-precos-novos.mjs --live [--executar]

   Idempotente: depois de migrar, re-rodar não encontra assinatura nenhuma
   pendurada nos prices antigos. */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { slug } from "../api/stripe/_lib/comum.js";

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
const brl = (centavos) => `R$ ${(centavos / 100).toFixed(2)}`;
/* estados que seguem cobrando e portanto migram; canceladas/incompletas ficam */
const MIGRAVEIS = new Set(["active", "past_due", "trialing"]);

const { data: planosDb, error } = await sb.from("saas_planos").select("nome").eq("ativo", true);
if (error) { console.error("Supabase:", error.message); process.exit(1); }

let achadas = 0, migradas = 0;
for (const p of planosDb) {
  const chaveProduto = `condomaster_${slug(p.nome)}`;
  const busca = await stripe.products.search({ query: `metadata["plano_key"]:"${chaveProduto}"`, limit: 1 });
  const produto = busca.data[0];
  if (!produto) { console.log(`  ${chaveProduto}: product não existe — rode preparar-stripe-producao.mjs antes.`); continue; }

  for (const ciclo of ["mensal", "anual"]) {
    const lookup = `${chaveProduto}_${ciclo}_brl`;
    const lista = await stripe.prices.list({ lookup_keys: [lookup], limit: 1 });
    const novo = lista.data[0];
    if (!novo) continue; // plano sem ciclo anual, ou prices ainda não criados
    /* prices antigos = mesmo product/intervalo, id diferente do novo (foram
       desativados pelo preparar, mas as assinaturas vivas seguem neles) */
    const doProduto = await stripe.prices.list({ product: produto.id, limit: 100 });
    const antigos = doProduto.data.filter((pr) => pr.id !== novo.id && pr.recurring?.interval === novo.recurring.interval);
    for (const antigo of antigos) {
      for await (const sub of stripe.subscriptions.list({ price: antigo.id, status: "all", limit: 100 })) {
        const tag = sub.collection_method === "send_invoice" ? " [PAGOMANUAL/send_invoice]" : "";
        if (!MIGRAVEIS.has(sub.status)) { console.log(`  pular ${sub.id} (${sub.status})${tag}`); continue; }
        const item = sub.items.data.find((i) => i.price.id === antigo.id);
        if (!item) { console.log(`  ⚠ ${sub.id}: item do price ${antigo.id} não encontrado — pulando`); continue; }
        achadas++;
        const fimCiclo = item.current_period_end ?? sub.current_period_end;
        const quando = fimCiclo ? new Date(fimCiclo * 1000).toISOString().slice(0, 10) : "?";
        console.log(`  ${executar ? "migrar" : "migraria"} ${sub.id} (condominio ${sub.metadata?.condominio_id || "?"}, customer ${sub.customer})${tag}: ${brl(antigo.unit_amount)} → ${brl(novo.unit_amount)}/${ciclo} na renovação de ${quando}`);
        if (!executar) continue;
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: item.id, price: novo.id }],
          proration_behavior: "none", // ciclo corrente intocado; próxima fatura no valor novo
        });
        migradas++;
      }
    }
  }
}
console.log(`\n${achadas} assinatura(s) viva(s) nos prices antigos — ${executar ? `${migradas} migrada(s)` : "simulação; rode com --executar para efetivar"}.`);
