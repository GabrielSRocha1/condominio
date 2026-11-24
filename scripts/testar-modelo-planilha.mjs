/* Sondas do MODELO .xlsx dos imports livres (histórico de cobranças e
   contas a pagar — botão "Baixar modelo" dos modais de importação).

   O que elas provam: o arquivo gerado REIMPORTA sozinho — cada cabeçalho
   canônico infere o papel declarado, a linha preenchida resolve unidade/
   competência/valor pelo mesmo caminho dos modais, e o gasto sem Fecha
   cai no dia 12. Se alguém mexer no vocabulário (PAPEIS/PAPEIS_DESP) ou
   nos títulos do modelo e quebrar o ciclo, é aqui que estoura.

   Uso: node scripts/testar-modelo-planilha.mjs */
import { readFileSync } from "node:fs";
import { montarModeloPlanilha, CABECALHOS_MODELO } from "../src/lib/modelo-planilha.js";
import {
  lerPlanilhaLivre, inferirPapel, inferirPapelDespesa, resolverLinha, resolverLinhaDespesa,
  inferirTipo, normalizarValor,
} from "../src/lib/planilha.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};

/* ══════════ papel por papel (puro) ══════════ */
console.log("━━ cabeçalhos canônicos → papéis ━━");
ok("modelo de COBRANÇAS: todo título infere o papel declarado",
  CABECALHOS_MODELO.cobrancas.every((c) => inferirPapel(c.titulo) === c.papel),
  CABECALHOS_MODELO.cobrancas.map((c) => `${c.titulo}→${inferirPapel(c.titulo) || "—"}`).join(" "));
ok("modelo de GASTOS: todo título infere o papel declarado",
  CABECALHOS_MODELO.lancamentos.every((c) => inferirPapelDespesa(c.titulo) === c.papel),
  CABECALHOS_MODELO.lancamentos.map((c) => `${c.titulo}→${inferirPapelDespesa(c.titulo) || "—"}`).join(" "));

/* a raiz do bug que o modelo expôs: paraNumero arranca as letras e
   "oct/2026" virava 2026 — coluna inteira coagida, competência perdida */
ok("competência escrita não vira número (tipo e coerção)",
  inferirTipo(["oct/2026", "nov/2026"]) === "texto"
  && normalizarValor("oct/2026", "numero") === "oct/2026"
  && normalizarValor("Gs 6.000.000", "numero") === 6000000,
  `tipo ${inferirTipo(["oct/2026"])} · ${JSON.stringify(normalizarValor("oct/2026", "numero"))}`);

const ctx = {
  condominioNome: "Sonda Modelo",
  unidades: [{ id: "u1", label: "1-A" }, { id: "u2", label: "2-B" }],
  categorias: [{ tipo: "despesa", nome: "Servicios" }, { tipo: "receita", nome: "Extra" }],
};
const arquivoDe = async (wb, nome) => {
  const buf = await wb.xlsx.writeBuffer();
  return { name: nome, size: buf.byteLength, arrayBuffer: async () => buf };
};

/* ══════════ ciclo completo: baixar → preencher → importar ══════════ */
console.log("\n━━ ciclo completo (gera, preenche uma linha e relê) ━━");
{
  /* cobranças: o modal chama SEM layout — o detector de mora vê as 3 abas
     (principal, Listas oculta, Instruções) e não pode se confundir */
  const wb = await montarModeloPlanilha("cobrancas", ctx);
  wb.getWorksheet("Cobranzas").addRow(["1-A", "María Souza", "123456-7", "oct/2026", 350000, "10/10/2026", ""]);
  const lido = await lerPlanilhaLivre(await arquivoDe(wb, "modelo-cobrancas.xlsx"));
  const cols = lido.colunas.map((c) => ({ ...c, papel: inferirPapel(c.titulo) }));
  ok("modelo de cobranças relê em layout plano com a linha preenchida",
    lido.layout !== "mora" && lido.linhas.length === 1 && cols.length === 7,
    `layout ${lido.layout || "plano"} · ${lido.linhas.length} linha(s) · ${cols.length} coluna(s)`);
  const r = resolverLinha(cols, lido.linhas[0]?.dados, ctx);
  ok("a linha resolve unidade, competência, valor, vencimento e pago=false",
    r.unidadeId === "u1" && r.competencia === "2026-10" && r.valor === 350000
    && r.vencimento === "2026-10-10" && r.pago === false,
    JSON.stringify({ u: r.unidadeId, c: r.competencia, v: r.valor, venc: r.vencimento }));
}
{
  /* gastos: o modal de Finanças chama com layout "plano" */
  const wb = await montarModeloPlanilha("lancamentos", ctx);
  wb.getWorksheet("Gastos").addRow(["", "oct/2026", "Energía eléctrica", "Servicios", 937168, "Transferencia", ""]);
  const lido = await lerPlanilhaLivre(await arquivoDe(wb, "modelo-gastos.xlsx"), { layout: "plano" });
  const cols = lido.colunas.map((c) => ({ ...c, papel: inferirPapelDespesa(c.titulo) }));
  const r = resolverLinhaDespesa(cols, lido.linhas[0]?.dados);
  ok("modelo de gastos relê e resolve — sem Fecha, a data cai no dia 12",
    lido.linhas.length === 1 && r.competencia === "2026-10" && r.data === "2026-10-12"
    && r.valor === 937168 && r.categoria === "Servicios" && r.forma === "transferencia" && r.pago === false,
    JSON.stringify({ c: r.competencia, d: r.data, v: r.valor, f: r.forma }));
}

/* ══════════ FONTE — os modais oferecem o botão ══════════ */
console.log("\n━━ o botão nas telas (fonte) ━━");
{
  const tela = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
  ok("os modais de cobranças e de contas a pagar têm o Baixar modelo",
    /<BaixarModeloBox t=\{t\} tipo="cobrancas" \/>/.test(tela)
    && /<BaixarModeloBox t=\{t\} tipo="lancamentos" \/>/.test(tela)
    && /baixarModeloPlanilha\(tipo, db\.ctx\)/.test(tela));
}

console.log(falhas ? `\n❌ modelo-planilha: ${falhas} falha(s)` : "\n📋 MODELO DE PLANILHA OK");
process.exit(falhas ? 1 : 0);
