/* Sondas do HISTÓRICO DE COBRANÇAS POR PLANILHA.

   Bloco A (sem banco): gera um .xlsx com cabeçalhos FORA do padrão
   ("Apto", "Mês", "Cobrado", "Recebido") e confere que o app descobre
   sozinho as colunas, os tipos, o papel de cada uma e concilia.

   Bloco B (banco): roda contra as tabelas do supabase-planilhas.sql com
   o MESMO caminho do navegador — cliente anon + JWT do diretor, logo
   passando pelo RLS. Detecta sozinho se o SQL ainda não rodou e pula com
   ⏭️ em vez de falhar. O que ele prova: dedupe da 2ª carga, edição de
   célula, criação das cobranças que faltam e — o mais importante — que
   NENHUM lançamento entra no caixa.

   Uso: node scripts/testar-planilha-cobrancas.mjs   (dev server de pé) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  lerPlanilhaLivre, resolverLinha, conciliarPlanilha, valorCalculado,
  carregarExcelJS, normalizarCompetencia, paraNumero, inferirPapel, mesesAteHoje, resolverUnidade,
} from "../src/lib/planilha.js";

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
const COMP_TESTE = ["2019-01", "2019-02", "2019-03"];   // longe do cenário vivo

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* ══ A · leitura de planilha com colunas livres (sem banco) ══ */
console.log("━━ A · planilha com as colunas do condomínio ━━");

const ExcelJS = await carregarExcelJS();
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Cobranças 2019");
ws.addRow(["Apto", "Mês", "Cobrado", "Recebido", "Vencimento"]);
ws.addRow(["101-A", "01/2019", "R$ 450,00", "450", "10/01/2019"]);
ws.addRow(["102-A", "01/2019", "R$ 450,00", "0", "10/01/2019"]);
ws.addRow(["101-A", "02/2019", "1.234,56", "1.234,56", "10/02/2019"]);
ws.addRow(["Total", "", "2.134,56", "1.684,56", ""]);   // linha sem unidade: não concilia
const buf = await wb.xlsx.writeBuffer();
const arquivo = { name: "historico-2019.xlsx", size: buf.byteLength, arrayBuffer: async () => buf };

const lido = await lerPlanilhaLivre(arquivo);
ok("lê a planilha sem modelo fixo", lido.linhas.length === 4 && lido.colunas.length === 5,
  `${lido.colunas.length} coluna(s), ${lido.linhas.length} linha(s) ${lido.errosGerais.join(" ")}`);
const porTitulo = Object.fromEntries(lido.colunas.map((c) => [c.titulo, c]));
ok("descobre o papel de cada coluna pelo cabeçalho",
  porTitulo.Apto?.papel === "unidade" && porTitulo["Mês"]?.papel === "competencia"
  && porTitulo.Cobrado?.papel === "valor" && porTitulo.Recebido?.papel === "pago"
  && porTitulo.Vencimento?.papel === "vencimento",
  lido.colunas.map((c) => `${c.titulo}→${c.papel || "—"}`).join(" "));
ok("infere o tipo das colunas", porTitulo.Cobrado?.tipo === "numero" && porTitulo.Vencimento?.tipo === "data",
  lido.colunas.map((c) => `${c.titulo}:${c.tipo}`).join(" "));
ok("converte \"R$ 1.234,56\" em número, não em texto",
  lido.linhas[2].dados[porTitulo.Cobrado.chave] === 1234.56,
  String(lido.linhas[2].dados[porTitulo.Cobrado.chave]));

/* unidades e cobranças de mentira, só para a conciliação */
const ctxFake = { unidades: [{ id: "u1", label: "101-A" }, { id: "u2", label: "102-A" }] };
const resolvidas = lido.linhas.map((l) => ({ ...l, ...resolverLinha(lido.colunas, l.dados, ctxFake) }));
ok("resolve unidade e competência das linhas",
  resolvidas[0].unidadeId === "u1" && resolvidas[0].competencia === "2019-01" && resolvidas[0].valor === 450,
  JSON.stringify({ u: resolvidas[0].unidadeId, c: resolvidas[0].competencia, v: resolvidas[0].valor }));
ok("linha de total (sem unidade) não finge ter chave", !resolvidas[3].unidadeId && resolvidas[3].competencia === "");

const cobrancasFake = [
  { unidadeId: "u1", competencia: "2019-01", valor: 450 },     // confere
  { unidadeId: "u2", competencia: "2019-01", valor: 430 },     // difere
  { unidadeId: "u2", competencia: "2019-02", valor: 450 },     // só no sistema
];
const conc = conciliarPlanilha(resolvidas, cobrancasFake);
const sit = (s) => conc.linhas.filter((l) => l.situacao === s).length;
ok("concilia nos quatro estados",
  sit("confere") === 1 && sit("difere") === 1 && sit("so_planilha") === 1 && sit("sem_chave") === 1 && conc.soSistema.length === 1,
  `confere ${sit("confere")} · difere ${sit("difere")} · só planilha ${sit("so_planilha")} · sem chave ${sit("sem_chave")} · só sistema ${conc.soSistema.length}`);
ok("pagamento vira status: 450 recebido = pago, 0 = em aberto",
  resolvidas[0].pago === true && resolvidas[1].pago === false);
const colCalc = { chave: "saldo", calculada: { esq: porTitulo.Cobrado.chave, op: "-", dir: porTitulo.Recebido.chave } };
ok("coluna calculada (Cobrado − Recebido)", valorCalculado(lido.linhas[1].dados, colCalc) === 450,
  String(valorCalculado(lido.linhas[1].dados, colCalc)));
ok("competência aceita os formatos do mundo real",
  normalizarCompetencia("set/2026") === "2026-09" && normalizarCompetencia("2026-09") === "2026-09"
  && normalizarCompetencia("9/2026") === "2026-09" && normalizarCompetencia("2026-09-15") === "2026-09");
ok("número não confunde milhar com decimal",
  paraNumero("1.234") === 1234 && paraNumero("1.23") === 1.23 && paraNumero("1,234.56") === 1234.56);

/* ══ A2 · layout "planilla de mora" — fixture SINTÉTICA com a estrutura e
   os números do arquivo real (sem nenhum dado pessoal): blocos por ano,
   cabeçalho em 2 linhas, título mesclado, typos FEBERO/SETIEMBRE, unidade
   mesclada, CANT. "15\n14", subtotal no meio, escala ÷1000 e UMA célula de
   juros defasada do CANT (como no arquivo de origem). ══ */
console.log("\n━━ A2 · planilla de mora (blocos por ano) ━━");

const MES_ES = ["ENERO", "FEBERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const wbM = new ExcelJS.Workbook();
const wsM = wbM.addWorksheet("Table 1");
const cel = (ref, v) => { wsM.getCell(ref).value = v; };
wsM.mergeCells("A1:K1");
cel("A1", "PLANILLA DE CALCULO DE MORA CON INTERESES PROPIETARIO: TESTE");
["A2", "B2", "C2", "D2", "J2"].forEach((r, i) => cel(r, ["UNID.", "MESES", "AÑO EXPENSAS", "% F.R.", "CANT."][i]));
wsM.mergeCells("E2:I2"); cel("E2", "INTERESES MORATORIO");
["A3", "B3", "D3", "E3", "F3", "G3", "H3", "I3", "J3"].forEach((r, i) =>
  cel(r, ["UNID.", "MESES", "% F.R.", "EXPENSAS", "EXPENSAS", "10% F.R.", "MONTO", "2,3%", "MESES"][i]));
cel("C3", 2025);
for (let m = 0; m < 12; m++) {
  const L = 4 + m;
  cel(`B${L}`, MES_ES[m]); cel(`D${L}`, "1,02");
  for (const col of ["C", "E", "F", "G", "H", "I"]) cel(`${col}${L}`, 0);
  if (m === 7) { // AGOSTO com dívida — juros defasados do CANT, como no arquivo real
    cel(`C${L}`, "26.230.835"); cel(`E${L}`, 267.555); cel(`F${L}`, 267.555);
    cel(`G${L}`, 26.755); cel(`H${L}`, 294.31); cel(`I${L}`, 114.781);
  }
  if (m === 5) { wsM.mergeCells(`A${L}:A${L + 1}`); cel(`A${L}`, "3-D"); wsM.mergeCells(`J${L}:J${L + 1}`); cel(`J${L}`, "15\n14"); }
  else if (m !== 6) cel(`J${L}`, 20 - m);
}
wsM.mergeCells("F16:H16"); cel("F16", "Monto total  - Interés 2,3%"); cel("I16", 114.781); // subtotal: pular
// bloco 2020 SEM a coluna CANT. no cabeçalho (herda do bloco de cima)
["A18", "B18", "C18", "D18"].forEach((r, i) => cel(r, ["UNIDAD", "MESES", "AÑO EXPENSAS", "% F.R."][i]));
wsM.mergeCells("E18:I18"); cel("E18", "INTERESES MORATORIO");
["A19", "B19", "D19", "E19", "F19", "G19", "H19", "I19"].forEach((r, i) =>
  cel(r, ["UNIDAD", "MESES", "% F.R.", "EXPENSAS", "EXPENSAS", "10% F.R.", "MONTO", "2,3%"][i]));
cel("C19", 2020);
for (let m = 0; m < 12; m++) {
  const L = 20 + m;
  cel(`B${L}`, MES_ES[m]); cel(`D${L}`, "1,02"); cel(`J${L}`, 80 - m);
  for (const col of ["C", "E", "F", "G", "H", "I"]) cel(`${col}${L}`, 0);
  if (m === 4) { // MAYO com dívida — todas as fórmulas consistentes
    cel(`C${L}`, "24.434.850"); cel(`E${L}`, 249.235); cel(`F${L}`, 249.235);
    cel(`G${L}`, 24.924); cel(`H${L}`, 274.159); cel(`I${L}`, 479.23);
  }
  if (m === 5) { wsM.mergeCells(`A${L}:A${L + 1}`); cel(`A${L}`, "3-D"); }
}
wbM.addWorksheet("Hoja2"); // aba vazia, como no arquivo real
const bufM = await wbM.xlsx.writeBuffer();
const arqMora = { name: "Planilla de deuda 3-D Teste.xlsx", size: bufM.byteLength, arrayBuffer: async () => bufM };

const mora = await lerPlanilhaLivre(arqMora, { mesesDoArquivo: true });
ok("A2.1 detecta o layout mora (2 blocos, anos certos)",
  mora.layout === "mora" && mora.mora?.blocos === 2 && String([...new Set(mora.mora.anos)].sort()) === "2020,2025",
  `layout ${mora.layout} · blocos ${mora.mora?.blocos} · anos ${mora.mora?.anos}`);
ok("A2.2 achata só os meses com dívida (zerados fora por padrão)",
  mora.linhas.length === 2, `${mora.linhas.length} linha(s)`);
const porComp = Object.fromEntries(mora.linhas.map((l) => [l.dados.competencia, l.dados]));
const m2020 = porComp["2020-05"], m2025 = porComp["2025-08"];
ok("A2.3 competência = ano do bloco + mês da linha; unidade da célula mesclada",
  !!m2020 && !!m2025 && m2020.unidade === "3-D" && m2025.unidade === "3-D",
  Object.keys(porComp).join(" "));
ok("A2.4 escala ÷1000 corrigida (e avisada)",
  m2020?.expensas === 249235 && m2020?.monto === 274159 && m2020?.interes === 479230
  && m2025?.expensas === 267555 && mora.errosGerais.some((e) => /1\.000/.test(e)),
  JSON.stringify({ e: m2020?.expensas, m: m2020?.monto, i: m2020?.interes }));
ok("A2.5 parâmetros do reglamento saem do cabeçalho (10% F.R., 2,3%)",
  m2020?.pct_fr === 10 && m2020?.taxa_mora === 2.3 && m2020?.meses_atraso === 76,
  JSON.stringify({ fr: m2020?.pct_fr, taxa: m2020?.taxa_mora, meses: m2020?.meses_atraso }));

const colMora = Object.fromEntries(mora.colunas.map((c) => [c.chave, c]));
ok("A2.6 papéis e formatos prontos (monto = valor a conciliar; percentuais marcados)",
  colMora.monto?.papel === "valor" && colMora.expensas?.papel === "valor_base"
  && colMora.pct_fr?.formato === "percent" && colMora.taxa_mora?.formato === "percent"
  && colMora.meses_atraso?.papel === "meses");
const recM = colMora.monto_recalc, recI = colMora.interes_recalc;
const vMonto = (d) => valorCalculado(d, recM, mora.colunas);
const vInt = (d) => valorCalculado(d, recI, mora.colunas);
ok("A2.7 MONTO recalculado bate com o importado (±5) nas duas linhas",
  !!recM && Math.abs(vMonto(m2020) - m2020.monto) <= 5 && Math.abs(vMonto(m2025) - m2025.monto) <= 5,
  `2020: ${vMonto(m2020)?.toFixed(1)} vs ${m2020?.monto} · 2025: ${vMonto(m2025)?.toFixed(1)} vs ${m2025?.monto}`);
const difere2020 = Math.abs(vInt(m2020) - m2020.interes) > 5, difere2025 = Math.abs(vInt(m2025) - m2025.interes) > 5;
ok("A2.8 INTERÉS: consistente confere; a célula defasada do arquivo acusa 'difere' (exatamente 1)",
  !!recI && !difere2020 && difere2025,
  `2020: ${vInt(m2020)?.toFixed(1)} vs ${m2020?.interes} · 2025: ${vInt(m2025)?.toFixed(1)} vs ${m2025?.interes}`);

/* CANT. "15\n14" na célula mesclada: cada linha do par leva o seu número */
const moraTudo = await lerPlanilhaLivre(arqMora, { mesesDoArquivo: true, incluirZerados: true });
const porCompT = Object.fromEntries(moraTudo.linhas.map((l) => [l.dados.competencia, l.dados]));
ok("A2.9 CANT. mesclada '15\\n14' distribui por linha (JUN=15, JUL=14)",
  porCompT["2025-06"]?.meses_atraso === 15 && porCompT["2025-07"]?.meses_atraso === 14,
  JSON.stringify({ jun: porCompT["2025-06"]?.meses_atraso, jul: porCompT["2025-07"]?.meses_atraso }));

/* meses DINÂMICOS (padrão): célula vazia → conta da competência até hoje */
const moraDin = await lerPlanilhaLivre(arqMora, {});
const dDin = moraDin.linhas.find((l) => l.dados.competencia === "2020-05")?.dados;
const hojeFixo = new Date(2026, 9, 14); // 14/10/2026 — determinístico
const esperadoMeses = mesesAteHoje("2020-05", hojeFixo); // 77
const colsDin = moraDin.colunas;
const recIDin = colsDin.find((c) => c.chave === "interes_recalc");
const intDin = valorCalculado(dDin, recIDin, colsDin, { hoje: hojeFixo });
ok("A2.10 padrão dinâmico: meses vazios contam até hoje (77 p/ 2020-05) e o juro acompanha",
  dDin?.meses_atraso === "" && esperadoMeses === 77 && Math.abs(intDin - 274158.5 * 0.023 * 77) < 1,
  `meses ${JSON.stringify(dDin?.meses_atraso)} · ${esperadoMeses} meses · juros ${intDin?.toFixed(1)}`);

/* ══ A3 · cabeçalho de verdade no meio do arquivo (título mesclado) ══ */
console.log("\n━━ A3 · detecção da linha de cabeçalho ━━");
const wb3 = new ExcelJS.Workbook();
const ws3 = wb3.addWorksheet("Liquidacion");
ws3.mergeCells("A1:D1"); ws3.getCell("A1").value = "CONSORCIO LOS ROBLES - LIQUIDACION DE EXPENSAS";
ws3.addRow([]); // linha 2 em branco é absorvida
ws3.getCell("A3").value = "Unidad"; ws3.getCell("B3").value = "Mes";
ws3.getCell("C3").value = "Expensas"; ws3.getCell("D3").value = "Pagado";
ws3.getCell("A4").value = "101-A"; ws3.getCell("B4").value = "01/2024";
ws3.getCell("C4").value = 450; ws3.getCell("D4").value = 450;
const buf3 = await wb3.xlsx.writeBuffer();
const lido3 = await lerPlanilhaLivre({ name: "liq.xlsx", size: buf3.byteLength, arrayBuffer: async () => buf3 });
const pt3 = Object.fromEntries(lido3.colunas.map((c) => [c.titulo, c]));
ok("A3.1 pula o título mesclado e acha o cabeçalho real (linha 3)",
  lido3.layout === "plano" && lido3.cabecalhoNa === 3 && lido3.colunas.length === 4 && lido3.linhas.length === 1,
  `cabeçalho na ${lido3.cabecalhoNa} · ${lido3.colunas.length} col · ${lido3.linhas.length} linha`);
ok("A3.2 vocabulário ES no caminho plano (Expensas→valor_base, Pagado→pago)",
  pt3.Unidad?.papel === "unidade" && pt3.Mes?.papel === "competencia"
  && pt3.Expensas?.papel === "valor_base" && pt3.Pagado?.papel === "pago",
  lido3.colunas.map((c) => `${c.titulo}→${c.papel || "—"}`).join(" "));
const res3 = resolverLinha(lido3.colunas, lido3.linhas[0].dados, { unidades: [{ id: "u1", label: "101-A" }] });
ok("A3.3 sem coluna de valor final, a cota (valor_base) concilia", res3.valor === 450, String(res3.valor));

/* ══ A4 · csv com linha-título curta não decapita colunas ══ */
const csvTxt = "LIQUIDACION 2024\nUnidad;Mes;Expensas\n101-A;01/2024;450;400\n102-A;02/2024;300;0\n";
const bufCsv = new TextEncoder().encode(csvTxt).buffer;
const lido4 = await lerPlanilhaLivre({ name: "liq.csv", size: bufCsv.byteLength, arrayBuffer: async () => bufCsv });
ok("A4 csv: título curto pulado e coluna além do cabeçalho sobrevive",
  lido4.cabecalhoNa === 2 && lido4.colunas.length === 4 && lido4.linhas[0].dados[lido4.colunas[3].chave] === 400,
  `cabeçalho na ${lido4.cabecalhoNa} · ${lido4.colunas.length} col`);

/* ══ A5 · percentual: texto "10%" e célula % do Excel (0,023 + numFmt) ══ */
const wb5 = new ExcelJS.Workbook();
const ws5 = wb5.addWorksheet("P");
ws5.addRow(["Unidad", "Mes", "% F.R.", "Interés"]);
ws5.addRow(["101-A", "01/2024", "10%", 0]);
ws5.getCell("D2").value = 0.023; ws5.getCell("D2").numFmt = "0.0%";
ws5.addRow(["102-A", "02/2024", "10%", 0]);
ws5.getCell("D3").value = 0.05; ws5.getCell("D3").numFmt = "0%";
const buf5 = await wb5.xlsx.writeBuffer();
const lido5 = await lerPlanilhaLivre({ name: "p.xlsx", size: buf5.byteLength, arrayBuffer: async () => buf5 });
const pt5 = Object.fromEntries(lido5.colunas.map((c) => [c.titulo, c]));
ok("A5 percentual: papel + formato + escala humana (10% → 10; 0,023+numFmt → 2.3)",
  pt5["% F.R."]?.papel === "percentual_fr" && pt5["% F.R."]?.formato === "percent"
  && pt5["Interés"]?.papel === "taxa_mora" && pt5["Interés"]?.formato === "percent"
  && lido5.linhas[0].dados[pt5["% F.R."].chave] === 10
  && lido5.linhas[0].dados[pt5["Interés"].chave] === 2.3,
  JSON.stringify({ fr: lido5.linhas[0].dados[pt5["% F.R."]?.chave], tx: lido5.linhas[0].dados[pt5["Interés"]?.chave] }));

/* ══ A6 · vocabulário ES de cobrança e os falsos positivos barrados ══ */
ok("A6 papéis ES (e 'Morador'/'Cantina' NÃO viram papel por substring)",
  inferirPapel("EXPENSAS") === "valor_base" && inferirPapel("AÑO EXPENSAS") === "ano"
  && inferirPapel("INTERESES MORATORIO") === "taxa_mora" && inferirPapel("CANT.") === "meses"
  && inferirPapel("% F.R.") === "percentual_fr" && inferirPapel("MONTO") === "valor"
  && inferirPapel("Cuota") === "valor_base" && inferirPapel("Morador") === null && inferirPapel("Cantina") === null,
  ["EXPENSAS", "AÑO EXPENSAS", "INTERESES MORATORIO", "CANT.", "Morador", "Cantina"].map((s) => `${s}→${inferirPapel(s) || "—"}`).join(" "));

/* ══ A7 · calculada: recursão, ciclo e constante ══ */
const colsRec = [
  { chave: "a", titulo: "A", tipo: "numero" },
  { chave: "dobro", calculada: { esq: "a", op: "*", dir: 2 } },
  { chave: "quadruplo", calculada: { esq: "dobro", op: "*", dir: 2 } },
  { chave: "cx", calculada: { esq: "cy", op: "+", dir: 1 } },
  { chave: "cy", calculada: { esq: "cx", op: "+", dir: 1 } },
];
ok("A7 calculada sobre calculada resolve em cadeia; ciclo não trava; constante vale",
  valorCalculado({ a: 10 }, colsRec[2], colsRec) === 40
  /* no ciclo, a referência circular resolve como null (0) no ponto da volta:
     cy = 0+1 = 1 → cx = 1+1 = 2 — determinístico, sem estourar a pilha */
  && valorCalculado({ a: 10 }, colsRec[3], colsRec) === 2
  && valorCalculado({ a: 10 }, colsRec[1], colsRec) === 20,
  `quadruplo ${valorCalculado({ a: 10 }, colsRec[2], colsRec)} · ciclo ${valorCalculado({ a: 10 }, colsRec[3], colsRec)}`);

/* ══ A9 · resolução de unidade tolerante a separadores ══
   O caso real: a planilla escreve "3-D" e a unidade cadastrada é "3D"
   (bloco A) — o hífen não pode impedir o casamento, mas ambiguidade não
   resolve. Os formatos exatos de sempre continuam na frente. */
{
  const ctxSep = { unidades: [
    { id: "u3d", label: "3D-A", bloco: "A" },
    { id: "u1a", label: "1A-A", bloco: "A" },
    { id: "u101", label: "101-A", bloco: "A" },
  ] };
  const r = (t) => resolverUnidade(t, ctxSep);
  ok("A9 '3-D', '3 D' e '3d' casam com a unidade 3D; formatos exatos intactos",
    r("3-D").id === "u3d" && r("3 D").id === "u3d" && r("3d").id === "u3d"
    && r("101-A").id === "u101" && r("1A").id === "u1a" && r("A-101").id === "u101",
    ["3-D", "3 D", "101-A", "1A"].map((t) => `${t}→${r(t).id || "erro"}`).join(" "));
  const ctxAmb = { unidades: [{ id: "x1", label: "3D-A", bloco: "A" }, { id: "x2", label: "3D-B", bloco: "B" }] };
  ok("A9b '3-D' ambíguo (3D nos blocos A e B) não resolve", !!resolverUnidade("3-D", ctxAmb).erro);
  const linhaSep = resolverLinha(
    [{ chave: "u", titulo: "Unid.", tipo: "texto", papel: "unidade" }, { chave: "c", titulo: "Mes", tipo: "texto", papel: "competencia" }, { chave: "v", titulo: "Monto", tipo: "numero", papel: "valor" }],
    { u: "3-D", c: "2020-05", v: 274159 }, ctxSep);
  ok("A9c linha da planilha com '3-D' resolve e concilia",
    linhaSep.unidadeId === "u3d" && linhaSep.competencia === "2020-05" && linhaSep.valor === 274159);
}

/* ══ A8 · competência ES que faltava ══ */
ok("A8 'ene/dic' e ano de 2 dígitos com mês textual",
  normalizarCompetencia("ene/2024") === "2024-01" && normalizarCompetencia("dic-2023") === "2023-12"
  && normalizarCompetencia("ene/24") === "2024-01" && normalizarCompetencia("setiembre 2026") === "2026-09",
  ["ene/2024", "dic-2023", "ene/24", "setiembre 2026"].map((s) => `${s}→${normalizarCompetencia(s) || "—"}`).join(" "));

/* ══ B · banco, pelo caminho do navegador (anon + JWT, com RLS) ══ */
console.log("\n━━ B · gravação e conciliação no banco ━━");

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" }),
}).then((r) => r.json()).catch(() => ({}));

if (!login.token) {
  for (const n of ["tabelas do supabase-planilhas.sql", "grava a planilha", "dedupe da 2ª carga",
    "edição de célula", "cria as cobranças que faltam", "não lança no caixa"])
    pula(n, `login do diretor falhou — o dev server está de pé em ${BASE}? (npm run dev)`);
} else {
  const app = clienteApp(login.token);
  const { error: eTab } = await app.from("planilhas_cobranca").select("id").limit(1);
  const semSql = eTab && /does not exist|schema cache|PGRST205/i.test(`${eTab.message} ${eTab.code || ""}`);
  ok("tabelas do supabase-planilhas.sql existem", !eTab, semSql ? "rode o supabase-planilhas.sql no SQL Editor" : (eTab?.message || "ok"));

  if (eTab) {
    for (const n of ["grava a planilha", "dedupe da 2ª carga", "edição de célula",
      "cria as cobranças que faltam", "não lança no caixa"])
      pula(n, "sem as tabelas");
  } else {
    /* unidades reais do condomínio de teste */
    const { data: unidades } = await admin.from("unidades")
      .select("id, numero, responsavel_financeiro_id, blocos(nome)").eq("condominio_id", COND).is("deletado_em", null);
    const ctx = { condominioId: COND, unidades: (unidades || []).map((u) => ({
      id: u.id, label: `${u.numero}-${u.blocos?.nome || "?"}`, responsavelId: u.responsavel_financeiro_id })) };
    const alvo = ctx.unidades.find((u) => u.responsavelId);

    /* limpeza de uma execução anterior interrompida */
    await admin.from("cobrancas").delete().eq("condominio_id", COND).in("competencia", COMP_TESTE);
    const { data: antigas } = await admin.from("planilhas_cobranca").select("id").eq("condominio_id", COND);
    for (const p of antigas || []) await admin.from("planilhas_cobranca").delete().eq("id", p.id);

    if (!alvo) {
      for (const n of ["grava a planilha", "dedupe da 2ª carga", "edição de célula",
        "cria as cobranças que faltam", "não lança no caixa"])
        pula(n, "nenhuma unidade com responsável financeiro — rode scripts/testar-manuais-seed.mjs");
    } else {
      const colunas = [
        { chave: "apto", titulo: "Apto", tipo: "texto", papel: "unidade", ordem: 0 },
        { chave: "mes", titulo: "Mês", tipo: "texto", papel: "competencia", ordem: 1 },
        { chave: "cobrado", titulo: "Cobrado", tipo: "numero", papel: "valor", ordem: 2 },
      ];
      const linhasPlan = COMP_TESTE.map((comp, i) => ({
        condominio_id: COND, dados: { apto: alvo.label, mes: comp, cobrado: 100 + i },
        unidade_id: alvo.id, competencia: comp, origem: "planilha", ordem: i + 1,
      }));

      const { data: pl, error: eP } = await app.from("planilhas_cobranca")
        .insert({ condominio_id: COND, nome: "Sonda 2019", colunas }).select().single();
      ok("grava a planilha (RLS do diretor permite)", !eP && !!pl?.id, eP?.message || pl?.id || "");

      if (pl?.id) {
        const comPlanilha = linhasPlan.map((l) => ({ ...l, planilha_id: pl.id }));
        const { error: eL } = await app.from("planilha_cobranca_linhas")
          .upsert(comPlanilha, { onConflict: "planilha_id,unidade_id,competencia" });
        const cont = async () => (await app.from("planilha_cobranca_linhas")
          .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id)).count;
        ok("grava as linhas", !eL && (await cont()) === 3, eL?.message || `${await cont()} linha(s)`);

        /* 2ª carga do MESMO período: atualiza, não duplica */
        const { error: eL2 } = await app.from("planilha_cobranca_linhas")
          .upsert(comPlanilha.map((l) => ({ ...l, dados: { ...l.dados, cobrado: 999 } })),
            { onConflict: "planilha_id,unidade_id,competencia" });
        const depois = await cont();
        const { data: umaLinha } = await app.from("planilha_cobranca_linhas")
          .select("dados").eq("planilha_id", pl.id).eq("competencia", COMP_TESTE[0]).maybeSingle();
        ok("2ª carga acrescenta sem duplicar (dedupe por unidade + competência)",
          !eL2 && depois === 3 && umaLinha?.dados?.cobrado === 999, eL2?.message || `${depois} linha(s), valor ${umaLinha?.dados?.cobrado}`);

        /* edição de célula */
        const { data: alvoLinha } = await app.from("planilha_cobranca_linhas")
          .select("*").eq("planilha_id", pl.id).eq("competencia", COMP_TESTE[1]).maybeSingle();
        const { data: editada, error: eE } = await app.from("planilha_cobranca_linhas")
          .update({ dados: { ...alvoLinha.dados, cobrado: 777 } }).eq("id", alvoLinha.id).select().maybeSingle();
        ok("edita uma célula", !eE && editada?.dados?.cobrado === 777, eE?.message || String(editada?.dados?.cobrado));

        /* criar as cobranças que faltam — e NÃO lançar no caixa */
        const { count: lancAntes } = await admin.from("lancamentos")
          .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
        const novas = COMP_TESTE.map((comp) => ({
          condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavelId,
          competencia: comp, tipo: "ordinaria", valor_original: 100, vencimento: `${comp}-10`, status: "paga",
        }));
        const { data: criadas, error: eC } = await app.from("cobrancas").insert(novas).select();
        ok("cria as cobranças que faltam", !eC && criadas?.length === 3, eC?.message || `${criadas?.length || 0} criada(s)`);

        if (criadas?.length) {
          const porComp = new Map(criadas.map((c) => [c.competencia, c.id]));
          for (const comp of COMP_TESTE)
            await app.from("planilha_cobranca_linhas").update({ cobranca_id: porComp.get(comp) })
              .eq("planilha_id", pl.id).eq("competencia", comp);
          const { count: vinculadas } = await app.from("planilha_cobranca_linhas")
            .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id).not("cobranca_id", "is", null);
          ok("a linha passa a apontar a cobrança criada", vinculadas === 3, `${vinculadas}/3`);

          /* conciliação volta a 'confere' para as três */
          const comoNoApp = criadas.map((c) => ({ unidadeId: c.unidade_id, competencia: c.competencia, valor: Number(c.valor_original) }));
          const { data: linhasBanco } = await app.from("planilha_cobranca_linhas").select("*").eq("planilha_id", pl.id);
          const resolvidasBanco = linhasBanco.map((l) => ({ ...l, unidadeId: l.unidade_id, competencia: l.competencia, valor: l.dados.cobrado }));
          const conc2 = conciliarPlanilha(resolvidasBanco, comoNoApp);
          ok("depois de criar, nenhuma linha fica \"só na planilha\"",
            conc2.linhas.filter((l) => l.situacao === "so_planilha").length === 0,
            conc2.linhas.map((l) => l.situacao).join(" "));
        }

        const { count: lancDepois } = await admin.from("lancamentos")
          .select("id", { count: "exact", head: true }).eq("condominio_id", COND);
        ok("NÃO lança receita no caixa (saldo do dashboard intocado)", lancAntes === lancDepois,
          `lançamentos antes ${lancAntes} · depois ${lancDepois}`);

        /* morador NÃO escreve na planilha (RLS) */
        const loginM = await fetch(`${BASE}/api/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ perfil: "morador", nome: "Morador Manuais", senha: "teste123" }),
        }).then((r) => r.json()).catch(() => ({}));
        if (!loginM.token) pula("morador não escreve na planilha", "login do morador falhou");
        else {
          const appM = clienteApp(loginM.token);
          const { error: eM } = await appM.from("planilha_cobranca_linhas")
            .insert({ condominio_id: COND, planilha_id: pl.id, dados: { apto: "x" }, ordem: 99 });
          const { data: leu } = await appM.from("planilha_cobranca_linhas").select("id").eq("planilha_id", pl.id).limit(1);
          ok("morador lê, mas não escreve na planilha (tenant_escrita)", !!eM && !!leu?.length,
            `escrita ${eM ? "bloqueada" : "PERMITIDA"} · leitura ${leu?.length ? "ok" : "bloqueada"}`);
        }

        /* excluir a planilha INTEIRA: morador não consegue (RLS silencia o
           delete em 0 linhas); o DIRETOR consegue — e a exclusão é a própria
           limpeza da sonda (cascade nas linhas) */
        if (loginM.token) {
          await clienteApp(loginM.token).from("planilhas_cobranca").delete().eq("id", pl.id);
          const { data: aindaLa } = await app.from("planilhas_cobranca").select("id").eq("id", pl.id).maybeSingle();
          ok("morador não exclui a planilha (tenant_escrita)", !!aindaLa, aindaLa ? "planilha intacta" : "FOI EXCLUÍDA");
        }
        await admin.from("planilha_cobranca_linhas").update({ cobranca_id: null }).eq("planilha_id", pl.id);
        const { error: eDel } = await app.from("planilhas_cobranca").delete().eq("id", pl.id);
        const { data: sumiu } = await app.from("planilhas_cobranca").select("id").eq("id", pl.id).maybeSingle();
        ok("diretor exclui a planilha inteira", !eDel && !sumiu, eDel?.message || (sumiu ? "ainda existe" : "ok"));
        await admin.from("cobrancas").delete().eq("condominio_id", COND).in("competencia", COMP_TESTE);
        const { count: sobrou } = await admin.from("planilha_cobranca_linhas")
          .select("id", { count: "exact", head: true }).eq("planilha_id", pl.id);
        ok("limpeza: cenário da sonda removido (cascade nas linhas)", sobrou === 0, `${sobrou} linha(s) restante(s)`);
      }
    }
  }
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n📗 PLANILHA DE COBRANÇAS OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
/* exitCode em vez de process.exit(): com os sockets do supabase-js ainda
   abertos, a saída abrupta derruba o libuv com assert no Windows */
process.exitCode = falhas ? 1 : 0;
