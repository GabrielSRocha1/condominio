/* Modelos .xlsx dos imports LIVRES — histórico de cobranças (Cobros QR →
   Historial) e contas a pagar (Finanças → Importar). Diferente do modelo de
   pessoas (colunas fixas e posicionais), estes imports leem QUALQUER
   planilha pelo PAPEL do cabeçalho — o modelo existe para quem não tem uma
   planilha pronta: os títulos aqui são formas canônicas (vocabulário da
   planilla hispano-americana) que inferirPapel/inferirPapelDespesa
   reconhecem sempre, e a sonda testar-modelo-planilha.mjs prova o ciclo
   baixar → preencher → importar. Montagem separada do download: montar*
   roda no Node (sonda); baixarModeloPlanilha é o embrulho de navegador. */
import { L } from "./i18n.js";
import { carregarExcelJS } from "./planilha.js";

/* cabeçalhos EXPORTADOS para a sonda conferir papel por papel.
   txt = coluna de texto (preserva zeros à esquerda); data = dd/mm/yyyy */
export const CABECALHOS_MODELO = {
  cobrancas: [
    { titulo: "Unidad", papel: "unidade", largura: 12 },
    { titulo: "Datos", papel: "nome", largura: 30 },
    { titulo: "RUC", papel: "documento", largura: 16, txt: true },
    { titulo: "Mes/Año", papel: "competencia", largura: 12, txt: true },
    { titulo: "Importe", papel: "valor", largura: 14 },
    { titulo: "Vencimiento", papel: "vencimento", largura: 14, data: true },
    { titulo: "Pagado", papel: "pago", largura: 12 },
  ],
  lancamentos: [
    { titulo: "Fecha", papel: "data", largura: 14, data: true },
    { titulo: "Mes/Año", papel: "competencia", largura: 12, txt: true },
    { titulo: "Concepto", papel: "descricao", largura: 36 },
    { titulo: "Rubro", papel: "categoria", largura: 22 },
    { titulo: "Importe", papel: "valor", largura: 14 },
    { titulo: "Medio de pago", papel: "forma", largura: 18 },
    { titulo: "Pagado", papel: "pago", largura: 10 },
  ],
};

/* só valores que formaEnumDe converte — a lista do dropdown não pode
   oferecer o que a importação depois ignoraria */
const MEDIOS_PAGO = ["Transferencia", "Efectivo", "Débito automático", "QR", "Tarjeta"];
const LINHAS_VALIDACAO = 1000; // dropdowns valem até aqui; o import aceita 5.000

const INSTRUCOES = {
  cobrancas: {
    titulo: "Como importar o histórico de cobranças",
    linhas: [
      "Preencha uma cobrança por linha na aba principal, a partir da linha 2.",
      "Unidad: o rótulo da unidade como está no app — há lista de seleção na célula.",
      "Mes/Año: a competência da cobrança — ex.: oct/2026 ou 10/2026.",
      "Pagado: deixe vazio se está em aberto; escreva \"pagado\" (ou o valor recebido) se já foi paga.",
      "Os cabeçalhos podem ficar como estão — o app os reconhece; suas próprias colunas extras também entram.",
      "Até 5.000 linhas por importação.",
      "Depois, envie este arquivo em Cobros QR → Historial (planilla) → Importar.",
    ],
    exemplos: (ctx) => [
      [(ctx.unidades?.[0]?.label) || "1-A", "María Alves Souza", "123456-7", "oct/2026", 350000, "10/10/2026", ""],
      [(ctx.unidades?.[1]?.label) || "2-B", "Juan Pereira Lima", "987654-3", "oct/2026", 350000, "10/10/2026", "pagado"],
    ],
  },
  lancamentos: {
    titulo: "Como importar contas a pagar",
    linhas: [
      "Preencha um gasto por linha na aba principal, a partir da linha 2.",
      "Fecha: vencimento ou pagamento (DD/MM/AAAA). Sem data, o lançamento cai no dia 12 do mês da competência.",
      "Mes/Año: a competência do gasto — ex.: oct/2026 (colunas Año e Mes separadas também funcionam).",
      "Rubro: a categoria — escolha da lista ou escreva uma nova, que será criada na importação.",
      "Pagado: deixe vazio para conta a pagar; escreva \"pagado\" se já saiu do caixa.",
      "Até 2.000 lançamentos por importação.",
      "Depois, envie este arquivo em Finanzas → Importar.",
    ],
    exemplos: () => [
      ["12/10/2026", "oct/2026", "Salario portería", "Sueldos", 1500000, "Transferencia", ""],
      ["", "oct/2026", "Energía eléctrica", "Servicios", 937168, "", ""],
    ],
  },
};

/* monta o workbook (Node-ok — a sonda o alimenta direto no parser) */
export async function montarModeloPlanilha(tipo, ctx = {}) {
  const cols = CABECALHOS_MODELO[tipo];
  const inst = INSTRUCOES[tipo];
  if (!cols) throw new Error(`modelo desconhecido: ${tipo}`);
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet(tipo === "cobrancas" ? "Cobranzas" : "Gastos");
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.largura;
    if (c.txt) col.numFmt = "@";
    if (c.data) col.numFmt = "dd/mm/yyyy";
  });
  const cab = ws.getRow(1);
  cols.forEach((c, i) => { cab.getCell(i + 1).value = c.titulo; });
  cab.font = { bold: true };
  cab.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFE8D0" } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  /* aba oculta com as listas dos dropdowns (mesmo desenho do modelo de
     pessoas): unidades reais do condomínio, categorias de despesa e os
     meios de pagamento que a importação entende */
  const listas = wb.addWorksheet("Listas", { state: "hidden" });
  const validar = (coluna, formula) => {
    for (let r = 2; r <= LINHAS_VALIDACAO + 1; r++)
      ws.getCell(`${coluna}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [formula] };
  };
  if (tipo === "cobrancas") {
    const unidades = (ctx.unidades || []).map((u) => u.label).filter(Boolean);
    unidades.forEach((lbl, i) => { listas.getCell(`A${i + 1}`).value = lbl; });
    if (unidades.length) validar("A", `Listas!$A$1:$A$${unidades.length}`);
  } else {
    const cats = (ctx.categorias || []).filter((c) => c.tipo === "despesa").map((c) => c.nome);
    cats.forEach((nome, i) => { listas.getCell(`A${i + 1}`).value = nome; });
    if (cats.length) validar("D", `Listas!$A$1:$A$${cats.length}`);
    MEDIOS_PAGO.forEach((m, i) => { listas.getCell(`B${i + 1}`).value = m; });
    validar("F", `Listas!$B$1:$B$${MEDIOS_PAGO.length}`);
  }

  const abaInst = wb.addWorksheet(L("Instruções"));
  abaInst.getColumn(1).width = 100;
  const textos = [L(inst.titulo), "", ...inst.linhas.map((l) => "• " + L(l)), "", L("Exemplo de preenchimento:")];
  textos.forEach((tx, i) => { abaInst.getCell(`A${i + 1}`).value = tx; });
  abaInst.getCell("A1").font = { bold: true, size: 13 };
  const exemplo = [cols.map((c) => c.titulo), ...inst.exemplos(ctx)];
  exemplo.forEach((linha, li) => {
    linha.forEach((v, ci) => {
      const cell = abaInst.getCell(textos.length + 1 + li, ci + 1);
      cell.value = v;
      cell.font = li === 0 ? { bold: true, size: 9 } : { italic: true, size: 9 };
    });
  });

  return wb;
}

/* download no navegador — nome com o slug do condomínio, como o de pessoas */
export async function baixarModeloPlanilha(tipo, ctx) {
  const wb = await montarModeloPlanilha(tipo, ctx);
  const slug = String(ctx?.condominioNome || "condominio").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "condominio";
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `modelo-${tipo === "cobrancas" ? "cobrancas" : "gastos"}-${slug}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
