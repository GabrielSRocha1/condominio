/* Importação em massa de pessoas: gera o modelo .xlsx (com os papéis e as
   unidades reais do condomínio em listas de seleção) e lê/valida a planilha
   preenchida (.xlsx ou .csv) linha a linha. A escrita no banco fica em
   api.js (importarPessoas) — aqui é só arquivo e validação. */
import { L, traducoesDe } from "./i18n.js";

/* exceljs (~250 KB gz) só carrega quando o modal de importação é usado —
   dynamic import mantém o chunk fora do bundle principal */
let _exceljs = null;
async function carregarExcelJS() {
  if (!_exceljs) {
    const mod = await import("exceljs");
    _exceljs = mod.default || mod;
  }
  return _exceljs;
}

/* mesmos 10 papéis oferecidos no formulário manual (tela Pessoas) */
const PAPEIS_UI = ["Proprietário", "Inquilino", "Morador", "Dependente", "Diretor", "Síndico", "Tesouraria", "Funcionário", "Prestador", "Visitante recorrente"];

/* ordem FIXA das colunas do modelo — o fallback posicional do parser depende dela */
const COLS = [
  { campo: "nome", header: "Nome completo", largura: 32 },
  { campo: "doc", header: "Documento (CPF, RG ou CI)", largura: 24 },
  { campo: "papel", header: "Papel no condomínio", largura: 20 },
  { campo: "unidade", header: "Unidade", largura: 16 },
  { campo: "tel", header: "Telefone", largura: 16 },
  { campo: "email", header: "E-mail", largura: 28 },
  { campo: "inicio", header: "Data de entrada", largura: 16 },
];

const MAX_LINHAS = 500;
const MAX_BYTES = 2 * 1024 * 1024;
/* mesma regra de documento LatAm do cadastro do condomínio (api/auth/condominio.js)
   — a variante fiscal, com "/", porque o campo aceita CPF E CNPJ/RUC/CUIT… */
const RE_DOC = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9 ./-]{4,17}$/;
const RE_EMAIL = /^\S+@\S+\.\S+$/;

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\*/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const pad2 = (n) => String(n).padStart(2, "0");

/* ─────────── geração do modelo ─────────── */

export async function gerarModeloPessoas(ctx) {
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet(L("Pessoas"));
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.largura; });
  /* Documento e Telefone como texto — preserva zeros à esquerda de CPF/fone */
  ws.getColumn(2).numFmt = "@";
  ws.getColumn(5).numFmt = "@";
  ws.getColumn(7).numFmt = "dd/mm/yyyy";
  const cab = ws.getRow(1);
  COLS.forEach((c, i) => {
    /* asterisco marca os obrigatórios; o parser ignora asteriscos ao reconhecer */
    cab.getCell(i + 1).value = L(c.header) + (i < 2 ? " *" : "");
  });
  cab.font = { bold: true };
  cab.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFE8D0" } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  /* aba oculta com as listas dos dropdowns — referência por fórmula contorna
     o limite de 255 caracteres das listas inline do Excel */
  const listas = wb.addWorksheet("Listas", { state: "hidden" });
  PAPEIS_UI.forEach((p, i) => { listas.getCell(`A${i + 1}`).value = L(p); });
  ctx.unidades.forEach((u, i) => { listas.getCell(`B${i + 1}`).value = u.label; });

  for (let r = 2; r <= MAX_LINHAS + 1; r++) {
    ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`Listas!$A$1:$A$${PAPEIS_UI.length}`] };
    if (ctx.unidades.length)
      ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`Listas!$B$1:$B$${ctx.unidades.length}`] };
  }

  const inst = wb.addWorksheet(L("Instruções"));
  inst.getColumn(1).width = 100;
  const texto = [
    L("Como importar pessoas em massa"),
    "",
    "• " + L("Preencha uma pessoa por linha na aba \"Pessoas\", a partir da linha 2."),
    "• " + L("Campos obrigatórios: Nome completo e Documento."),
    "• " + L("Papel e Unidade têm lista de seleção — clique na célula e escolha um valor."),
    "• " + L("Data de entrada: use o formato DD/MM/AAAA. Se ficar vazia, vale a data da importação."),
    "• " + L("Não mude os cabeçalhos nem a ordem das colunas."),
    "• " + L("Até 500 pessoas por importação."),
    "• " + L("Depois, volte ao app e envie este arquivo em Pessoas → Importar."),
    "",
    L("Exemplo de preenchimento:"),
  ];
  texto.forEach((t, i) => { inst.getCell(`A${i + 1}`).value = t; });
  inst.getCell("A1").font = { bold: true, size: 13 };
  const exemplo = [
    COLS.map((c) => L(c.header)),
    ["Maria Alves Souza", "123.456.789-09", L("Proprietário"), ctx.unidades[0]?.label || "101-A", "+55 11 91234-5678", "maria@email.com", "01/03/2026"],
    ["João Pereira Lima", "987.654.321-00", L("Inquilino"), ctx.unidades[1]?.label || "102-A", "", "", ""],
  ];
  exemplo.forEach((linha, li) => {
    linha.forEach((v, ci) => {
      const cell = inst.getCell(texto.length + 1 + li, ci + 1);
      cell.value = v;
      cell.font = li === 0 ? { bold: true, size: 9 } : { italic: true, size: 9 };
    });
  });

  const slug = String(ctx.condominioNome || "condominio").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "condominio";
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `modelo-pessoas-${slug}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─────────── leitura do arquivo → matriz de células ─────────── */

/* célula do exceljs pode ser richText, hyperlink (e-mails!) ou fórmula —
   reduz tudo para texto/Date/número cru */
const valorCelula = (v) => {
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

async function lerXlsx(file) {
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const nomesPessoas = new Set(traducoesDe("Pessoas").map(norm));
  const ws = wb.worksheets.find((w) => nomesPessoas.has(norm(w.name)))
    || wb.worksheets.find((w) => w.state !== "hidden" && w.state !== "veryHidden")
    || wb.worksheets[0];
  if (!ws) return [];
  const matriz = []; // índice = número da linha na planilha - 1 (preserva a numeração real)
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    matriz[n - 1] = COLS.map((_, i) => valorCelula(row.getCell(i + 1).value));
  });
  return matriz;
}

async function lerCsv(file) {
  const buf = await file.arrayBuffer();
  let texto = new TextDecoder("utf-8").decode(buf);
  /* Excel pt às vezes grava ANSI — o caractere de substituição denuncia */
  if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  const cab = texto.slice(0, texto.search(/\r|\n/) < 0 ? texto.length : texto.search(/\r|\n/));
  const sep = (cab.match(/;/g) || []).length >= (cab.match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = ""; linhas.push(linha); linha = [];
    } else campo += ch;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

/* ─────────── coerções e resoluções ─────────── */

/* data da célula: Date (xlsx formatado), serial do Excel (célula "geral")
   ou texto DD/MM/AAAA / AAAA-MM-DD. Getters UTC — o serial é UTC e usar o
   fuso local faria a data voltar um dia. */
function paraISO(v) {
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

const texto = (v) => {
  if (v instanceof Date) { const r = paraISO(v); return r.iso || ""; }
  return String(v ?? "").trim();
};

function resolverPapel(txt) {
  const n = norm(txt);
  if (!n) return { papel: "Morador" };
  const hit = PAPEIS_UI.find((p) => traducoesDe(p).some((tr) => norm(tr) === n));
  return hit ? { papel: hit } : { erro: true };
}

/* label canônico é "numero-bloco" (ex.: "101-A"); tolera "A-101" e o número
   puro quando ele é único no condomínio */
function resolverUnidade(txt, ctx) {
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

/* aceita o cabeçalho em qualquer um dos 15 idiomas; sem reconhecer as duas
   colunas obrigatórias, cai para a posição fixa do modelo (com aviso geral) */
function mapearColunas(cab) {
  const alvos = COLS.map((c) => ({ campo: c.campo, formas: new Set(traducoesDe(c.header).map(norm)) }));
  const mapa = {};
  (cab || []).forEach((celula, i) => {
    const n = norm(texto(celula));
    if (!n) return;
    const alvo = alvos.find((a) => a.formas.has(n));
    if (alvo && mapa[alvo.campo] == null) mapa[alvo.campo] = i;
  });
  if (mapa.nome != null && mapa.doc != null) return { mapa, posicional: false };
  return { mapa: Object.fromEntries(COLS.map((c, i) => [c.campo, i])), posicional: true };
}

/* ─────────── leitura + validação ───────────
   → { linhas: [{ id, n, nome, doc, papel, unidadeId, unidadeTxt, tel, email,
                  inicio, erros: [], avisos: [], status: "ok"|"erro"|"duplicada" }],
       errosGerais: [] } */
export async function lerPlanilhaPessoas(file, ctx, pessoasExistentes) {
  if (file.size > MAX_BYTES) return { linhas: [], errosGerais: [L("Arquivo muito grande (máximo 2 MB).")] };
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!["xlsx", "csv"].includes(ext)) return { linhas: [], errosGerais: [L("Formato não suportado — envie um arquivo .xlsx ou .csv.")] };

  const matriz = ext === "csv" ? await lerCsv(file) : await lerXlsx(file);
  const vazia = (l) => !l || l.every((c) => texto(c) === "");
  const errosGerais = [];

  const { mapa, posicional } = mapearColunas(matriz[0]);
  if (posicional && !vazia(matriz[0])) errosGerais.push(L("Cabeçalhos não reconhecidos — as colunas foram lidas pela posição do modelo."));

  const dados = [];
  for (let i = 1; i < matriz.length; i++) if (!vazia(matriz[i])) dados.push({ n: i + 1, cels: matriz[i] });
  if (!dados.length) return { linhas: [], errosGerais: [L("Nenhuma linha preenchida encontrada na planilha.")] };
  if (dados.length > MAX_LINHAS) return { linhas: [], errosGerais: [L("Máximo de 500 pessoas por importação.")] };

  /* documentos já cadastrados e cadastros provisórios (docs placeholder M-/P-) */
  const docKey = (d) => norm(d).replace(/[\s.]/g, "");
  const docsExistentes = new Set();
  const nomesProvisorios = new Set();
  (pessoasExistentes || []).forEach((p) => {
    if (/^[MP]-/i.test(p.docRaw || "")) nomesProvisorios.add(norm(p.nome));
    else if (p.docRaw) docsExistentes.add(docKey(p.docRaw));
  });

  const docsNoArquivo = new Set();
  const linhas = dados.map(({ n, cels }) => {
    const pega = (campo) => cels[mapa[campo]];
    const nome = texto(pega("nome"));
    const doc = texto(pega("doc"));
    const tel = texto(pega("tel"));
    const email = texto(pega("email"));
    const erros = [], avisos = [];

    if (!nome) erros.push(L("Nome: obrigatório"));
    else if (nome.length > 160) erros.push(L("Nome: use até 160 caracteres"));

    let duplicada = false;
    if (!doc) erros.push(L("Documento: obrigatório"));
    else if (doc.length > 18 || !RE_DOC.test(doc)) erros.push(L("Documento: formato inválido (5 a 18 letras e números)"));
    else if (docsNoArquivo.has(docKey(doc))) erros.push(L("Documento: repetido na planilha"));
    else {
      docsNoArquivo.add(docKey(doc));
      duplicada = docsExistentes.has(docKey(doc));
    }

    const rPapel = resolverPapel(texto(pega("papel")));
    if (rPapel.erro) erros.push(L("Papel não reconhecido — use um valor da lista do modelo"));

    const unidadeTxt = texto(pega("unidade"));
    const rUnidade = resolverUnidade(unidadeTxt, ctx);
    if (rUnidade.erro) erros.push(`${L("Unidade não encontrada — use um valor da lista do modelo")} ("${unidadeTxt}")`);

    if (tel.length > 20) erros.push(L("Telefone: use até 20 caracteres"));
    if (email && (email.length > 160 || !RE_EMAIL.test(email))) erros.push(L("E-mail: formato inválido"));

    const rData = paraISO(pega("inicio"));
    if (rData.erro) erros.push(L("Data de entrada: data inválida (use DD/MM/AAAA)"));

    if (!duplicada && !erros.length && nomesProvisorios.has(norm(nome)))
      avisos.push(`${nome} — ${L("Já existe um cadastro provisório com este nome — revise depois na tela Pessoas.")}`);

    return {
      id: n, n, nome, doc, papel: rPapel.papel || "Morador",
      unidadeId: rUnidade.id || null, unidadeTxt, tel, email, inicio: rData.iso || "",
      erros, avisos, status: erros.length ? "erro" : duplicada ? "duplicada" : "ok",
    };
  });

  return { linhas, errosGerais };
}
