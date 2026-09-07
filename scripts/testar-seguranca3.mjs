/* Sondas de segurança da Etapa 3 — PENTEST de isolamento multi-tenant,
   fuzzing de payloads e trilha de auditoria.
   Cria (ou reaproveita) um condomínio B — "TESTE Isolamento" — e tenta
   vazar/alterar dados do condomínio A (TESTE Manuais) por TODOS os
   caminhos: RLS via supabase-js, endpoints /api e RPCs transacionais.
   Sem o supabase-seguranca3.sql as sondas de auditoria são puladas. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const clienteApp = (token) => createClient(URL_SB, env.VITE_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } } });

const BASE = "http://localhost:5173";
const SENHA = "teste123";
const COND_A = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";
const EMAIL_B = "diretor.isolamento@teste.condomaster.dev";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

const post = async (rota, body, token, bruto = false) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: bruto ? body : JSON.stringify(body || {}),
  });
  const texto = await r.text();
  let j = {}; try { j = JSON.parse(texto); } catch { /* corpo não-JSON */ }
  return { http: r.status, corpo: j, texto };
};

const { error: eTab } = await admin.from("auditoria_eventos").select("id").limit(1);
const sql3 = !eTab;
console.log(sql3
  ? "ℹ️ supabase-seguranca3.sql: APLICADO — rodando todas as sondas\n"
  : "ℹ️ supabase-seguranca3.sql: AINDA NÃO APLICADO — sondas de auditoria serão puladas\n");

/* ══ setup: condomínio B (atacante) ══ */
let lgB = await post("auth/registrar", { nome: "Diretor Isolamento", email: EMAIL_B, senha: SENHA });
if (lgB.http === 409) lgB = await post("auth/login", { perfil: "diretor", email: EMAIL_B, senha: SENHA });
if (!lgB.corpo.token) { console.error("setup do atacante falhou:", lgB.corpo); process.exit(1); }
let tokenB = lgB.corpo.token, condB = lgB.corpo.conta?.condominioId || lgB.corpo.condominioId || null;
if (!condB) {
  const c = await post("auth/condominio", {
    nome: "Condominio TESTE Isolamento", cnpj: "88.777.666/0001-44", cpf: "000.000.003-53",
    endereco: "Rua da Fronteira, 999", tipo: "Residencial", porte: "Médio padrão", plano: "Essencial",
  }, tokenB);
  if (!c.corpo.condominioId) { console.error("criação do condomínio B falhou:", c.corpo); process.exit(1); }
  condB = c.corpo.condominioId; tokenB = c.corpo.token;
}
const lgA = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA });
const lgMorA = await post("auth/login", { perfil: "morador", nome: "Morador Manuais", senha: SENHA });
ok("setup: diretor B, diretor A e morador A logados", !!tokenB && !!lgA.corpo.token && !!lgMorA.corpo.token);
console.log(`   condomínio B (atacante): ${condB}`);

const sbB = clienteApp(tokenB);
const sbMorA = clienteApp(lgMorA.corpo.token);
const { data: cobrsA } = await admin.from("cobrancas")
  .select("id, valor_original, status").eq("condominio_id", COND_A).order("criado_em");
const alvoAberta = cobrsA.find((c) => !["paga", "paga_em_atraso"].includes(c.status)) || cobrsA[0];

/* ══ 1 · isolamento multi-tenant (B ataca A) ══ */
console.log("\n━━ isolamento entre condomínios ━━");
const { data: r1 } = await sbB.from("cobrancas").select("id").eq("condominio_id", COND_A);
ok("RLS: B não LÊ cobranças do A", (r1 || []).length === 0, `${(r1 || []).length} linhas`);
const { data: r2 } = await sbB.from("pessoas").select("condominio_id");
ok("RLS: SELECT sem filtro só devolve o próprio prédio",
  (r2 || []).every((p) => p.condominio_id === condB), `${(r2 || []).length} pessoas, todas do B`);
const { data: r3, error: e3 } = await sbB.from("cobrancas")
  .update({ status: "cancelada" }).eq("id", alvoAberta.id).select();
ok("RLS: B não ALTERA cobrança do A", !!e3 || (r3 || []).length === 0);
const { data: chkA } = await admin.from("cobrancas").select("status").eq("id", alvoAberta.id).single();
ok("cobrança do A permanece intacta", chkA.status === alvoAberta.status, chkA.status);

const i1 = await post("cobrancas/informar-pagamento",
  { cobrancaId: alvoAberta.id, forma: "verum_pay", txHash: "0x" + "ab".repeat(32) }, tokenB);
ok("endpoint: B informando pagamento na cobrança do A → 404 genérico", i1.http === 404, `${i1.http}`);
const { data: rpcB } = await sbB.rpc("registrar_pagamento_manual", {
  p_cobranca_id: alvoAberta.id, p_forma: "dinheiro", p_valor: 1,
  p_pago_em: new Date().toISOString(), p_justificativa: "ataque cross-tenant", p_tx: null, p_informado_id: null,
});
ok("RPC: B baixando cobrança do A → nao_autorizado", rpcB?.ok === false && rpcB?.erro === "nao_autorizado", JSON.stringify(rpcB));
const s1 = await post("stripe/licenca", { condominioId: COND_A }, tokenB);
ok("endpoint Stripe: B com condominioId do A → 401", s1.http === 401, `${s1.http}`);
const ac = await post("auth/acessos", { acao: "listar" }, tokenB);
const vazouAcessoA = (ac.corpo.acessos || []).some((a) => (a.nome || "").includes("Manuais"));
ok("acessos: B lista só os próprios (nada do A)", ac.http === 200 && !vazouAcessoA);

/* informe do A rejeitado pelo B? (cria como morador A, ataca como B) */
if (["emitida", "vencida"].includes(alvoAberta.status)) {
  const inf = await post("cobrancas/informar-pagamento", {
    cobrancaId: alvoAberta.id, forma: "transferencia", valorInformado: Number(alvoAberta.valor_original),
    pagoEm: "2026-09-07", arquivoBase64: Buffer.from(`pentest ${Date.now()}`).toString("base64"),
    nomeArquivo: "pentest.png", mime: "image/png",
  }, lgMorA.corpo.token);
  const { data: infRow } = await admin.from("pagamentos_informados")
    .select("id, documento_id").eq("cobranca_id", alvoAberta.id).eq("situacao", "pendente").maybeSingle();
  if (inf.http === 200 && infRow) {
    const { data: rej } = await sbB.rpc("rejeitar_pagamento_informado",
      { p_informado_id: infRow.id, p_motivo: "ataque" });
    ok("RPC: B rejeitando informe do A → nao_autorizado", rej?.ok === false && rej?.erro === "nao_autorizado", JSON.stringify(rej));
    /* limpeza do artefato */
    await admin.from("pagamentos_informados").delete().eq("id", infRow.id);
    if (infRow.documento_id) await admin.from("documentos").delete().eq("id", infRow.documento_id).then(() => {}, () => {});
    await admin.from("cobrancas").update({ status: alvoAberta.status, comprovante_documento_id: null })
      .eq("id", alvoAberta.id);
  } else pula("RPC: B rejeitando informe do A", "não consegui criar o informe de isca");
} else pula("RPC: B rejeitando informe do A", "nenhuma cobrança aberta no A");

/* ══ 2 · fuzzing (resposta sempre controlada, nunca stack trace) ══ */
console.log("\n━━ fuzzing ━━");
const semVazamento = (r) => !/SyntaxError|TypeError|\bat\s+\w+.*\d+:\d+|node_modules/i.test(r.texto || "");
const f1 = await post("auth/login", "{{{nao-e-json", null, true);
ok("corpo não-JSON → resposta controlada", f1.http >= 400 && semVazamento(f1), `${f1.http}`);
const f2 = await post("auth/login", { perfil: "diretor", email: "a@b.co", senha: "x".repeat(9), __proto__: { admin: true }, constructor: { evil: 1 } });
ok("chaves __proto__/constructor descartadas sem crash", f2.http === 401 && semVazamento(f2), `${f2.http}`);
const f3 = await post("auth/login", { perfil: "morador", nome: "x".repeat(200000), senha: "12345678" });
ok("string gigante (200 KB) → 400", f3.http === 400 && semVazamento(f3), `${f3.http}`);
const f4 = await post("auth/login", ["array", "em vez de objeto"]);
ok("array no lugar de objeto → 400", f4.http === 400 && semVazamento(f4), `${f4.http}`);
const f5 = await post("cobrancas/informar-pagamento",
  { cobrancaId: alvoAberta.id, forma: "transferencia", valorInformado: -50, arquivoBase64: "QQ==", nomeArquivo: "x.png", mime: "image/png" },
  lgMorA.corpo.token);
ok("valor negativo → 400", f5.http === 400 && semVazamento(f5), `${f5.http}`);
const f6 = await post("cobrancas/informar-pagamento",
  { cobrancaId: alvoAberta.id, forma: "verum_pay", txHash: "0x00'; drop table cobrancas; --" }, lgMorA.corpo.token);
ok("injeção no txHash → 400", f6.http === 400 && semVazamento(f6), `${f6.http}`);

/* ══ 3 · trilha de auditoria ══ */
console.log("\n━━ auditoria ━━");
if (!sql3) {
  pula("eventos de login na trilha / imutabilidade / trigger financeiro", "rode supabase-seguranca3.sql e teste de novo");
} else {
  await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "senha-errada-probe" });
  const desde = new Date(Date.now() - 60_000).toISOString();
  const { data: evFalha } = await admin.from("auditoria_eventos")
    .select("id, ip").eq("evento", "login_falha").gte("quando", desde).limit(5);
  ok("login_falha registrado com IP", (evFalha || []).length > 0 && !!evFalha[0].ip);

  /* trigger financeiro: baixa em dinheiro numa cobrança descartável */
  const { data: un } = await admin.from("unidades").select("id, responsavel_financeiro_id")
    .eq("condominio_id", COND_A).limit(1).single();
  const { data: cobrTmp } = await admin.from("cobrancas").insert({
    condominio_id: COND_A, unidade_id: un.id, responsavel_id: un.responsavel_financeiro_id,
    competencia: "2026-11", tipo: "extra", valor_original: 5, vencimento: "2026-11-28", status: "emitida",
  }).select("id").single();
  const sbA = clienteApp(lgA.corpo.token);
  await sbA.rpc("registrar_pagamento_manual", {
    p_cobranca_id: cobrTmp.id, p_forma: "dinheiro", p_valor: 5,
    p_pago_em: new Date().toISOString(), p_justificativa: "sonda de auditoria", p_tx: null, p_informado_id: null,
  });
  const { data: evPag } = await admin.from("auditoria_eventos")
    .select("id, usuario_id, detalhe").eq("evento", "pagamento_registrado")
    .contains("detalhe", { cobranca_id: cobrTmp.id }).limit(1);
  ok("trigger auditou a baixa feita PELO NAVEGADOR (RPC do gestor)",
    (evPag || []).length === 1 && !!evPag[0].usuario_id, evPag?.[0] ? "com usuario_id" : "sem evento");

  /* imutabilidade: nem a service role reescreve/apaga */
  const { error: eUpd } = await admin.from("auditoria_eventos")
    .update({ evento: "adulterado" }).eq("id", evFalha[0].id);
  ok("UPDATE na trilha → bloqueado (append-only)", !!eUpd, eUpd?.message?.slice(0, 60));
  const { error: eDel } = await admin.from("auditoria_eventos").delete().eq("id", evFalha[0].id);
  ok("DELETE recente na trilha → bloqueado", !!eDel, eDel?.message?.slice(0, 60));

  /* RLS da trilha: morador não lê; diretor lê só o próprio prédio */
  const { data: trilhaMor } = await sbMorA.from("auditoria_eventos").select("id").limit(5);
  ok("morador não enxerga a trilha", (trilhaMor || []).length === 0);
  const { data: trilhaB } = await sbB.from("auditoria_eventos").select("condominio_id").limit(50);
  ok("diretor B não vê eventos do A", (trilhaB || []).every((e) => e.condominio_id === condB));

  /* limpeza da cobrança descartável (pagamento/lançamento junto) */
  await admin.from("pagamentos").delete().eq("cobranca_id", cobrTmp.id);
  await admin.from("lancamentos").delete().eq("origem_id", cobrTmp.id).eq("origem_tipo", "cobranca");
  await admin.from("cobrancas").delete().eq("id", cobrTmp.id);
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🛡️ ETAPA 3 OK${puladas ? ` · ${puladas} sonda(s) aguardando o supabase-seguranca3.sql` : ""}`);
process.exit(falhas ? 1 : 0);
