/* TEMPORÁRIO — roda o FLUXO COMPLETO da conciliação de pagamentos manuais
   sobre o cenário do testar-manuais-seed.mjs, exatamente pelos mesmos canais
   que o navegador usa (endpoints /api + RPCs com o JWT do usuário):
     T1 cripto     : morador cola hash USDC real → auto-baixa on-chain
     T2 informado  : morador envia comprovante valor exato → gestor confirma
     T3 divergente : morador informa 110 na cobrança de 120 → gestor rejeita
     T4 dinheiro   : gestor clica Receber (RPC direta)
     T5 idempotência + autorização (morador não baixa, hash não repete)
   O service role entra SÓ para conferir o estado do banco após cada passo. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const clienteApp = (token) => createClient(URL_SB, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });

const BASE = "http://localhost:5173";
const SENHA = "teste123";
const HASH_USDC = "0x3e7907312227d0754118382649b887a5151c10998b58c4741de32eeefe957d78";
const VALOR_USDC = 390.1;
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const api = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j }; // "status" do corpo (ex.: 'paga') não pode sobrescrever o HTTP
};
const cobranca = async (id) =>
  (await admin.from("cobrancas").select("status, valor_original").eq("id", id).single()).data;
const informeDe = async (cobrancaId) =>
  (await admin.from("pagamentos_informados").select("id, situacao, valor_informado, motivo_rejeicao")
    .eq("cobranca_id", cobrancaId).order("criado_em", { ascending: false }).limit(1).maybeSingle()).data;
/* comprovante fake: bytes distintos por rótulo E por execução (o hash SHA-256 de
   um arquivo repetido marcaria divergência; o endpoint valida mime/tamanho) */
const NONCE = Date.now().toString(36);
const comprovante = (rotulo) => Buffer.from(`comprovante de transferencia TESTE ${rotulo} ${NONCE} — condomaster`).toString("base64");

/* ── cobranças do cenário (ordem de criação = roteiro) ── */
const { data: cobrs } = await admin.from("cobrancas")
  .select("id, valor_original, status").eq("condominio_id", COND).order("criado_em");
if ((cobrs || []).length !== 4) { console.error(`esperava 4 cobranças, achei ${cobrs?.length}`); process.exit(1); }
const [c1, c2, c3, c4] = cobrs;

/* RESET do condomínio de teste: zera o rastro de execuções anteriores para o
   fluxo rodar do início (só mexe no condomínio TESTE Manuais) */
await admin.from("pagamentos").delete().eq("condominio_id", COND);
await admin.from("lancamentos").delete().eq("condominio_id", COND);
await admin.from("pagamentos_informados").delete().eq("condominio_id", COND);
await admin.from("cobrancas").update({ status: "emitida", comprovante_documento_id: null, provider_charge_id: null })
  .eq("condominio_id", COND);
/* alinhamento pós-queda de energia: a cobrança #1 nasceu com o valor da USDC
   da sessão antiga; a carteira aponta para a transferência nova (390.10) */
if (Number(c1.valor_original) !== VALOR_USDC) {
  await admin.from("cobrancas").update({ valor_original: VALOR_USDC }).eq("id", c1.id);
  console.log(`ℹ️ cobrança #1 realinhada: US$ ${c1.valor_original} → US$ ${VALOR_USDC} (tx nova)`);
}

/* ── logins como o navegador faz ── */
const lm = await api("auth/login", { perfil: "morador", nome: "Morador Manuais", senha: SENHA });
const ld = await api("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA });
ok("login morador (pelo nome)", !!lm.token, lm.error);
ok("login diretor (pelo e-mail)", !!ld.token, ld.error);
if (!lm.token || !ld.token) process.exit(1);
const sbDiretor = clienteApp(ld.token);
const sbMorador = clienteApp(lm.token);

/* ════ T1 · CRIPTO: hash USDC real → auto-baixa ════ */
console.log("\n━━ T1 · cripto on-chain (auto-baixa) ━━");
const t1 = await api("cobrancas/informar-pagamento",
  { cobrancaId: c1.id, forma: "verum_pay", txHash: HASH_USDC }, lm.token);
ok("verificação on-chain aprovou e baixou", t1.http === 200 && t1.pago === true,
  t1.error || `chain=${t1.chain} ${t1.quantia} ${t1.token} → ${t1.status}`);
const c1dep = await cobranca(c1.id);
ok("cobrança #1 → paga", c1dep?.status === "paga", c1dep?.status);
const { data: pag1 } = await admin.from("pagamentos")
  .select("origem, provider_event_id, valor_pago").eq("cobranca_id", c1.id).maybeSingle();
ok("pagamento origem=reconciliacao, evento=hash",
  pag1?.origem === "reconciliacao" && pag1?.provider_event_id === HASH_USDC,
  `${pag1?.origem} / ${(pag1?.provider_event_id || "").slice(0, 18)}…`);

/* ════ T2 · TRANSFERÊNCIA valor exato → informado → gestor confirma ════ */
console.log("\n━━ T2 · transferência valor exato → confirmação do gestor ━━");
const t2 = await api("cobrancas/informar-pagamento", {
  cobrancaId: c2.id, forma: "transferencia", valorInformado: 100,
  pagoEm: new Date().toISOString().slice(0, 10),
  arquivoBase64: comprovante("A-valor-exato"), nomeArquivo: "comprovante-a.png", mime: "image/png",
}, lm.token);
ok("informe aceito sem divergência", t2.http === 200 && t2.divergente === false && t2.status === "pagamento_informado",
  t2.error || t2.motivo || "");
ok("cobrança #2 → pagamento_informado", (await cobranca(c2.id))?.status === "pagamento_informado");
const inf2 = await informeDe(c2.id);
ok("informe pendente registrado", inf2?.situacao === "pendente", JSON.stringify(inf2));

const { data: r2, error: e2 } = await sbDiretor.rpc("registrar_pagamento_manual", {
  p_cobranca_id: c2.id, p_forma: "transferencia", p_valor: 100,
  p_pago_em: new Date().toISOString(),
  p_justificativa: "Comprovante conferido — teste fluxo completo",
  p_tx: null, p_informado_id: inf2?.id ?? null,
});
ok("gestor confirmou via RPC (JWT do diretor)", !e2 && r2?.ok === true && r2?.status === "paga",
  e2?.message || JSON.stringify(r2));
ok("cobrança #2 → paga", (await cobranca(c2.id))?.status === "paga");
ok("informe → confirmado", (await informeDe(c2.id))?.situacao === "confirmado");

/* ════ T3 · TRANSFERÊNCIA 110 na cobrança de 120 → divergente → rejeição ════ */
console.log("\n━━ T3 · transferência divergente → rejeição do gestor ━━");
const t3 = await api("cobrancas/informar-pagamento", {
  cobrancaId: c3.id, forma: "transferencia", valorInformado: 110,
  pagoEm: new Date().toISOString().slice(0, 10),
  arquivoBase64: comprovante("B-valor-errado"), nomeArquivo: "comprovante-b.png", mime: "image/png",
}, lm.token);
ok("informe marcado divergente (motivo: valor)",
  t3.http === 200 && t3.divergente === true && t3.status === "pagamento_divergente", t3.error || t3.motivo);
ok("cobrança #3 → pagamento_divergente", (await cobranca(c3.id))?.status === "pagamento_divergente");
const inf3 = await informeDe(c3.id);
const { data: r3, error: e3 } = await sbDiretor.rpc("rejeitar_pagamento_informado", {
  p_informado_id: inf3?.id, p_motivo: "Valor não confere com a cobrança — teste",
});
ok("gestor rejeitou via RPC", !e3 && r3?.ok === true, e3?.message || JSON.stringify(r3));
const inf3dep = await informeDe(c3.id);
ok("informe → rejeitado com motivo", inf3dep?.situacao === "rejeitado" && !!inf3dep?.motivo_rejeicao);
ok("cobrança #3 reaberta → emitida", (await cobranca(c3.id))?.status === "emitida", (await cobranca(c3.id))?.status);

/* ════ T4 · DINHEIRO: botão Receber do gestor ════ */
console.log("\n━━ T4 · dinheiro (Receber direto pelo gestor) ━━");
const { data: r4, error: e4 } = await sbDiretor.rpc("registrar_pagamento_manual", {
  p_cobranca_id: c4.id, p_forma: "dinheiro", p_valor: 50,
  p_pago_em: new Date().toISOString(),
  p_justificativa: "Recebido em espécie na administração — teste",
  p_tx: null, p_informado_id: null,
});
ok("baixa em dinheiro via RPC", !e4 && r4?.ok === true && r4?.status === "paga", e4?.message || JSON.stringify(r4));
ok("cobrança #4 → paga", (await cobranca(c4.id))?.status === "paga");

/* ════ T5 · idempotência + autorização ════ */
console.log("\n━━ T5 · idempotência e autorização ━━");
const t5a = await api("cobrancas/informar-pagamento",
  { cobrancaId: c3.id, forma: "verum_pay", txHash: HASH_USDC }, lm.token);
ok("mesmo hash em outra cobrança → recusado", t5a.http === 409, `${t5a.http} ${t5a.error || ""}`);
const { data: r5b } = await sbDiretor.rpc("registrar_pagamento_manual", {
  p_cobranca_id: c4.id, p_forma: "dinheiro", p_valor: 50,
  p_pago_em: new Date().toISOString(), p_justificativa: "duplo clique — teste",
  p_tx: null, p_informado_id: null,
});
ok("duplo clique no Receber → duplicado, sem novo pagamento", r5b?.ok === true && r5b?.duplicado === true, JSON.stringify(r5b));
const { data: r5c } = await sbMorador.rpc("registrar_pagamento_manual", {
  p_cobranca_id: c3.id, p_forma: "dinheiro", p_valor: 120,
  p_pago_em: new Date().toISOString(), p_justificativa: "morador tentando — teste",
  p_tx: null, p_informado_id: null,
});
ok("morador tentando baixar → nao_autorizado", r5c?.ok === false && r5c?.erro === "nao_autorizado", JSON.stringify(r5c));

/* ════ estado final ════ */
console.log("\n━━ estado final ━━");
const { data: fim } = await admin.from("cobrancas")
  .select("valor_original, status").eq("condominio_id", COND).order("criado_em");
for (const c of fim || []) console.log(`  cobrança US$ ${c.valor_original} → ${c.status}`);
const { data: pags } = await admin.from("pagamentos")
  .select("valor_pago, origem, provider_event_id").eq("condominio_id", COND).order("criado_em");
console.log(`  pagamentos: ${pags?.length}`);
for (const p of pags || []) console.log(`    US$ ${p.valor_pago} ${p.origem} (${(p.provider_event_id || "").slice(0, 24)}…)`);
const { data: lancs } = await admin.from("lancamentos")
  .select("descricao, valor, status, forma_pagamento").eq("condominio_id", COND).order("criado_em");
console.log(`  lançamentos no caixa: ${lancs?.length}`);
for (const l of lancs || []) console.log(`    "${l.descricao}" US$ ${l.valor} [${l.status}] via ${l.forma_pagamento}`);
ok("\n3 pagamentos e 3 entradas no caixa", pags?.length === 3 && lancs?.length === 3 && lancs.every((l) => l.status === "pago"));

console.log(falhas ? `\n❌ ${falhas} verificação(ões) falharam` : "\n🎉 FLUXO COMPLETO OK");
process.exit(falhas ? 1 : 0);
