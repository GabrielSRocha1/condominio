/* Sondas do FUNDO DE RESERVA NO CAIXA (supabase-fundo-reserva.sql).

   Prova que a baixa divide o lançamento quando o FR% está configurado
   (regras_internas.cobranca.fundo_reserva_pct): Taxa condominial = pago −
   parcela do fundo; Fundo de reserva = principal_pago × FR% ÷ (100 + FR%).
   Mora NÃO alimenta o fundo (least com o valor_original) e o desconto
   negociado reduz a parcela proporcionalmente. Os lançamentos saem com a
   DATA de hoje (visão de caixa dos cards) e a competência da cobrança.

   Sem o supabase-fundo-reserva.sql no banco, a baixa lança uma linha só —
   as sondas de divisão são PULADAS com aviso (degrada aberto).
   Restaura as regras_internas do condomínio e remove tudo que criou.

   Uso: node scripts/testar-fundo-reserva.mjs   (exige npm run dev) */
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
const BASE = process.env.BASE || "http://localhost:5173";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";   // condomínio TESTE Manuais
const COMPS = ["2019-07", "2019-08", "2019-09"];        // longe do cenário vivo e das outras sondas

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
const perto = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const hojeISO = new Date().toISOString().slice(0, 10);

console.log("━━ F · fundo de reserva na baixa (Manuais) ━━");
const post = async (rota, body) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!r) return { http: 0 };
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
};
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" });

if (!login.token) {
  for (const n of ["FR% ligado", "baixa divide taxa + fundo", "mora fora do fundo", "desconto proporcional"])
    pula(n, `login falhou — dev server de pé em ${BASE}? (npm run dev)`);
} else {
  const app = clienteApp(login.token);

  /* estado original para restaurar no fim — regras_internas é sobrescrito
     INTEIRO pela UI; aqui mesclamos só a chave do FR% preservando o resto */
  const { data: antes } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  const regras = antes?.regras_internas && typeof antes.regras_internas === "object" ? antes.regras_internas : {};
  await admin.from("condominios").update({
    regras_internas: { ...regras, cobranca: { ...(regras.cobranca || {}), fundo_reserva_pct: 10 } },
  }).eq("id", COND);
  const { data: lida } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  ok("F1 FR% 10 ligado nas regras (mescla preserva o resto do jsonb)",
    Number(lida?.regras_internas?.cobranca?.fundo_reserva_pct) === 10
    && JSON.stringify(Object.keys(lida?.regras_internas || {}).sort())
       === JSON.stringify([...new Set([...Object.keys(regras), "cobranca"])].sort()));

  const { data: unidades } = await admin.from("unidades")
    .select("id, responsavel_financeiro_id").eq("condominio_id", COND).is("deletado_em", null);
  const alvo = (unidades || []).find((u) => u.responsavel_financeiro_id);
  if (!alvo) {
    for (const n of ["baixa divide taxa + fundo", "mora fora do fundo", "desconto proporcional"])
      pula(n, "sem unidade com responsável — rode testar-manuais-seed.mjs");
  } else {
    for (const comp of COMPS) await admin.from("cobrancas").delete().eq("condominio_id", COND).eq("competencia", comp);
    /* cobrança emitida com FR 10% embutido: principal 100 + fundo 10 = 110 */
    const criar = async (comp, vencimento, status) => (await admin.from("cobrancas").insert({
      condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavel_financeiro_id,
      competencia: comp, tipo: "extra", valor_original: 110, vencimento, status,
    }).select("id").single()).data;
    const baixar = (id, valor) => app.rpc("registrar_pagamento_manual", {
      p_cobranca_id: id, p_forma: "dinheiro", p_valor: valor, p_pago_em: new Date().toISOString(),
      p_justificativa: "Sonda fundo de reserva", p_tx: null, p_informado_id: null,
    });
    const lancsDe = async (id) => (await admin.from("lancamentos")
      .select("valor, data, competencia, categorias_financeiras(nome)")
      .eq("origem_tipo", "cobranca").eq("origem_id", id)).data || [];
    const fundoDe = (ls) => ls.find((l) => (l.categorias_financeiras?.nome || "").toLowerCase().includes("reserva"));
    const taxaDe = (ls) => ls.find((l) => (l.categorias_financeiras?.nome || "") === "Taxa condominial");

    /* F2 · pago = devido (110): taxa 100 + fundo 10, data de HOJE (caixa) */
    const c1 = await criar(COMPS[0], new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), "emitida");
    const { data: r1, error: e1 } = await baixar(c1.id, 110);
    ok("F2 baixa aceita (RPC)", !e1 && r1?.ok === true, e1?.message || JSON.stringify(r1));
    const ls1 = await lancsDe(c1.id);
    if (ls1.length < 2) {
      pula("F3 baixa divide taxa + fundo", "supabase-fundo-reserva.sql ainda não rodou — 1 lançamento só (degrada aberto)");
      pula("F4 mora fora do fundo", "idem");
      pula("F5 desconto proporcional", "idem");
    } else {
      ok("F3 divisão: taxa 100,00 + fundo 10,00 = pago 110, data de hoje e competência da cobrança",
        perto(Number(taxaDe(ls1)?.valor), 100) && perto(Number(fundoDe(ls1)?.valor), 10)
        && ls1.every((l) => l.data === hojeISO && l.competencia === COMPS[0]),
        JSON.stringify(ls1.map((l) => [l.categorias_financeiras?.nome, l.valor, l.data])));

      /* F4 · vencida com mora: pago 130 (20 de encargos) → fundo segue 10 (least) */
      const c2 = await criar(COMPS[1], "2019-08-10", "vencida");
      await baixar(c2.id, 130);
      const ls2 = await lancsDe(c2.id);
      ok("F4 mora não alimenta o fundo: pago 130 → taxa 120,00 + fundo 10,00",
        perto(Number(taxaDe(ls2)?.valor), 120) && perto(Number(fundoDe(ls2)?.valor), 10),
        JSON.stringify(ls2.map((l) => [l.categorias_financeiras?.nome, l.valor])));

      /* F5 · desconto negociado 50%: pago 55 → fundo 5,00 (proporcional) */
      const c3 = await criar(COMPS[2], "2019-09-10", "vencida");
      await baixar(c3.id, 55);
      const ls3 = await lancsDe(c3.id);
      ok("F5 desconto proporcional: pago 55 → taxa 50,00 + fundo 5,00",
        perto(Number(taxaDe(ls3)?.valor), 50) && perto(Number(fundoDe(ls3)?.valor), 5),
        JSON.stringify(ls3.map((l) => [l.categorias_financeiras?.nome, l.valor])));
    }

    /* limpeza: tudo que a sonda criou sai */
    const { data: criadas } = await admin.from("cobrancas").select("id").eq("condominio_id", COND).in("competencia", COMPS);
    for (const c of criadas || []) {
      await admin.from("pagamentos").delete().eq("cobranca_id", c.id);
      await admin.from("lancamentos").delete().eq("origem_tipo", "cobranca").eq("origem_id", c.id);
    }
    for (const comp of COMPS) await admin.from("cobrancas").delete().eq("condominio_id", COND).eq("competencia", comp);
  }
  await admin.from("condominios").update({ regras_internas: antes?.regras_internas ?? {} }).eq("id", COND);
  const { data: depois } = await admin.from("condominios").select("regras_internas").eq("id", COND).maybeSingle();
  ok("F6 regras_internas restauradas (Manuais intacto para as outras sondas)",
    JSON.stringify(depois?.regras_internas) === JSON.stringify(antes?.regras_internas ?? {}));
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🏦 FUNDO DE RESERVA OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
/* exitCode em vez de process.exit(): sockets abertos derrubam o libuv no Windows */
process.exitCode = falhas ? 1 : 0;
