/* Sondas do CAIXA COM ÂNCORA e dos CARGOS DE GESTÃO dinâmicos (aba Gestão).

   Bloco U (sem banco): src/lib/caixa.js — sem âncora soma como sempre;
   com âncora (positiva ou NEGATIVA) o saldo é o valor do INÍCIO do dia
   informado + o que entrou/saiu DESTA DATA EM DIANTE (o dia conta);
   e parseBRL preserva o sinal de menos.

   Bloco E (banco + dev server): o DIRETOR grava financeiro.caixa e
   gestao.cargos em regras_internas (leitura → merge → escrita, porque a
   tela sobrescreve o jsonb inteiro) e confere a persistência; o MORADOR
   não consegue (policy cond_update é diretor-only). Estado restaurado.

   Uso: node scripts/testar-caixa-cargos.mjs   (bloco E exige npm run dev) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { saldoComAncora } from "../src/lib/caixa.js";
/* espelho de parseBRL (src/lib/api.js:55 — api.js não importa no Node por
   causa do import.meta.env): documenta o CONTRATO de sinal que a tela usa */
const parseBRL = (s) => Number(String(s || "0").replace(/[R$\s.]/g, "").replace(",", ".")) || 0;

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const clienteApp = (token) => createClient(URL_SB, env.VITE_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } } });
const BASE = process.env.BASE || "http://localhost:5173";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";   // condomínio TESTE Manuais

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* ══ U · saldo com âncora (puro) ══ */
console.log("━━ U · caixa com âncora ━━");
const L1 = [
  { status: "pago", tipo: "receita", valor: 100, data: "2026-01-10" },
  { status: "pago", tipo: "despesa", valor: 30, data: "2026-02-05" },
  { status: "pago", tipo: "receita", valor: 50, data: "2026-03-01" },
  { status: "aberto", tipo: "receita", valor: 999, data: "2026-03-02" }, // não pago: fora
];
ok("U1 sem âncora: soma de sempre (receitas − despesas pagas)", saldoComAncora(L1, null) === 120,
  String(saldoComAncora(L1, null)));
ok("U2 âncora: valor do INÍCIO do dia + o que veio desta data em diante",
  saldoComAncora(L1, { valor: 1000, em: "2026-02-05" }) === 1020, // só o 100 (anterior) já está no 1000; −30 do próprio dia conta
  String(saldoComAncora(L1, { valor: 1000, em: "2026-02-05" })));
ok("U3 o dia da âncora CONTA (data >= em, inclusivo)",
  saldoComAncora(L1, { valor: 0, em: "2026-03-01" }) === 50
  && saldoComAncora(L1, { valor: 0, em: "2026-03-02" }) === 0
  && saldoComAncora(L1, { valor: 0, em: "2026-02-28" }) === 50);
ok("U4 âncora NEGATIVA funciona", saldoComAncora(L1, { valor: -500, em: "2026-02-05" }) === -480,
  String(saldoComAncora(L1, { valor: -500, em: "2026-02-05" })));
ok("U5 âncora malformada (sem data/valor) cai na soma normal",
  saldoComAncora(L1, { valor: 1000 }) === 120 && saldoComAncora(L1, { em: "2026-01-01" }) === 120);
ok("U6 parseBRL preserva o sinal de menos",
  parseBRL("-1.234,56") === -1234.56 && parseBRL("1.234,56") === 1234.56 && parseBRL("-500") === -500,
  String(parseBRL("-1.234,56")));

/* ══ E · persistência no banco (RLS) ══ */
console.log("\n━━ E · gravação pela tela (Manuais) ━━");
const post = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!r) return { http: 0 };
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
};
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" });
const loginM = await post("auth/login", { perfil: "morador", nome: "Morador Manuais", senha: "teste123" });

if (!login.token || !loginM.token) {
  for (const n of ["diretor grava caixa+cargos", "morador bloqueado", "restauração"])
    pula(n, `login falhou — dev server de pé em ${BASE}? (npm run dev)`);
} else {
  const app = clienteApp(login.token), appM = clienteApp(loginM.token);
  const { data: antes } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  const original = antes?.regras_internas || {};

  /* como a tela: regras_internas inteiro, com as chaves novas no meio */
  const novas = {
    ...original,
    gestao: { ...(original.gestao || {}), cargos: [{ cargo: "Conselho fiscal", nome: "Sonda Fiscal" }, { cargo: "Subsíndico", nome: "Sonda Sub" }] },
    financeiro: { caixa: { valor: -1234.56, em: "2026-01-15" } },
  };
  const { error: eW } = await app.from("condominios").update({ regras_internas: novas }).eq("id", COND);
  const { data: lida } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  const r = lida?.regras_internas || {};
  ok("E1 diretor grava caixa negativo + 2 cargos (RLS cond_update)",
    !eW && r.financeiro?.caixa?.valor === -1234.56 && r.financeiro?.caixa?.em === "2026-01-15"
    && r.gestao?.cargos?.length === 2 && r.gestao?.cargos?.[0]?.cargo === "Conselho fiscal",
    eW?.message || JSON.stringify({ caixa: r.financeiro?.caixa, cargos: r.gestao?.cargos?.length }));
  ok("E2 chaves antigas sobrevivem ao save (moeda etc.)",
    r.moeda === original.moeda && JSON.stringify(r.pagamentos) === JSON.stringify(original.pagamentos));

  await appM.from("condominios").update({ regras_internas: { ...novas, financeiro: { caixa: { valor: 999999, em: "2026-01-01" } } } }).eq("id", COND);
  const { data: aposM } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  ok("E3 morador não altera o cadastro (update silencioso em 0 linhas)",
    aposM?.regras_internas?.financeiro?.caixa?.valor === -1234.56);

  await admin.from("condominios").update({ regras_internas: original }).eq("id", COND);
  const { data: fim } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  ok("E4 estado original restaurado", JSON.stringify(fim?.regras_internas) === JSON.stringify(original));

  /* ══ C · acesso com CARGO de gestão e atalho Proprietário ══ */
  console.log("\n━━ C · cargo no perfil de acesso ━━");
  const EMAIL_CARGO = "conselho.sonda@teste.condomaster.dev";
  const NOME_PROP = "Sonda Proprietario Acesso";
  /* limpeza de execução anterior interrompida */
  const limparAcesso = async (filtro) => {
    const lista = await post("auth/acessos", { acao: "listar" }, login.token);
    for (const a of lista.acessos || []) if (filtro(a)) await post("auth/acessos", { acao: "remover", usuarioId: a.id }, login.token);
  };
  await limparAcesso((a) => a.email === EMAIL_CARGO || a.nome === NOME_PROP);

  const c1 = await post("auth/acessos", { acao: "criar", perfil: "tesouraria", email: EMAIL_CARGO, senha: "teste12345", cargo: "Conselho fiscal" }, login.token);
  ok("C1 acesso de CARGO criado (nível tesouraria + rótulo do cargo)", c1.http === 200 && !!c1.id, c1.error || c1.id);
  const l1 = await post("auth/acessos", { acao: "listar" }, login.token);
  const doCargo = (l1.acessos || []).find((a) => a.email === EMAIL_CARGO);
  ok("C2 lista devolve o cargo do acesso", doCargo?.role === "tesouraria" && doCargo?.cargo === "Conselho fiscal",
    JSON.stringify({ role: doCargo?.role, cargo: doCargo?.cargo }));
  const lg = await post("auth/login", { perfil: "tesouraria", email: EMAIL_CARGO, senha: "teste12345" });
  ok("C3 login do acesso traz o cargo para a sessão (menu lateral)",
    lg.http === 200 && lg.conta?.cargo === "Conselho fiscal", lg.error || JSON.stringify(lg.conta?.cargo));

  const c2 = await post("auth/acessos", { acao: "criar", perfil: "morador", nome: NOME_PROP, senha: "teste12345", papel: "proprietario" }, login.token);
  const l2 = await post("auth/acessos", { acao: "listar" }, login.token);
  const prop = (l2.acessos || []).find((a) => a.nome === NOME_PROP);
  ok("C4 atalho Proprietário: morador nasce com papel proprietario (vê o dashboard)",
    c2.http === 200 && prop?.role === "morador" && prop?.papel === "proprietario",
    c2.error || JSON.stringify({ role: prop?.role, papel: prop?.papel }));

  await limparAcesso((a) => a.email === EMAIL_CARGO || a.nome === NOME_PROP);
  const l3 = await post("auth/acessos", { acao: "listar" }, login.token);
  ok("C5 acessos da sonda removidos",
    !(l3.acessos || []).some((a) => a.email === EMAIL_CARGO || a.nome === NOME_PROP));
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🏦 CAIXA E CARGOS OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
