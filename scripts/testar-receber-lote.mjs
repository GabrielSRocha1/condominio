/* Sondas do RECEBIMENTO EM LOTE (motor puro, sem banco).

   Prova src/lib/receber-lote.js: desconto aplicado e arredondado POR ITEM
   (o total exibido = soma dos arredondados = o que as RPCs gravam, e isso
   DIFERE do arredondado-da-soma), fallback valorTotal→valor, "sem
   encargos" em lote misto, clamp do %, lotes inválidos (vazio, item
   zerado, 100% de desconto), âncora do responsável e ordenação estável.

   Uso: node scripts/testar-receber-lote.mjs */
import { calcularLote, clampPct, chaveLote, ordenarLote, elegivelLote } from "../src/lib/receber-lote.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const soma = (r) => Math.round(r.itens.reduce((s, i) => s + i.valorFinal * 100, 0)) / 100;

console.log("━━ L · recebimento em lote (puro) ━━");

/* L1 · modo total: soma dos devidos, com fallback valorTotal→valor */
const base = [
  { id: "a", valor: 100, encargos: 12.5, valorTotal: 112.5 },
  { id: "b", valor: 80, encargos: 0, valorTotal: 80 },
  { id: "c", valor: 55.4 },                       // histórico sem valorTotal
];
const total = calcularLote(base, "total", "");
ok("L1 total devido soma os itens (valorTotal ?? valor)",
  total.totalFinal === 247.9 && total.totalDevido === 247.9 && !total.invalido
  && total.itens[2].devido === 55.4 && total.totalAjuste === 0,
  JSON.stringify({ totalFinal: total.totalFinal }));

/* L2 · sem encargos em lote misto: só quem tem encargos cai ao principal */
const semEnc = calcularLote(base, "sem_encargos", "");
ok("L2 sem encargos derruba só os itens com mora (ajuste por item)",
  semEnc.totalFinal === 235.4 && semEnc.itens[0].valorFinal === 100
  && semEnc.itens[0].ajuste === 12.5 && semEnc.itens[1].ajuste === 0
  && semEnc.temEncargos === true && semEnc.totalAjuste === 12.5,
  JSON.stringify({ totalFinal: semEnc.totalFinal }));

/* L3 · invariante do desconto: arredonda POR ITEM e o total é a soma dos
   arredondados — 3 × 10,01 a 50% dá 3 × 5,01 = 15,03 (o arredondado da
   soma daria 15,02). O total exibido é o que as 3 RPCs vão gravar. */
const tres = [{ id: 1, valor: 10.01 }, { id: 2, valor: 10.01 }, { id: 3, valor: 10.01 }];
const desc = calcularLote(tres, "desconto", "50");
const arredDaSoma = Math.round(desc.totalDevido * (1 - 0.5) * 100) / 100;
ok("L3 desconto por item: totalFinal = Σ arredondados ≠ arredondado-da-soma",
  desc.itens.every((i) => i.valorFinal === 5.01) && desc.totalFinal === 15.03
  && desc.totalFinal === soma(desc) && arredDaSoma === 15.02,
  `porItem ${desc.totalFinal} · daSoma ${arredDaSoma}`);

/* L4 · clamp do % no padrão do modal (vírgula, ponto, lixo, fora da faixa) */
ok("L4 clampPct: vírgula, ponto, vazio, lixo, >100 e negativo",
  clampPct("12,5") === 12.5 && clampPct("1.5") === 1.5 && clampPct("") === 0
  && clampPct("abc") === 0 && clampPct("150") === 100 && clampPct("-5") === 0
  && clampPct(null) === 0);

/* L5 · lotes inválidos: 100% de desconto, item zerado, lote vazio */
const cem = calcularLote(tres, "desconto", "100");
const zerado = calcularLote([{ id: 1, valor: 50 }, { id: 2, valor: 0 }], "total", "");
const vazio = calcularLote([], "total", "");
ok("L5 inválidos: desconto 100%, item zerado no meio e lote vazio",
  cem.invalido && cem.totalFinal === 0
  && zerado.invalido && zerado.itens[1].valorFinal === 0
  && vazio.invalido && vazio.totalFinal === 0 && vazio.totalDevido === 0);

/* L6 · âncora da seleção: respId manda; sem respId, a unidade; sem nada,
   a própria cobrança (ninguém agrupa) */
ok("L6 chaveLote: responsável → unidade → a própria cobrança",
  chaveLote({ respId: "p1", unidadeId: "u9" }) === "p1"
  && chaveLote({ respId: null, unidadeId: "u9" }) === "u:u9"
  && chaveLote({ id: "c7" }) === "c:c7"
  && chaveLote({ respId: "p1" }) === chaveLote({ respId: "p1", unidadeId: "outra" }));

/* L7 · ordenação: competência asc (dívida antiga primeiro), unidade como
   desempate, sem mutar a entrada */
const bagunca = [
  { id: 1, competencia: "2025-01", unidade: "B-2" },
  { id: 2, competencia: "2024-12", unidade: "B-2" },
  { id: 3, competencia: "2025-01", unidade: "A-1" },
];
const ordenado = ordenarLote(bagunca);
ok("L7 ordenarLote: 2024-12 antes de 2025-01, desempate por unidade, entrada intacta",
  ordenado.map((c) => c.id).join(",") === "2,3,1" && bagunca[0].id === 1
  && ordenado !== bagunca);

/* L8 · elegibilidade: só emitida e vencida entram no lote */
ok("L8 elegivelLote: emitida/vencida sim; pago, informado, divergente, cancelada não",
  elegivelLote({ status: "emitida" }) && elegivelLote({ status: "vencida" })
  && !elegivelLote({ status: "pago" }) && !elegivelLote({ status: "informado" })
  && !elegivelLote({ status: "divergente" }) && !elegivelLote({ status: "cancelada" })
  && !elegivelLote(null));

/* L9 · lote de 1 item reproduz a matemática do modal individual */
const um = calcularLote([{ id: "x", valor: 100, encargos: 29.9, valorTotal: 129.9 }], "desconto", "7,5");
ok("L9 lote de 1 = baixa individual (desconto 7,5% sobre o devido)",
  um.itens[0].valorFinal === 120.16 && um.totalFinal === 120.16
  && um.itens[0].ajuste === 9.74 && um.pct === 7.5,
  JSON.stringify(um.itens[0]));

console.log(falhas ? `\n❌ ${falhas} sonda(s) falharam` : "\n🧾 RECEBIMENTO EM LOTE OK");
process.exitCode = falhas ? 1 : 0;
