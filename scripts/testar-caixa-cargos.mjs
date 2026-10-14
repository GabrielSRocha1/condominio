/* Sondas do CAIXA COM ÂNCORA e dos CARGOS DE GESTÃO dinâmicos (aba Gestão).

   Bloco U (sem banco): src/lib/caixa.js — sem âncora soma como sempre;
   com âncora (positiva ou NEGATIVA) o saldo é o valor informado + só o
   que entrou/saiu DEPOIS da data (o dia da âncora já está no número);
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
ok("U2 âncora: valor informado + só o que veio DEPOIS da data",
  saldoComAncora(L1, { valor: 1000, em: "2026-02-05" }) === 1050, // 100 e −30 já estão no 1000
  String(saldoComAncora(L1, { valor: 1000, em: "2026-02-05" })));
ok("U3 o dia da âncora fica fora (data > em, exclusivo)",
  saldoComAncora(L1, { valor: 0, em: "2026-03-01" }) === 0
  && saldoComAncora(L1, { valor: 0, em: "2026-02-28" }) === 50);
ok("U4 âncora NEGATIVA funciona", saldoComAncora(L1, { valor: -500, em: "2026-02-05" }) === -450,
  String(saldoComAncora(L1, { valor: -500, em: "2026-02-05" })));
ok("U5 âncora malformada (sem data/valor) cai na soma normal",
  saldoComAncora(L1, { valor: 1000 }) === 120 && saldoComAncora(L1, { em: "2026-01-01" }) === 120);
ok("U6 parseBRL preserva o sinal de menos",
  parseBRL("-1.234,56") === -1234.56 && parseBRL("1.234,56") === 1234.56 && parseBRL("-500") === -500,
  String(parseBRL("-1.234,56")));

/* ══ E · persistência no banco (RLS) ══ */
console.log("\n━━ E · gravação pela tela (Manuais) ━━");
const post = async (rota, body) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
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
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🏦 CAIXA E CARGOS OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
