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

/* Uma aba → matriz (índice = nº da linha - 1, preservando a numeração real
   da planilha). Célula formatada como PERCENTUAL no Excel guarda 0,023 e
   mostra "2,3%" — aqui ela vira a string "2.3%", que preserva o símbolo
   para a detecção de formato e volta a número por paraNumero. */
function matrizDaAba(ws) {
  const largura = Math.max(ws.columnCount || 0, 1);
  const matriz = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const linha = [];
    for (let i = 1; i <= largura; i++) {
      const cel = row.getCell(i);
      let v = valorCelula(cel.value);
      if (typeof v === "number" && typeof cel.numFmt === "string" && cel.numFmt.includes("%"))
        v = `${+(v * 100).toFixed(6)}%`;
      linha.push(v);
    }
    matriz[n - 1] = linha;
  });
  return matriz;
}

/* Devolve a matriz INTEIRA da aba. `nomesPreferidos` escolhe a aba por nome
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
  return matrizDaAba(ws);
}

/* Todas as abas visíveis → [{ nome, matriz }]. O detector de layout usa
   isto para achar a aba certa (arquivo real tem uma 2ª aba com um bloco
   modelo vazio). */
export async function lerTodasMatrizesXlsx(file) {
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return wb.worksheets
    .filter((w) => w.state !== "hidden" && w.state !== "veryHidden")
    .map((w) => ({ nome: w.name, matriz: matrizDaAba(w) }));
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
    const seps = corpo.match(/[.,]/g) || [];
    const frac = corpo.slice(dec + 1);
    /* milhar: separador único com 3 dígitos depois ("1.234"), OU vários
       separadores IGUAIS todos agrupando de 3 em 3 ("24.434.850") — o
       formato py/br de milhar puro; misturado ("1.234,56") decide o último */
    const mesmoSep = seps.length > 1 && new Set(seps).size === 1
      && corpo.split(/[.,]/).slice(1).every((g) => g.length === 3);
    if ((seps.length === 1 || mesmoSep) && frac.length === 3) n = Number(corpo.replace(/[.,]/g, ""));
    else n = Number(corpo.slice(0, dec).replace(/[.,]/g, "") + "." + frac.replace(/[.,]/g, ""));
  }
  if (isNaN(n)) return null;
  return negativo && n > 0 ? -n : n;
}

const MESES_TXT = {
  1: ["jan", "janeiro", "january", "enero", "ene"], 2: ["fev", "fevereiro", "feb", "february", "febrero"],
  3: ["mar", "marco", "março", "march", "marzo"], 4: ["abr", "abril", "apr", "april"],
  5: ["mai", "maio", "may", "mayo"], 6: ["jun", "junho", "june", "junio"],
  7: ["jul", "julho", "july", "julio"], 8: ["ago", "agosto", "aug", "august"],
  9: ["set", "setembro", "sep", "sept", "september", "septiembre", "sete", "setiembre"],
  10: ["out", "outubro", "oct", "october", "octubre"], 11: ["nov", "novembro", "november", "noviembre"],
  12: ["dez", "dezembro", "dec", "december", "diciembre", "dic"],
};

/* mês por extenso em qualquer das formas acima → 1..12 (null quando não é).
   O startsWith tolera typo real de planilha ("FEBERO" → "feb") e grafias
   regionais ("SETIEMBRE" → "set"). Número puro NÃO é mês — "3" numa coluna
   de quantidade não pode virar março. */
export function mesDeTexto(v) {
  const n = norm(texto(v));
  if (!n || paraNumero(n) != null) return null;
  for (const [mes, formas] of Object.entries(MESES_TXT))
    for (const f of formas) if (n === f || n.startsWith(f)) return +mes;
  return null;
}

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
  /* mês textual com ano de 2 dígitos ("ene/24", "dic-23") — só com o mês por
     extenso; "04/24" sozinho é ambíguo demais e continua fora */
  const m2 = !ano && n.match(/\b(\d{2})\b/);
  if (m2) {
    for (const [mes, formas] of Object.entries(MESES_TXT)) {
      if (formas.some((f) => n.startsWith(f) || n.includes(` ${f}`) || n.includes(`/${f}`)))
        return `20${m2[1]}-${pad2(+mes)}`;
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
/* A ORDEM dos papéis é a prioridade do 2º passe (substring): "UNID. / MESES"
   precisa cair em unidade, não em meses. Os termos da planilla hispano-
   americana (expensas, cuota, mora, interés, F.R., cant.) são vocabulário
   de DOMÍNIO, não string de UI — por isso ficam literais aqui e não entram
   nos dicionários. */
const PAPEIS = {
  unidade: ["Unidade", "Unidades", "Apto", "Apartamento", "Ap", "Casa", "Sala", "Loja", "Lote", "Unit", "Apartment", "Departamento", "Unid", "Unid.", "Unidad"],
  competencia: ["Competência", "Competencia", "Mês", "Mes", "Mês/Ano", "Referência", "Referencia", "Período", "Periodo", "Month", "Period", "Reference", "Mes/Año", "Periodo de deuda"],
  ano: ["Ano", "Año", "Year", "Ano expensas", "Año expensas", "Ejercicio"],
  valor: ["Valor", "Valor cobrado", "Cobrado", "Total", "Taxa", "Cota", "Amount", "Charged", "Importe", "Monto", "Saldo", "Deuda", "Total adeudado"],
  valor_base: ["Expensas", "Expensa", "Cuota", "Cuota ordinaria", "Valor base"],
  percentual_fr: ["% F.R.", "%F.R.", "F.R.", "Fondo de reserva", "% fondo", "Fundo de reserva"],
  taxa_mora: ["Mora", "Interés", "Interes", "Intereses", "Intereses moratorio", "Interés moratorio", "Recargo", "Tasa de mora", "Taxa de mora"],
  meses: ["Meses", "Cant", "Cant.", "Cantidad", "Meses adeudados", "Months"],
  pago: ["Pago", "Valor pago", "Recebido", "Paid", "Received", "Pagado", "Recibido"],
  vencimento: ["Vencimento", "Data de vencimento", "Vence", "Due date", "Due", "Vencimiento"],
  status: ["Status", "Situação", "Situacao", "Estado", "Condição", "Condicion"],
};
const FORMAS = Object.fromEntries(Object.entries(PAPEIS).map(([papel, termos]) => [
  papel, new Set(termos.flatMap((t) => traducoesDe(t)).map(norm)),
]));
/* formas curtas que só valem por IGUALDADE: por substring, "Morador" viraria
   taxa_mora e "Cantina" viraria meses */
const SUBSTRING_NAO = new Set(["mora", "cant", "cant."]);

export function inferirPapel(titulo) {
  const n = norm(titulo);
  if (!n) return null;
  /* igualdade primeiro: "Pago" não pode casar com "Valor pago" por conter */
  for (const [papel, formas] of Object.entries(FORMAS)) if (formas.has(n)) return papel;
  for (const [papel, formas] of Object.entries(FORMAS))
    for (const f of formas) if (f.length >= 4 && !SUBSTRING_NAO.has(f) && n.includes(f)) return papel;
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

/* Qual linha é o CABEÇALHO de verdade? Planilha real raramente começa
   limpa: título mesclado na linha 1 (replicado em todas as colunas pelo
   exceljs), linhas de contato… Pontuação entre as 10 primeiras linhas não
   vazias: títulos que casam papel conhecido e valores distintos pontuam;
   célula numérica e linha inteira repetida (título mesclado) descontam;
   linha seguinte com cara de dados confirma. Empate/zero → a primeira não
   vazia (comportamento antigo). */
export function detectarLinhaCabecalho(matriz) {
  const candidatas = [];
  for (let i = 0; i < matriz.length && candidatas.length < 10; i++) if (!vazia(matriz[i])) candidatas.push(i);
  if (!candidatas.length) return -1;
  let melhor = candidatas[0], melhorPts = 0;
  for (const i of candidatas) {
    const cels = (matriz[i] || []).map((c) => texto(c)).filter((t) => t !== "");
    if (!cels.length) continue;
    let pts = 0;
    const unicos = new Set(cels.map(norm));
    for (const t of cels) if (inferirPapel(t)) pts += 3;
    pts += unicos.size;
    if (unicos.size === cels.length) pts += 2;
    if (cels.length > 1 && unicos.size === 1) pts -= 5; // título mesclado replicado
    for (const t of cels) if (paraNumero(t) != null) pts -= 2;
    let j = i + 1;
    while (j < matriz.length && vazia(matriz[j])) j++;
    const dados = ((matriz[j] || []).map((c) => texto(c)).filter(Boolean));
    if (dados.filter((t) => paraNumero(t) != null || paraISO(t).iso).length >= 2) pts += 2;
    if (pts > melhorPts) { melhorPts = pts; melhor = i; }
  }
  return melhor;
}

/* formato de exibição/semântica da coluna numérica. "percent" = escala
   humana (10 = 10%, 2.3 = 2,3%) — é o que paraNumero("2,3%") já devolve. */
export function inferirFormato(valores, papel) {
  if (papel === "percentual_fr" || papel === "taxa_mora") return "percent";
  const amostra = valores.map((v) => texto(v)).filter(Boolean).slice(0, 50);
  if (amostra.length && amostra.filter((t) => /%$/.test(t)).length / amostra.length >= 0.7) return "percent";
  return undefined;
}

/* primeiras linhas não vazias, encurtadas — a tela de importação usa como
   prévia para a pessoa conferir (e corrigir) a linha do cabeçalho */
const previaDe = (matriz, ate = 8) => {
  const rows = [];
  for (let i = 0; i < matriz.length && rows.length < ate; i++)
    if (!vazia(matriz[i])) rows.push({ n: i + 1, cels: (matriz[i] || []).slice(0, 6).map((c) => texto(c)) });
  return rows;
};

/* Lê qualquer planilha: a 1ª linha não vazia é o cabeçalho e cada coluna
   vira { chave, titulo, tipo, papel }. Os valores saem já normalizados
   pelo tipo da coluna (número → number, data → "AAAA-MM-DD", resto →
   texto), que é o formato gravado no jsonb e somado nos totais.
   → { colunas, linhas: [{ n, dados }], errosGerais } */
/* opts:
   · layout: "plano" força o caminho genérico (ignora o detector de mora);
   · linhaCabecalho: nº REAL (1-based) da linha de cabeçalho, escolhido na UI;
   · unidade / incluirZerados / mesesDoArquivo: parâmetros do layout mora. */
export async function lerPlanilhaLivre(file, opts = {}) {
  const erro = (msg) => ({ colunas: [], linhas: [], errosGerais: [msg] });
  if (file.size > MAX_BYTES_PLANILHA) return erro("Arquivo muito grande (máximo 5 MB).");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["xlsx", "csv"].includes(ext)) return erro("Formato não suportado — envie um arquivo .xlsx ou .csv.");

  let matriz, candidatas;
  if (ext === "csv") { matriz = await lerCsv(file); candidatas = [matriz]; }
  else {
    const abas = await lerTodasMatrizesXlsx(file);
    matriz = abas[0]?.matriz || [];
    candidatas = abas.map((a) => a.matriz);
  }

  /* layout "planilla de mora" (blocos por ano)? A aba com mais blocos vence.
     Se o achatador não produzir nenhuma linha (falso positivo do detector),
     cai no caminho genérico — degrada aberto. */
  if (opts.layout !== "plano") {
    let alvo = null;
    for (const m of candidatas) {
      const det = detectarBlocosMora(m);
      if (det.blocos.length && (!alvo || det.blocos.length > alvo.det.blocos.length)) alvo = { m, det };
    }
    if (alvo) {
      const r = achatarPlanilhaMora(alvo.m, alvo.det, opts, file.name);
      if (r.linhas.length) return r;
    }
  }

  const iCab = Number.isInteger(opts.linhaCabecalho) && opts.linhaCabecalho >= 1
    ? opts.linhaCabecalho - 1
    : detectarLinhaCabecalho(matriz);
  if (iCab < 0 || iCab >= matriz.length || vazia(matriz[iCab])) return erro("Nenhuma linha preenchida encontrada na planilha.");

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
     posição depois de descartar colunas vazias (usada para exibir). A largura
     vem do CORPO também: csv com linha-título curta não pode decapitar as
     colunas de dados. */
  let largura = cab.length;
  for (const { cels } of corpo) if (cels.length > largura) largura = cels.length;
  const usadas = new Set();
  const brutas = Array.from({ length: largura }, (_, i) => {
    const t = texto(cab[i]) || `Coluna ${i + 1}`;
    return { chave: chaveDe(t, usadas, i), titulo: t, i };
  }).filter((c) => {
    /* coluna sem título e sem nenhum valor é só a planilha "larga" do Excel */
    return texto(cab[c.i]) !== "" || corpo.some(({ cels }) => texto(cels[c.i]) !== "");
  });
  if (!brutas.length) return erro("Não foi possível reconhecer as colunas da planilha.");

  brutas.forEach((c, ordem) => {
    const crus = corpo.map(({ cels }) => cels[c.i]);
    c.ordem = ordem;
    c.tipo = inferirTipo(crus);
    c.papel = inferirPapel(c.titulo);
    c.formato = inferirFormato(crus, c.papel);
  });

  const linhas = corpo.map(({ n, cels }) => {
    const dados = {};
    for (const c of brutas) dados[c.chave] = normalizarValor(cels[c.i], c.tipo);
    return { n, dados };
  });

  return {
    colunas: brutas.map(({ chave, titulo, tipo, papel, ordem, formato }) =>
      ({ chave, titulo, tipo, papel, ordem, ...(formato ? { formato } : {}) })),
    linhas, errosGerais,
    layout: "plano", cabecalhoNa: iCab + 1, previa: previaDe(matriz),
  };
}

export function normalizarValor(v, tipo) {
  if (v == null || v === "") return "";
  if (tipo === "numero") { const n = paraNumero(v); return n == null ? texto(v) : n; }
  if (tipo === "data") { const r = paraISO(v); return r.iso || texto(v); }
  return texto(v);
}

/* ─────────── layout "planilla de mora" (blocos por ano) ───────────
   A planilha de dívida da administração hispano-americana não é tabela
   plana: BLOCOS por ano empilhados, cabeçalho em DUAS linhas, meses como
   linhas (ENERO…DICIEMBRE), a unidade numa célula mesclada no meio do
   bloco e subtotais pelo caminho. O detector reconhece os blocos e o
   achatador os reduz à MESMA tabela canônica do caminho genérico — uma
   linha por unidade×mês — então todo o resto (gravar, dedupe, conciliar,
   criar cobranças) funciona sem mudança. */

const MORA_TERMOS = ["unid", "unidad", "unidade", "meses", "ano expensas", "año expensas", "expensas", "f.r", "interes", "moratorio", "cant", "monto"];

const pareceUnidade = (t) =>
  /^[0-9]{1,5}\s*[-/]?\s*[A-Za-z]{0,3}$|^[A-Za-z]{1,3}\s*[-/]?\s*[0-9]{1,5}$/.test(String(t).trim());

/* "Planilla de deuda 3-D Adilson Rocha.xlsx" → "3-D" (último recurso para
   descobrir a unidade; a pessoa confirma na tela de importação) */
const unidadeDoNome = (nome) => {
  const m = String(nome || "").match(/\b(\d{1,4}\s*[-/]\s*[A-Za-z]|[A-Za-z]\s*[-/]\s*\d{1,4})\b/);
  return m ? m[1].replace(/\s+/g, "") : "";
};

export function detectarBlocosMora(matriz) {
  const r = { blocos: [], pctFr: null, taxa: null, unidadeSugerida: "" };
  if (!matriz?.length) return r;
  const unidadesVistas = new Map();
  for (let i = 0; i < matriz.length; i++) {
    const l = matriz[i];
    if (vazia(l)) continue;
    /* candidata a cabeçalho de bloco: ≥2 termos distintos do vocabulário */
    const termos = new Set();
    for (const cel of l) {
      const t = norm(texto(cel));
      if (t) for (const termo of MORA_TERMOS) if (t.includes(termo)) termos.add(termo);
    }
    if (termos.size < 2) continue;
    /* a linha seguinte não vazia traz o ANO do bloco e os títulos finos */
    let j = i + 1;
    while (j < matriz.length && vazia(matriz[j])) j++;
    if (j >= matriz.length) continue;

    const mapa = { _meses: [] };
    let ano = null;
    (l || []).forEach((cel, c) => {
      const n = norm(texto(cel));
      if (!n) return;
      if (n.includes("unid") && mapa.unidade == null) mapa.unidade = c;
      if (n.includes("cant") && mapa.cant == null) mapa.cant = c;
    });
    (matriz[j] || []).forEach((cel, c) => {
      const t = texto(cel), n = norm(t);
      if (!n) return;
      const inteiro = paraNumero(t);
      if (ano == null && inteiro != null && Number.isInteger(inteiro) && inteiro >= 1900 && inteiro <= 2100) {
        ano = inteiro; mapa.gasto = c; return; // a coluna do ano carrega o gasto do prédio no mês
      }
      if (n.includes("unid")) { if (mapa.unidade == null) mapa.unidade = c; return; }
      if (n.includes("monto")) { if (mapa.monto == null) mapa.monto = c; return; }
      if (n.includes("expensas")) { if (mapa.expensas == null) mapa.expensas = c; return; }
      if (n.includes("f.r") || n.includes("fondo")) {
        const pct = (t.match(/(\d+[.,]?\d*)\s*%/) || [])[1];
        /* "10% F.R." (com número) é a coluna do fundo; "% F.R." sem número,
           no arquivo real, é a coluna da ALÍCUOTA da unidade */
        if (pct != null) { if (mapa.fr == null) { mapa.fr = c; mapa.pctFr = paraNumero(pct); } }
        else if (mapa.alicuota == null) mapa.alicuota = c;
        return;
      }
      if (/^\d+[.,]?\d*\s*%$/.test(t.trim())) { if (mapa.taxaCol == null) { mapa.taxaCol = c; mapa.taxa = paraNumero(t); } return; }
      if (n === "meses") mapa._meses.push(c);
    });
    if (ano == null) continue;

    /* linhas de mês: a coluna vem dos DADOS (nome do mês), não do título —
       typo ("FEBERO") e grafia regional ("SETIEMBRE") não derrubam */
    let mesCol = null; const meses = [];
    for (let k = j + 1; k < matriz.length; k++) {
      const lk = matriz[k];
      if (vazia(lk)) break;
      let achou = null;
      if (mesCol != null) { const m = mesDeTexto(lk[mesCol]); if (m) achou = { c: mesCol, m }; }
      else for (let c = 0; c < Math.min(lk.length, 4); c++) { const m = mesDeTexto(lk[c]); if (m) { achou = { c, m }; break; } }
      if (!achou) break;
      mesCol = achou.c; meses.push({ i: k, mes: achou.m });
    }
    if (meses.length < 3) continue;
    if (mapa.cant == null) mapa.cant = mapa._meses.find((c) => c !== mesCol) ?? null;
    delete mapa._meses;

    if (mapa.unidade != null) for (const { i: ri } of meses) {
      const t = texto((matriz[ri] || [])[mapa.unidade]);
      if (t && pareceUnidade(t)) unidadesVistas.set(t, (unidadesVistas.get(t) || 0) + 1);
    }
    r.blocos.push({ ano, mapa, meses, mesCol });
    if (r.pctFr == null && mapa.pctFr != null) r.pctFr = mapa.pctFr;
    if (r.taxa == null && mapa.taxa != null) r.taxa = mapa.taxa;
    i = meses[meses.length - 1].i;
  }
  /* blocos do mesmo arquivo compartilham a grade: herdam o que o cabeçalho
     local não trouxe (no arquivo real, CANT. só aparece no 1º bloco) */
  const acum = {};
  for (const b of r.blocos) {
    for (const k of ["unidade", "cant", "gasto", "monto", "expensas", "fr", "pctFr", "alicuota", "taxaCol", "taxa"]) {
      if (b.mapa[k] == null && acum[k] != null) b.mapa[k] = acum[k];
      if (b.mapa[k] != null) acum[k] = b.mapa[k];
    }
  }
  let max = 0;
  for (const [t, qtd] of unidadesVistas) if (qtd > max) { max = qtd; r.unidadeSugerida = t; }
  return r;
}

/* célula CANT. mesclada num PAR de linhas às vezes carrega os dois valores
   ("15\n14"): a i-ésima linha do grupo de texto idêntico leva o i-ésimo */
function cantPorLinha(matriz, bloco) {
  const mapa = new Map();
  const col = bloco.mapa.cant;
  if (col == null) return mapa;
  let grupo = [], textoGrupo = null;
  const fecha = () => {
    if (grupo.length > 1) {
      const partes = textoGrupo.split(/[\s\n]+/).map((p) => paraNumero(p)).filter((p) => p != null);
      if (partes.length === grupo.length) grupo.forEach((ri, k) => mapa.set(ri, partes[k]));
    }
    grupo = []; textoGrupo = null;
  };
  for (const { i } of bloco.meses) {
    const t = texto((matriz[i] || [])[col]);
    const multi = t.split(/[\s\n]+/).filter(Boolean).length > 1;
    if (multi && t === textoGrupo) grupo.push(i);
    else { fecha(); if (multi) { grupo = [i]; textoGrupo = t; } }
  }
  fecha();
  return mapa;
}

/* blocos → tabela canônica (uma linha por unidade×mês). Os parâmetros do
   reglamento (alícuota, % F.R., taxa) saem do próprio cabeçalho do arquivo
   e seguem ajustáveis na coluna calculada que o import cria. */
export function achatarPlanilhaMora(matriz, det, opts = {}, nomeArquivo = "") {
  const unidade = texto(opts.unidade) || det.unidadeSugerida || unidadeDoNome(nomeArquivo) || "";
  const errosGerais = [];
  const canon = [];
  for (const b of det.blocos) {
    const cants = cantPorLinha(matriz, b);
    for (const { i, mes } of b.meses) {
      const l = matriz[i] || [];
      /* paraNumero direto na célula: número cru passa intacto (um float
         267.555 NÃO pode virar texto e ser relido como milhar) */
      const num = (c) => (c == null ? null : paraNumero(l[c]));
      const linha = {
        _n: i + 1,
        unidade, competencia: `${b.ano}-${pad2(mes)}`,
        gasto_total: num(b.mapa.gasto), alicuota: num(b.mapa.alicuota),
        expensas: num(b.mapa.expensas), pct_fr: b.mapa.pctFr ?? det.pctFr ?? null,
        fr: num(b.mapa.fr), monto: num(b.mapa.monto),
        taxa_mora: b.mapa.taxa ?? det.taxa ?? null,
        /* dinâmico por padrão: a célula fica vazia e o cálculo conta até
           hoje; "do arquivo" preenche (= trava no valor importado) */
        meses_atraso: opts.mesesDoArquivo ? (cants.get(i) ?? num(b.mapa.cant)) : null,
        interes: num(b.mapa.taxaCol), // os VALORES da coluna da taxa são os juros
      };
      if (!opts.incluirZerados && !(linha.expensas > 0) && !(linha.monto > 0)) continue;
      canon.push(linha);
    }
  }
  if (!canon.length) return { colunas: [], linhas: [], errosGerais, layout: "mora", mora: { blocos: det.blocos.length, unidade } };

  /* escala ÷1000 (autor digitou "267.555" com ponto decimal em locale EN):
     gasto do prédio vem como texto certo; se a razão gasto/expensas estourar
     e os valores tiverem 3 casas, as colunas de dinheiro sobem ×1000 */
  const mediana = (arr) => { const v = arr.filter((x) => x > 0).sort((a, c) => a - c); return v.length ? v[(v.length / 2) | 0] : null; };
  const tresCasas = (v) => v != null && v % 1 !== 0 && Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;
  const mg = mediana(canon.map((x) => x.gasto_total)), me = mediana(canon.map((x) => x.expensas));
  let escala = false;
  if (mg && me && mg / me > 5000 && canon.some((x) => tresCasas(x.expensas))) {
    escala = true;
    errosGerais.push("Os valores de dinheiro foram multiplicados por 1.000 — escala detectada no arquivo.");
    for (const x of canon) for (const k of ["expensas", "fr", "monto", "interes"]) if (x[k] != null) x[k] = Math.round(x[k] * 1000);
  }
  canon.sort((a, b) => (a.competencia < b.competencia ? -1 : a.competencia > b.competencia ? 1 : 0));

  const DEFS = [
    ["unidade", "Unidade", "texto", "unidade", null],
    ["competencia", "Competência", "texto", "competencia", null],
    ["gasto_total", "Gasto total (prédio)", "numero", null, "moeda"],
    ["alicuota", "Alícuota (%)", "numero", null, "percent"],
    ["expensas", "Expensas", "numero", "valor_base", "moeda"],
    ["pct_fr", "% F.R.", "numero", "percentual_fr", "percent"],
    ["fr", "F.R.", "numero", null, "moeda"],
    ["monto", "Monto", "numero", "valor", "moeda"],
    ["taxa_mora", "Taxa de mora (%)", "numero", "taxa_mora", "percent"],
    ["meses_atraso", "Meses em atraso", "numero", "meses", null],
    ["interes", "Interés", "numero", null, "moeda"],
  ];
  const colunas = DEFS
    .filter(([chave]) => chave === "meses_atraso" /* fica mesmo vazia: é onde se trava o nº */
      || canon.some((x) => x[chave] != null && x[chave] !== ""))
    .map(([chave, titulo, tipo, papel, formato], ordem) =>
      ({ chave, titulo, tipo, papel, ordem, ...(formato ? { formato } : {}) }));

  /* colunas de verificação criadas de fábrica: recalculam o modelo e
     comparam com o importado (tol em moeda — arredondamento do arquivo) */
  const tem = (chave) => colunas.some((c) => c.chave === chave);
  const params = {
    base: "expensas",
    fr: tem("pct_fr") ? { col: "pct_fr" } : { num: det.pctFr ?? 10 },
    taxa: tem("taxa_mora") ? { col: "taxa_mora" } : { num: det.taxa ?? 0 },
    meses: { col: "meses_atraso", dinamico: true },
    regime: "simples", incluiFr: true,
  };
  if (tem("monto")) colunas.push({
    chave: "monto_recalc", titulo: "Monto recalculado", tipo: "numero", papel: null, ordem: colunas.length,
    calculada: { modelo: "mora", saida: "monto", ...params, verifica: "monto", tol: 5 },
  });
  if (tem("interes")) colunas.push({
    chave: "interes_recalc", titulo: "Interés recalculado", tipo: "numero", papel: null, ordem: colunas.length,
    calculada: { modelo: "mora", saida: "interes", ...params, verifica: "interes", tol: 5 },
  });

  const linhas = canon.map((x) => {
    const dados = {};
    for (const [chave] of DEFS) if (x[chave] != null && x[chave] !== "") dados[chave] = x[chave];
    if (!("meses_atraso" in dados)) dados.meses_atraso = ""; // vazio = meses dinâmicos
    return { n: x._n, dados };
  });

  return {
    colunas, linhas, errosGerais, layout: "mora",
    mora: {
      blocos: det.blocos.length, anos: det.blocos.map((b) => b.ano),
      unidade, pctFr: det.pctFr, taxa: det.taxa, escala,
    },
  };
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
  /* último recurso: forma COMPACTA (só letras e números) — a planilla real
     escreve "3-D" e a unidade cadastrada é "3D"; separador não pode impedir
     o casamento. Só resolve com candidato ÚNICO. */
  const compacta = (s) => norm(s).replace(/[^a-z0-9]+/g, "");
  const alvo = compacta(txt);
  if (alvo) {
    const numeroDe = (u) => {
      const lab = norm(u.label);
      const blo = u.bloco != null ? norm(String(u.bloco)) : "";
      return blo && lab.endsWith(`-${blo}`) ? lab.slice(0, lab.length - blo.length - 1) : lab.split("-")[0];
    };
    const cands = ctx.unidades.filter((u) => compacta(numeroDe(u)) === alvo || compacta(u.label) === alvo);
    if (cands.length === 1) return { id: cands[0].id };
  }
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
  /* sem coluna de valor final (Monto/Total), a cota (Expensas) responde */
  const valor = paraNumero(bruto("valor")) ?? paraNumero(bruto("valor_base"));
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

/* meses corridos da competência (mês devido) até hoje — a contagem que a
   coluna CANT. da planilla faz à mão e desatualiza. Nunca negativa. */
export function mesesAteHoje(competencia, hoje = new Date()) {
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia || ""));
  if (!m) return null;
  return Math.max((hoje.getFullYear() - +m[1]) * 12 + (hoje.getMonth() + 1 - +m[2]), 0);
}

/* Coluna calculada — duas formas persistidas em coluna.calculada:
   · v1 { esq, op, dir }: A op B; cada operando é a CHAVE de uma coluna ou
     um NÚMERO literal (constante);
   · v2 { modelo: "mora", saida, base, fr, taxa, meses, regime, incluiFr,
     verifica?, tol? }: o cálculo da planilla hispano-americana, com os
     parâmetros do reglamento ajustáveis — fr/taxa/meses aceitam
     { col: chave } ou { num: constante }; percentuais em escala humana
     (10 = 10%). meses com { col, dinamico: true }: célula vazia → conta
     competência→hoje; preenchida → vale o digitado (trava manual).
       monto  = base × (1 + fr/100)                [incluiFr !== false]
       interes= monto × taxa/100 × meses           [regime "simples"]
                monto × ((1+taxa/100)^meses − 1)   [regime "composto"]
       total  = monto + interes
   Operando que referencia outra calculada resolve em cadeia (com guarda de
   ciclo) — antes virava 0 em silêncio. */
export function valorCalculado(dados, coluna, colunas = [], opts = {}) {
  const c = coluna?.calculada;
  if (!c) return null;
  const vistos = opts._vistos || new Set();
  if (coluna.chave != null) {
    if (vistos.has(coluna.chave)) return null; // ciclo
    vistos.add(coluna.chave);
  }
  const lerCol = (chave) => {
    const col = (colunas || []).find((x) => x.chave === chave);
    if (col?.calculada) return valorCalculado(dados, col, colunas, { ...opts, _vistos: vistos });
    return paraNumero(dados?.[chave]);
  };
  const operando = (o) => (typeof o === "number" ? o : lerCol(o));

  if (c.modelo === "mora") {
    const parametro = (p) => {
      if (p == null) return null;
      if (typeof p === "number") return p;
      if (p.num != null) return p.num;
      if (p.col != null) return lerCol(p.col);
      return null;
    };
    const base = operando(c.base);
    if (base == null) return null;
    const fr = parametro(c.fr) ?? 0;
    const monto = c.incluiFr === false ? base : base * (1 + fr / 100);
    if (c.saida === "monto") return monto;
    let meses = null;
    if (c.meses && typeof c.meses === "object") {
      meses = c.meses.col != null ? paraNumero(dados?.[c.meses.col]) : null;
      if (meses == null && c.meses.dinamico) {
        const comp = (colunas || []).find((x) => x.papel === "competencia");
        meses = mesesAteHoje(comp ? dados?.[comp.chave] : null, opts.hoje);
      }
      if (meses == null && c.meses.num != null) meses = c.meses.num;
    } else meses = parametro(c.meses);
    const taxa = parametro(c.taxa) ?? 0;
    if (meses == null) return null;
    const interes = c.regime === "composto"
      ? monto * (Math.pow(1 + taxa / 100, meses) - 1)
      : monto * (taxa / 100) * meses;
    if (c.saida === "interes") return interes;
    return monto + interes; // "total"
  }

  const a = operando(c.esq), b = operando(c.dir);
  if (a == null && b == null) return null;
  const x = a ?? 0, y = b ?? 0;
  if (c.op === "+") return x + y;
  if (c.op === "-") return x - y;
  if (c.op === "*") return x * y;
  if (c.op === "/") return y ? x / y : null;
  return null;
}

/* valor de QUALQUER coluna numa linha — calculada resolve em cadeia; as
   demais leem direto do jsonb. É o único caminho para render/totais/export. */
export function valorDaColuna(dados, col, colunas = [], opts = {}) {
  return col?.calculada ? valorCalculado(dados, col, colunas, opts) : (dados?.[col?.chave] ?? "");
}
