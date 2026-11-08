/* Sondas do IMPORT DE CONTAS A PAGAR por planilha (tela Finanças).

   · PURO — o vocabulário de DESPESA (inferirPapelDespesa), a resolução da
     linha (resolverLinhaDespesa) e o mapeamento de forma de pagamento
     (formaEnumDe) — tudo de src/lib/planilha.js, sem banco;
   · FONTE — o modal existe e chama importarLancamentos; a API carimba
     origem_tipo 'planilha' e deduplica; o card "A pagar" soma o enum CRU
     'aprovado' (o bug do card eternamente em 0).

   Uso: node scripts/testar-import-lancamentos.mjs */
import { readFileSync } from "node:fs";
import {
  inferirPapelDespesa, resolverLinhaDespesa, formaEnumDe, inferirPapel,
} from "../src/lib/planilha.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};

/* ══════════ PURO — vocabulário de despesa ══════════ */
console.log("━━ papéis da planilha de despesas (puro) ━━");

ok("cabeçalhos ES reais da conta a pagar",
  inferirPapelDespesa("Rubro") === "categoria" && inferirPapelDespesa("Concepto") === "descricao"
  && inferirPapelDespesa("Importe") === "valor" && inferirPapelDespesa("Fecha") === "data"
  && inferirPapelDespesa("Mes") === "competencia" && inferirPapelDespesa("Medio de pago") === "forma"
  && inferirPapelDespesa("Pagado") === "pago",
  ["Rubro", "Concepto", "Importe", "Fecha", "Medio de pago"].map((s) => `${s}→${inferirPapelDespesa(s) || "—"}`).join(" "));
ok("PT também; e 'Data de pagamento' é DATA, não pago",
  inferirPapelDespesa("Categoria") === "categoria" && inferirPapelDespesa("Descrição") === "descricao"
  && inferirPapelDespesa("Centro de custos") === "centro" && inferirPapelDespesa("Data de pagamento") === "data"
  && inferirPapelDespesa("Subcategoría") === "centro");
ok("título desconhecido fica sem papel", inferirPapelDespesa("Observações internas") === null && inferirPapelDespesa("") === null);
ok("o vocabulário de COBRANÇA continua separado (Período lá é competência também, Unid. não existe aqui)",
  inferirPapel("Unid.") === "unidade" && inferirPapelDespesa("Unid.") === null);

/* resolução da linha */
const COLS = [
  { chave: "rubro", titulo: "Rubro", tipo: "texto", papel: "categoria" },
  { chave: "concepto", titulo: "Concepto", tipo: "texto", papel: "descricao" },
  { chave: "importe", titulo: "Importe", tipo: "numero", papel: "valor" },
  { chave: "fecha", titulo: "Fecha", tipo: "data", papel: "data" },
  { chave: "mes", titulo: "Mes", tipo: "texto", papel: "competencia" },
  { chave: "pago", titulo: "Pagado", tipo: "texto", papel: "pago" },
  { chave: "medio", titulo: "Medio de pago", tipo: "texto", papel: "forma" },
];
const r1 = resolverLinhaDespesa(COLS, { rubro: "Limpieza", concepto: "Productos de limpieza", importe: 1234.56, fecha: "2026-10-05", mes: "oct/2026", pago: "pagado", medio: "Transferencia" });
ok("linha completa resolve (valor número, mês ES, pago por texto, forma→enum)",
  r1.valor === 1234.56 && r1.competencia === "2026-10" && r1.data === "2026-10-05"
  && r1.pago === true && r1.forma === "transferencia" && r1.categoria === "Limpieza",
  JSON.stringify({ v: r1.valor, c: r1.competencia, f: r1.forma }));
const r2 = resolverLinhaDespesa(COLS, { rubro: "Luz", concepto: "ANDE", importe: "1.234,56", fecha: "2026-09-15", mes: "", pago: "" });
ok("valor \"1.234,56\" vira número e o mês sai da DATA quando falta",
  r2.valor === 1234.56 && r2.competencia === "2026-09" && r2.pago === false,
  JSON.stringify({ v: r2.valor, c: r2.competencia }));
const r3 = resolverLinhaDespesa(COLS, { rubro: "Agua", importe: 0, fecha: "", mes: "" });
ok("sem valor e sem mês a linha sai vazia (o chamador recusa)",
  !(Number(r3.valor) > 0) && r3.competencia === "" && r3.desc === "");

ok("formaEnumDe cobre o vocabulário real e não inventa",
  formaEnumDe("Transferencia bancaria") === "transferencia" && formaEnumDe("Depósito") === "transferencia"
  && formaEnumDe("Débito automático") === "debito_automatico" && formaEnumDe("efectivo") === "dinheiro"
  && formaEnumDe("QR") === "verum_pay" && formaEnumDe("Tarjeta") === "stripe"
  && formaEnumDe("cheque") === null && formaEnumDe("") === null,
  ["Depósito", "efectivo", "cheque"].map((s) => `${s}→${formaEnumDe(s) || "—"}`).join(" "));

/* ══════════ FONTE — o fluxo montado ══════════ */
console.log("\n━━ o fluxo nas telas (fonte) ━━");
{
  const tela = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/lib/api.js", import.meta.url), "utf8");

  ok("o modal de import existe e grava via importarLancamentos com os poderes da pessoa",
    /function ImportarLancamentos\(/.test(tela)
    && /importarLancamentos\(db\.ctx, resolvidas, \{ aprovar: podeAprovar, baixar: podeAprovar && podeBaixar \}\)/.test(tela));
  ok("o palpite de papel no modal é o vocabulário de DESPESA",
    /inferirPapelDespesa\(c\.titulo\)/.test(tela));
  const imp = api.slice(api.indexOf("export async function importarLancamentos"),
    api.indexOf("export async function importarLancamentos") + 5000);
  ok("a API carimba a origem e deduplica por mês+valor+descrição",
    /origem_tipo: "planilha"/.test(imp) && /chaveDe\(v\.competencia, v\.valor, v\.desc\)/.test(imp));
  ok("linha paga só vira 'pago' com poder de baixa; sem aprovar, cai em aguardando",
    /v\.pago && baixar \? "pago" : aprovar \? "aprovado" : "aguardando_aprovacao"/.test(imp));
  ok("o card 'A pagar' soma o enum CRU 'aprovado' (não o status de UI)",
    /aPagar: soma\(lancRaw, \(l\) => l\.tipo === "despesa" && l\.status === "aprovado"\)/.test(api));
}

console.log(falhas ? `\n❌ import-lancamentos: ${falhas} falha(s)` : "\n💸 IMPORT DE CONTAS A PAGAR OK");
process.exit(falhas ? 1 : 0);
