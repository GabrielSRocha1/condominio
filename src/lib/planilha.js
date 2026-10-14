/* Núcleo de planilha, compartilhado por quem lê arquivo no app:
   · importação de PESSOAS (importPessoas.js) — esquema fixo, 7 colunas;
   · histórico de COBRANÇAS — colunas livres, as do arquivo do condomínio.

   O que vive aqui é o que não depende de esquema: carregar o exceljs sob
   demanda, reduzir a célula do exceljs a um valor cru, ler CSV com
   detecção de separador e de ANSI/UTF-8, e converter data (inclusive o
   serial do Excel). Esse código nasceu na importação de pessoas e foi
   extraído sem mudança de comportamento. */
import { traducoesDe } from "./i18n.js";

/* exceljs (~250 KB gz) só carrega quando alguém lê/gera planilha —
   dynamic import mantém o chunk fora do bundle principal */
let _exceljs = null;
export async function carregarExcelJS() {
  if (!_exceljs) {
    const mod = await import("exceljs");
    _exceljs = mod.default || mod;
  }
  return _exceljs;
}

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\*/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const pad2 = (n) => String(n).padStart(2, "0");

/* célula do exceljs pode ser richText, hyperlink (e-mails!) ou fórmula —
   reduz tudo para texto/Date/número cru. Fórmula vem pelo .result: é o
   valor JÁ CALCULADO pelo Excel, que é o que queremos exibir. */
export const valorCelula = (v) => {
  if (v == null) return "";
  if (v instanceof Date || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return typeof v.text === "object" ? valorCelula(v.text) : String(v.text);
    if (v.result != null) return valorCelula(v.result);
    if (v.hyperlink) return String(v.hyperlink).replace(/^mailto:/, "");
    return "";
  }
  return String(v);
};

export const texto = (v) => {
  if (v instanceof Date) { const r = paraISO(v); return r.iso || ""; }
  return String(v ?? "").trim();
};

/* data da célula: Date (xlsx formatado), serial do Excel (célula "geral")
   ou texto DD/MM/AAAA / AAAA-MM-DD. Getters UTC — o serial é UTC e usar o
   fuso local faria a data voltar um dia. */
export function paraISO(v) {
  if (v == null || v === "") return { iso: "" };
  if (v instanceof Date) {
    if (isNaN(v)) return { erro: true };
    return montaISO(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "number") return paraISO(new Date(Math.round((v - 25569) * 86400000)));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return montaISO(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return montaISO(+m[3], +m[2], +m[1]);
  return { erro: true };
}
function montaISO(ano, mes, dia) {
  if (ano < 1900 || ano > 2100) return { erro: true };
  /* round-trip pega dia inexistente no mês (31/02 viraria 03/03) */
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return { erro: true };
  return { iso: `${ano}-${pad2(mes)}-${pad2(dia)}` };
}

/* ─────────── leitura do arquivo → matriz de células ─────────── */

/* Devolve a matriz INTEIRA da aba (índice = nº da linha - 1, preservando a
   numeração real da planilha). `nomesPreferidos` escolhe a aba por nome
   (em qualquer idioma); sem acerto, cai na primeira aba visível. */
export async function lerMatrizXlsx(file, nomesPreferidos = []) {
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const alvos = new Set(nomesPreferidos.map(norm));
  const ws = (alvos.size ? wb.worksheets.find((w) => alvos.has(norm(w.name))) : null)
    || wb.worksheets.find((w) => w.state !== "hidden" && w.state !== "veryHidden")
    || wb.worksheets[0];
  if (!ws) return [];
  const largura = Math.max(ws.columnCount || 0, 1);
  const matriz = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const linha = [];
    for (let i = 1; i <= largura; i++) linha.push(valorCelula(row.getCell(i).value));
    matriz[n - 1] = linha;
  });
  return matriz;
}

export async function lerCsv(file) {
  const buf = await file.arrayBuffer();
  let txt = new TextDecoder("utf-8").decode(buf);
  /* Excel pt às vezes grava ANSI — o caractere de substituição denuncia */
  if (txt.includes("�")) txt = new TextDecoder("windows-1252").decode(buf);
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  const cab = txt.slice(0, txt.search(/\r|\n/) < 0 ? txt.length : txt.search(/\r|\n/));
  const sep = (cab.match(/;/g) || []).length >= (cab.match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && txt[i + 1] === "\n") i++;
      linha.push(campo); campo = ""; linhas.push(linha); linha = [];
    } else campo += ch;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

/* ─────────── números, competência, tipos ─────────── */

/* "R$ 1.234,56", "1,234.56", "1234.56", "(50)", "12%" → número; "" → null.
   Regra do separador: o ÚLTIMO ponto/vírgula é o decimal, salvo quando
   tem exatamente 3 dígitos depois e é o único separador do texto — aí é
   milhar ("1.234" = 1234, mas "1.23" = 1,23).
   O que NÃO é número precisa dar null, e isso é mais delicado do que
   parece: jogar fora todo caractere não numérico transformaria "101-A"
   em 101 e "01/2019" em 12019 — e aí a coluna de unidade viraria número
   e a de competência viraria uma data de 1932. Só o símbolo de moeda (e
   um % final) saem; o resto já tem de ser número. */
export function paraNumero(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  if (typeof v === "boolean" || v instanceof Date) return null;
  let s = String(v).replace(/[\s ]/g, "");
  s = s.replace(/^[^\d(+-]+/, "").replace(/%$/, "");   // R$, US$, €… e um % final
  const m = s.match(/^([-+(]?)(\d[\d.,]*)\)?$/);
  if (!m) return null;
  const negativo = m[1] === "-" || m[1] === "(";
  const corpo = m[2];
  const ultVirg = corpo.lastIndexOf(","), ultPonto = corpo.lastIndexOf(".");
  const dec = Math.max(ultVirg, ultPonto);
  let n;
  if (dec < 0) n = Number(corpo);
  else {
    const soUmSeparador = (corpo.match(/[.,]/g) || []).length === 1;
    const frac = corpo.slice(dec + 1);
    if (soUmSeparador && frac.length === 3) n = Number(corpo.replace(/[.,]/g, ""));
    else n = Number(corpo.slice(0, dec).replace(/[.,]/g, "") + "." + frac.replace(/[.,]/g, ""));
  }
  if (isNaN(n)) return null;
  return negativo && n > 0 ? -n : n;
}

const MESES_TXT = {
  1: ["jan", "janeiro", "january", "enero"], 2: ["fev", "fevereiro", "feb", "february", "febrero"],
  3: ["mar", "marco", "março", "march", "marzo"], 4: ["abr", "abril", "apr", "april"],
  5: ["mai", "maio", "may", "mayo"], 6: ["jun", "junho", "june", "junio"],
  7: ["jul", "julho", "july", "julio"], 8: ["ago", "agosto", "aug", "august"],
  9: ["set", "setembro", "sep", "sept", "september", "septiembre", "sete"],
  10: ["out", "outubro", "oct", "october", "octubre"], 11: ["nov", "novembro", "november", "noviembre"],
  12: ["dez", "dezembro", "dec", "december", "diciembre"],
};

/* competência da cobrança → "AAAA-MM". Aceita Date, serial do Excel,
   "2026-09", "09/2026", "09-2026", "set/2026", "setembro de 2026" e data
   completa (da qual só o ano/mês interessam). */
export function normalizarCompetencia(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date || typeof v === "number") {
    const r = paraISO(v);
    return r.iso ? r.iso.slice(0, 7) : "";
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad2(+m[2])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad2(+m[1])}`;
  const completa = paraISO(s);
  if (completa.iso) return completa.iso.slice(0, 7);
  /* "set/2026", "setembro de 2026", "Sep 2026" */
  const n = norm(s);
  const ano = n.match(/(19|20)\d{2}/);
  if (ano) {
    for (const [mes, formas] of Object.entries(MESES_TXT)) {
      if (formas.some((f) => n.startsWith(f) || n.includes(` ${f}`) || n.includes(`/${f}`)))
        return `${ano[0]}-${pad2(+mes)}`;
    }
  }
  return "";
}

/* tipo da coluna pela amostra de valores: data ganha de número porque o
   serial/Date do Excel também passaria por número */
export function inferirTipo(valores) {
  const amostra = valores.filter((v) => v !== "" && v != null).slice(0, 50);
  if (!amostra.length) return "texto";
  let datas = 0, numeros = 0;
  for (const v of amostra) {
    if (v instanceof Date) { datas++; continue; }
    if (typeof v === "number") { numeros++; continue; }
    if (paraISO(v).iso) datas++;
    else if (paraNumero(v) != null) numeros++;
  }
  if (datas / amostra.length >= 0.7 && datas >= numeros) return "data";
  if (numeros / amostra.length >= 0.7) return "numero";
  return "texto";
}

/* ─────────── papel semântico da coluna ───────────
   O arquivo é do condomínio, então o cabeçalho vem como a pessoa escreveu:
   "Apto", "Mês", "Cobrado"… Os sinônimos abaixo (pt/en/es) são expandidos
   com traducoesDe, que acrescenta os demais idiomas quando o termo também
   é chave do dicionário. O palpite é só um ponto de partida: a tela de
   importação mostra o papel de cada coluna e deixa corrigir. */
const PAPEIS = {
  unidade: ["Unidade", "Unidades", "Apto", "Apartamento", "Ap", "Casa", "Sala", "Loja", "Lote", "Unit", "Apartment", "Departamento"],
  competencia: ["Competência", "Competencia", "Mês", "Mes", "Mês/Ano", "Referência", "Referencia", "Período", "Periodo", "Month", "Period", "Reference"],
  valor: ["Valor", "Valor cobrado", "Cobrado", "Total", "Taxa", "Cota", "Amount", "Charged", "Importe", "Monto"],
  pago: ["Pago", "Valor pago", "Recebido", "Paid", "Received", "Pagado", "Recibido"],
  vencimento: ["Vencimento", "Data de vencimento", "Vence", "Due date", "Due", "Vencimiento"],
  status: ["Status", "Situação", "Situacao", "Estado", "Condição", "Condicion"],
};
const FORMAS = Object.fromEntries(Object.entries(PAPEIS).map(([papel, termos]) => [
  papel, new Set(termos.flatMap((t) => traducoesDe(t)).map(norm)),
]));

export function inferirPapel(titulo) {
  const n = norm(titulo);
  if (!n) return null;
  /* igualdade primeiro: "Pago" não pode casar com "Valor pago" por conter */
  for (const [papel, formas] of Object.entries(FORMAS)) if (formas.has(n)) return papel;
  for (const [papel, formas] of Object.entries(FORMAS))
    for (const f of formas) if (f.length >= 4 && n.includes(f)) return papel;
  return null;
}

/* ─────────── leitura sem esquema ─────────── */

export const MAX_LINHAS_PLANILHA = 5000;
export const MAX_BYTES_PLANILHA = 5 * 1024 * 1024;

const chaveDe = (titulo, usadas, i) => {
  let base = norm(titulo).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!base) base = `col_${i + 1}`;
  let chave = base, n = 2;
  while (usadas.has(chave)) chave = `${base}_${n++}`;
  usadas.add(chave);
  return chave;
};

const vazia = (l) => !l || l.every((c) => texto(c) === "");

/* Lê qualquer planilha: a 1ª linha não vazia é o cabeçalho e cada coluna
   vira { chave, titulo, tipo, papel }. Os valores saem já normalizados
   pelo tipo da coluna (número → number, data → "AAAA-MM-DD", resto →
   texto), que é o formato gravado no jsonb e somado nos totais.
   → { colunas, linhas: [{ n, dados }], errosGerais } */
export async function lerPlanilhaLivre(file) {
  const erro = (msg) => ({ colunas: [], linhas: [], errosGerais: [msg] });
  if (file.size > MAX_BYTES_PLANILHA) return erro("Arquivo muito grande (máximo 5 MB).");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["xlsx", "csv"].includes(ext)) return erro("Formato não suportado — envie um arquivo .xlsx ou .csv.");

  const matriz = ext === "csv" ? await lerCsv(file) : await lerMatrizXlsx(file);
  const iCab = matriz.findIndex((l) => !vazia(l));
  if (iCab < 0) return erro("Nenhuma linha preenchida encontrada na planilha.");

  const cab = matriz[iCab];
  const corpo = [];
  for (let i = iCab + 1; i < matriz.length; i++) if (!vazia(matriz[i])) corpo.push({ n: i + 1, cels: matriz[i] });
  if (!corpo.length) return erro("A planilha tem cabeçalho, mas nenhuma linha de dados.");

  const errosGerais = [];
  if (corpo.length > MAX_LINHAS_PLANILHA) {
    errosGerais.push("A planilha tem mais de 5.000 linhas — as excedentes foram ignoradas.");
    corpo.length = MAX_LINHAS_PLANILHA;
  }

  /* `i` é a posição REAL na planilha (usada para ler a célula); `ordem` é a
     posição depois de descartar colunas vazias (usada para exibir) */
  const usadas = new Set();
  const brutas = cab.map((titulo, i) => {
    const t = texto(titulo) || `Coluna ${i + 1}`;
    return { chave: chaveDe(t, usadas, i), titulo: t, i };
  }).filter((c) => {
    /* coluna sem título e sem nenhum valor é só a planilha "larga" do Excel */
    return texto(cab[c.i]) !== "" || corpo.some(({ cels }) => texto(cels[c.i]) !== "");
  });
  if (!brutas.length) return erro("Não foi possível reconhecer as colunas da planilha.");

  brutas.forEach((c, ordem) => {
    c.ordem = ordem;
    c.tipo = inferirTipo(corpo.map(({ cels }) => cels[c.i]));
    c.papel = inferirPapel(c.titulo);
  });

  const linhas = corpo.map(({ n, cels }) => {
    const dados = {};
    for (const c of brutas) dados[c.chave] = normalizarValor(cels[c.i], c.tipo);
    return { n, dados };
  });

  return {
    colunas: brutas.map(({ chave, titulo, tipo, papel, ordem }) => ({ chave, titulo, tipo, papel, ordem })),
    linhas, errosGerais,
  };
}

export function normalizarValor(v, tipo) {
  if (v == null || v === "") return "";
  if (tipo === "numero") { const n = paraNumero(v); return n == null ? texto(v) : n; }
  if (tipo === "data") { const r = paraISO(v); return r.iso || texto(v); }
  return texto(v);
}

/* ─────────── da linha da planilha para o mundo do app ─────────── */

/* label canônico é "numero-bloco" (ex.: "101-A"); tolera "A-101" e o número
   puro quando ele é único no condomínio. Vive aqui porque tanto a
   importação de pessoas quanto a de cobranças precisam da mesma regra. */
export function resolverUnidade(txt, ctx) {
  const n = norm(txt);
  if (!n) return { id: null };
  const porLabel = ctx.unidades.find((u) => norm(u.label) === n);
  if (porLabel) return { id: porLabel.id };
  const invertido = n.split("-").reverse().join("-");
  const porInvertido = ctx.unidades.find((u) => norm(u.label) === invertido);
  if (porInvertido) return { id: porInvertido.id };
  const porNumero = ctx.unidades.filter((u) => norm(u.label).split("-")[0] === n);
  if (porNumero.length === 1) return { id: porNumero[0].id };
  return { erro: true };
}

const PAGO_SIM = /^(pago|paga|pagado|paid|quitado|liquidado|sim|si|yes|ok|x|v|true|1)$/;

/* Traduz uma linha da planilha (colunas livres) para os campos que o app
   entende, usando o PAPEL de cada coluna. É o que torna possível conciliar
   com as cobranças sem exigir um modelo fixo de arquivo. */
export function resolverLinha(colunas, dados, ctx) {
  const col = (papel) => colunas.find((c) => c.papel === papel);
  const bruto = (papel) => { const c = col(papel); return c ? dados?.[c.chave] : undefined; };

  const u = resolverUnidade(texto(bruto("unidade")), ctx);
  const competencia = normalizarCompetencia(bruto("competencia"));
  const valor = paraNumero(bruto("valor"));
  const vencimento = paraISO(bruto("vencimento")).iso || "";

  /* a coluna de pagamento pode ser valor (300,00), data (05/09/2026) ou
     texto ("pago") — e o status, quando existe, também decide */
  const colPago = col("pago");
  const vPago = bruto("pago");
  let pagoEm = "", pagoValor = null, pago = false;
  if (colPago?.tipo === "data") { pagoEm = paraISO(vPago).iso || ""; pago = !!pagoEm; }
  else { pagoValor = paraNumero(vPago); pago = pagoValor != null ? pagoValor > 0 : PAGO_SIM.test(norm(texto(vPago))); }
  if (!pago) pago = PAGO_SIM.test(norm(texto(bruto("status"))));

  return {
    unidadeId: u.id || null, unidadeErro: !!u.erro, competencia, valor,
    vencimento, pago, pagoEm, pagoValor,
  };
}

/* Conciliação com as cobranças do app — função pura, por unidade +
   competência. `linhas` já vêm resolvidas por resolverLinha; `cobrancas` é
   o db.cobr da camada de dados. Fica aqui (e não em api.js) porque não
   toca banco nenhum: assim a sonda a testa sem subir o app. */
export function conciliarPlanilha(linhas, cobrancas) {
  const porChave = new Map();
  for (const c of cobrancas) if (c.unidadeId && c.competencia) porChave.set(`${c.unidadeId}|${c.competencia}`, c);
  const casadas = new Set();
  const comSituacao = linhas.map((l) => {
    if (!l.unidadeId || !l.competencia) return { ...l, situacao: "sem_chave", cobranca: null };
    const chave = `${l.unidadeId}|${l.competencia}`;
    const c = porChave.get(chave);
    if (!c) return { ...l, situacao: "so_planilha", cobranca: null };
    casadas.add(chave);
    const difere = l.valor != null && Math.abs(Number(l.valor || 0) - Number(c.valor || 0)) > 0.005;
    return { ...l, situacao: difere ? "difere" : "confere", cobranca: c };
  });
  const soSistema = cobrancas.filter((c) => c.unidadeId && c.competencia && !casadas.has(`${c.unidadeId}|${c.competencia}`));
  return { linhas: comSituacao, soSistema };
}

/* coluna calculada: { esq, op, dir } entre duas colunas numéricas */
export function valorCalculado(dados, coluna) {
  const c = coluna?.calculada;
  if (!c) return null;
  const a = paraNumero(dados?.[c.esq]), b = paraNumero(dados?.[c.dir]);
  if (a == null && b == null) return null;
  const x = a ?? 0, y = b ?? 0;
  if (c.op === "+") return x + y;
  if (c.op === "-") return x - y;
  if (c.op === "*") return x * y;
  if (c.op === "/") return y ? x / y : null;
  return null;
}
