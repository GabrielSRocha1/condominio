/* Sondas da SINCRONIZAÇÃO Histórico (planilha) ⇄ Cobranças
   (supabase-planilha-sync.sql).

   Bloco A (sem banco): a conciliação nova (situações paga/indevida, com
   prioridade sobre confere/difere; cancelada fora do mapa de chave e de
   soSistema; compat total sem carimbos), dataCongelamento e valorExibido
   (mora congela no pagamento; indevida zera numéricas e preserva texto).

   Bloco B (banco): pelo caminho do navegador (anon + JWT do diretor, com
   RLS) prova os dois triggers e a RPC: cobrança nova cria a planilha
   padrão e a linha; pagamento carimba a linha; cancelar_cobranca recusa
   paga/sem justificativa/morador, cancela emitida (carimbo + auditoria,
   sem tocar no caixa); re-emissão REUSA a linha indevida; import por cima
   preserva os carimbos. Sem o SQL novo, pula com ⏭️ em vez de falhar.

   Uso: node scripts/testar-planilha-sync.mjs   (bloco B exige npm run dev) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { conciliarPlanilha, dataCongelamento, valorExibido, mesesAteHoje } from "../src/lib/planilha.js";

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
const COMPS = ["2018-01", "2018-02"];                   // longe de todas as outras sondas

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* ══ A · conciliação, congelamento e zerados (puro) ══ */
console.log("━━ A · conciliação com carimbos (puro) ━━");

const cobrs = [
  { id: "c1", unidadeId: "u1", competencia: "2024-01", valor: 100, status: "pago" },
  { id: "c2", unidadeId: "u1", competencia: "2024-02", valor: 100, status: "cancelada" },
  { id: "c3", unidadeId: "u1", competencia: "2024-03", valor: 100, status: "emitida" },
  { id: "c4", unidadeId: "u2", competencia: "2024-03", valor: 100, status: "vencida" },
];
const { linhas: la, soSistema: sa } = conciliarPlanilha([
  { unidadeId: "u1", competencia: "2024-01", valor: 100 },                       // paga (status da cobrança)
  { unidadeId: "u1", competencia: "2024-02", valor: 999, cobranca_id: "c2" },    // indevida (apesar do valor diferir)
  { unidadeId: "u1", competencia: "2024-02", valor: 50 },                        // cancelada fora da chave → so_planilha
  { unidadeId: "u1", competencia: "2024-03", valor: 100 },                       // confere
  { unidadeId: "u1", competencia: "2024-04", valor: 50, pago: true },            // import pago SEM cobrança → so_planilha
  { unidadeId: "u1", competencia: "2024-05", valor: 70, pago_em: "2024-06-01" }, // paga (carimbo, sem cobrança)
  { competencia: "2024-06", valor: 10 },                                         // sem_chave
  { unidadeId: "u1", competencia: "2024-07", valor: 10, cancelada_em: "2024-08-01" }, // indevida (carimbo)
], cobrs);
ok("A1 situações por prioridade: indevida > paga > valor",
  la.map((l) => l.situacao).join(" ") ===
  "paga indevida so_planilha confere so_planilha paga sem_chave indevida",
  la.map((l) => l.situacao).join(" "));
ok("A2 cancelada fora de soSistema; não casada entra (c4)",
  sa.length === 1 && sa[0].id === "c4", sa.map((c) => c.id).join(" "));

const { linhas: lb, soSistema: sb } = conciliarPlanilha([
  { unidadeId: "u1", competencia: "2024-03", valor: 100 },
  { unidadeId: "u1", competencia: "2024-08", valor: 60 },
  { competencia: "x", valor: 1 },
], [{ id: "c9", unidadeId: "u1", competencia: "2024-03", valor: 90, status: "emitida" }]);
ok("A3 compat sem carimbos: difere/so_planilha/sem_chave como sempre",
  lb.map((l) => l.situacao).join(" ") === "difere so_planilha sem_chave" && sb.length === 0,
  lb.map((l) => l.situacao).join(" "));

ok("A4 dataCongelamento: cancelada_em > pago_em > pago(pagoEm) > vencimento > null",
  dataCongelamento({ cancelada_em: "2024-02-01", pago_em: "2024-03-01" }) === "2024-02-01"
  && dataCongelamento({ pago_em: "2024-03-01", pago: true, pagoEm: "2024-04-01" }) === "2024-03-01"
  && dataCongelamento({ pago: true, pagoEm: "2024-04-01" }) === "2024-04-01"
  && dataCongelamento({ pago: true, vencimento: "2024-05-10" }) === "2024-05-10"
  && dataCongelamento({ valor: 10 }) === null);

/* mora v2 com meses dinâmicos: pagamento do import congela, sem nada cresce */
const COLS = [
  { chave: "mes", titulo: "Mês", tipo: "texto", papel: "competencia", ordem: 0 },
  { chave: "base", titulo: "Base", tipo: "numero", papel: "valor_base", ordem: 1 },
  { chave: "fr", titulo: "% FR", tipo: "numero", papel: "percentual_fr", formato: "percent", ordem: 2 },
  { chave: "cant", titulo: "Cant.", tipo: "numero", papel: "meses", ordem: 3 },
  { chave: "tot", titulo: "Total", tipo: "numero", ordem: 4, calculada: {
    modelo: "mora", saida: "total", base: "base", fr: { num: 0 }, taxa: { num: 10 },
    meses: { col: "cant", dinamico: true }, regime: "simples" } },
];
const dadosMora = { mes: "2024-01", base: 100, fr: 1.02, cant: "" };
const colTot = COLS[4];
const congelado = valorExibido({ dados: dadosMora, pago: true, pagoEm: "2024-07-15" }, colTot, COLS);
const vivo = valorExibido({ dados: dadosMora }, colTot, COLS);
const mesesVivos = mesesAteHoje("2024-01");
const perto = (a, b) => Math.abs(a - b) < 1e-9;
ok("A5 pagamento declarado no import congela a mora (6 meses); sem nada, cresce",
  perto(congelado, 100 * (1 + 0.10 * 6)) && perto(vivo, 100 * (1 + 0.10 * mesesVivos)),
  `congelado ${congelado} · vivo ${vivo} (${mesesVivos} meses)`);
const lPaga = { situacao: "paga", dados: dadosMora, pago_em: "2024-07-15" };
const lInd = { situacao: "indevida", dados: dadosMora, cancelada_em: "2024-09-01" };
ok("A6 paga e indevida zeram o DINHEIRO (calculada + valor) e preservam %/meses/texto",
  [lPaga, lInd].every((l) =>
    valorExibido(l, colTot, COLS) === 0           // calculada (dinheiro) → 0
    && valorExibido(l, COLS[1], COLS) === 0       // papel valor_base → 0
    && valorExibido(l, COLS[2], COLS) === 1.02    // percentual preservado
    && valorExibido(l, COLS[3], COLS) === ""      // meses (célula vazia) intacto
    && valorExibido(l, COLS[0], COLS) === "2024-01"), // texto preservado
  `tot ${valorExibido(lPaga, colTot, COLS)} · base ${valorExibido(lPaga, COLS[1], COLS)} · fr ${valorExibido(lPaga, COLS[2], COLS)}`);

/* ══ B · triggers e RPC no banco (anon + JWT, com RLS) ══ */
console.log("\n━━ B · sincronização no banco ━━");

const B = ["trigger cria planilha padrão e linha", "pagamento carimba a linha",
  "cancelar recusa paga", "cancela emitida (carimbo + auditoria, caixa intocado)",
  "re-emissão reusa a linha indevida", "guardas (justificativa, morador)",
  "import por cima preserva carimbos"];

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" }),
}).then((r) => r.json()).catch(() => ({}));

if (!login.token) {
  for (const n of B) pula(n, `login do diretor falhou — o dev server está de pé em ${BASE}? (npm run dev)`);
} else {
  const app = clienteApp(login.token);
  const { error: eCol } = await app.from("planilha_cobranca_linhas").select("cancelada_em").limit(1);
  if (eCol) {
    for (const n of B) pula(n, /does not exist|schema cache|PGRST/i.test(`${eCol.message} ${eCol.code || ""}`)
      ? "rode o supabase-planilha-sync.sql (e antes o supabase-planilhas.sql) no SQL Editor"
      : eCol.message);
  } else {
    const { data: unidades } = await admin.from("unidades")
      .select("id, numero, responsavel_financeiro_id, blocos(nome)").eq("condominio_id", COND).is("deletado_em", null);
    const alvo = (unidades || []).find((u) => u.responsavel_financeiro_id);
    const label = alvo ? `${alvo.numero}${alvo.blocos?.nome ? `-${alvo.blocos.nome}` : ""}` : "";

    const limpar = async () => {  // planilhas PRIMEIRO (solta os vínculos), depois pagamentos → cobranças
      const { data: pls } = await admin.from("planilhas_cobranca").select("id").eq("condominio_id", COND);
      for (const p of pls || []) await admin.from("planilhas_cobranca").delete().eq("id", p.id);
      const { data: cobs } = await admin.from("cobrancas").select("id").eq("condominio_id", COND).in("competencia", COMPS);
      const ids = (cobs || []).map((c) => c.id);
      if (ids.length) {
        await admin.from("pagamentos").delete().in("cobranca_id", ids);
        await admin.from("lancamentos").delete().eq("origem_tipo", "cobranca").in("origem_id", ids);
        await admin.from("cobrancas").delete().in("id", ids);
      }
    };

    if (!alvo) {
      for (const n of B) pula(n, "nenhuma unidade com responsável financeiro — rode scripts/testar-manuais-seed.mjs");
    } else {
      await limpar();

      /* T1 · cobrança nova → planilha padrão + linha */
      const { data: cob1, error: e1 } = await app.from("cobrancas").insert({
        condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavel_financeiro_id,
        competencia: COMPS[0], tipo: "ordinaria", valor_original: 150, vencimento: `${COMPS[0]}-10`, status: "emitida",
      }).select().single();
      const { data: pl } = await admin.from("planilhas_cobranca").select("*").eq("condominio_id", COND).maybeSingle();
      const { data: l1 } = await admin.from("planilha_cobranca_linhas").select("*").eq("cobranca_id", cob1?.id || "").maybeSingle();
      ok("T1 trigger cria a planilha padrão e a linha da cobrança",
        !e1 && pl?.nome === "Histórico de cobranças" && Array.isArray(pl?.colunas) && pl.colunas.length === 5
        && l1?.dados?.unidade === label && Number(l1?.dados?.valor) === 150
        && l1?.competencia === COMPS[0] && l1?.dados?.vencimento === `${COMPS[0]}-10`,
        e1?.message || `planilha ${pl?.nome || "—"} · linha ${l1 ? JSON.stringify(l1.dados) : "—"}`);

      /* T2 · baixa manual → carimbo + célula pago */
      const { data: rPag } = await app.rpc("registrar_pagamento_manual", {
        p_cobranca_id: cob1.id, p_forma: "dinheiro", p_valor: 150,
        p_pago_em: new Date().toISOString(), p_justificativa: "sonda sync", p_tx: null, p_informado_id: null,
      });
      const { data: l1p } = await admin.from("planilha_cobranca_linhas").select("*").eq("cobranca_id", cob1.id).maybeSingle();
      ok("T2 pagamento carimba a linha (pago_em, valor_pago, célula pago)",
        rPag?.ok !== false && !!l1p?.pago_em && Number(l1p?.valor_pago) === 150 && Number(l1p?.dados?.pago) === 150,
        `pago_em ${l1p?.pago_em || "—"} · valor_pago ${l1p?.valor_pago || "—"} · célula ${l1p?.dados?.pago ?? "—"}`);

      /* T3 · cancelar paga é recusado */
      const { data: rNeg } = await app.rpc("cancelar_cobranca",
        { p_cobranca_id: cob1.id, p_justificativa: "não deveria passar" });
      ok("T3 cancelar cobrança paga é recusado (ja_paga)", rNeg?.ok === false && rNeg?.erro === "ja_paga",
        JSON.stringify(rNeg));

      /* T4 · cancela emitida: carimbo + auditoria, caixa intocado */
      const { data: cob2 } = await app.from("cobrancas").insert({
        condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavel_financeiro_id,
        competencia: COMPS[1], tipo: "ordinaria", valor_original: 200, vencimento: `${COMPS[1]}-10`, status: "emitida",
      }).select().single();
      const { count: lancAntes } = await admin.from("lancamentos")
        .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
      const { data: rCan } = await app.rpc("cancelar_cobranca",
        { p_cobranca_id: cob2.id, p_justificativa: "cobrança indevida — sonda" });
      const { data: cob2d } = await admin.from("cobrancas").select("status").eq("id", cob2.id).maybeSingle();
      const { data: l2 } = await admin.from("planilha_cobranca_linhas").select("*").eq("cobranca_id", cob2.id).maybeSingle();
      const { count: lancDepois } = await admin.from("lancamentos")
        .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
      const { data: aud } = await admin.from("auditoria_eventos").select("detalhe")
        .eq("evento", "cobranca_cancelada").eq("condominio_id", COND).order("quando", { ascending: false }).limit(1);
      ok("T4 cancela emitida: status, carimbo, auditoria e caixa intocado",
        rCan?.ok === true && cob2d?.status === "cancelada" && !!l2?.cancelada_em
        && lancAntes === lancDepois && aud?.[0]?.detalhe?.cobranca_id === cob2.id,
        `rpc ${JSON.stringify(rCan)} · status ${cob2d?.status} · carimbo ${l2?.cancelada_em || "—"} · lanç ${lancAntes}→${lancDepois}`);

      /* T5 · re-emissão reusa a linha indevida */
      const { count: antes } = await admin.from("planilha_cobranca_linhas")
        .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id);
      const { data: cob3, error: e3 } = await app.from("cobrancas").insert({
        condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavel_financeiro_id,
        competencia: COMPS[1], tipo: "ordinaria", valor_original: 222, vencimento: `${COMPS[1]}-10`, status: "emitida",
      }).select().single();
      const { count: depois } = await admin.from("planilha_cobranca_linhas")
        .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id);
      const { data: l2r } = await admin.from("planilha_cobranca_linhas").select("*")
        .eq("planilha_id", pl.id).eq("competencia", COMPS[1]).maybeSingle();
      ok("T5 re-emissão reusa a linha (sem duplicar, carimbo limpo, valor novo)",
        !e3 && antes === depois && l2r?.cobranca_id === cob3?.id && !l2r?.cancelada_em
        && Number(l2r?.dados?.valor) === 222,
        e3?.message || `${antes}→${depois} linha(s) · valor ${l2r?.dados?.valor} · carimbo ${l2r?.cancelada_em || "limpo"}`);

      /* T6 · guardas: sem justificativa e morador */
      const { data: rJus } = await app.rpc("cancelar_cobranca", { p_cobranca_id: cob3.id, p_justificativa: "  " });
      const loginM = await fetch(`${BASE}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfil: "morador", nome: "Morador Manuais", senha: "teste123" }),
      }).then((r) => r.json()).catch(() => ({}));
      const rMor = loginM.token
        ? (await clienteApp(loginM.token).rpc("cancelar_cobranca",
            { p_cobranca_id: cob3.id, p_justificativa: "morador tentando" })).data
        : null;
      ok("T6 guardas: justificativa obrigatória e morador não cancela",
        rJus?.erro === "justificativa_obrigatoria" && (!loginM.token || rMor?.erro === "nao_autorizado"),
        `just ${rJus?.erro} · morador ${loginM.token ? rMor?.erro : "login falhou (tolerado)"}`);

      /* T7 · import por cima NÃO apaga os carimbos */
      await app.from("planilha_cobranca_linhas").upsert({
        condominio_id: COND, planilha_id: pl.id, unidade_id: alvo.id, competencia: COMPS[0],
        dados: { unidade: label, competencia: COMPS[0], valor: 150 }, origem: "planilha", ordem: 50,
      }, { onConflict: "planilha_id,unidade_id,competencia" });
      const { data: l1i } = await admin.from("planilha_cobranca_linhas").select("*")
        .eq("planilha_id", pl.id).eq("competencia", COMPS[0]).maybeSingle();
      ok("T7 import por cima preserva pago_em/valor_pago", !!l1i?.pago_em && Number(l1i?.valor_pago) === 150,
        `pago_em ${l1i?.pago_em || "PERDIDO"} · valor_pago ${l1i?.valor_pago ?? "PERDIDO"}`);

      await limpar();
      const { count: sobrou } = await admin.from("planilhas_cobranca")
        .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
      ok("limpeza: cenário da sonda removido", sobrou === 0, `${sobrou} planilha(s) restante(s)`);
    }
  }
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n📗 SINCRONIZAÇÃO PLANILHA ⇄ COBRANÇAS OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
