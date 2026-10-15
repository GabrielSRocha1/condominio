/* Recebimento em lote — as regras puras da baixa de várias cobranças.

   O ReceberModal aceita N cobranças e aplica as MESMAS opções da baixa
   individual (total devido, sem encargos, desconto %) item a item; a RPC
   registrar_pagamento_manual continua sendo chamada uma vez por cobrança
   (idempotente por id, transacional por item). Aqui mora só a matemática
   e as regras de seleção, para a UI e a sonda compartilharem um cálculo:

   - o lote ancora na primeira cobrança marcada: só entram as do MESMO
     responsável (chaveLote) — recibo e WhatsApp com destinatário único;
   - o desconto é aplicado POR ITEM e arredondado POR ITEM: o total
     exibido é a soma dos arredondados, exatamente o que as RPCs gravam
     (nunca diverge por centavos do arredondado-da-soma).

   Função pura e compartilhada: sem banco, sem import nenhum. */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round(v * 100) / 100;

/* "12,5" → 12.5; lixo → 0; preso em 0..100 (o mesmo parse do modal). */
export const clampPct = (raw) =>
  Math.min(100, Math.max(0, Number(String(raw ?? "").replace(",", ".")) || 0));

/* só cobrança em aberto entra no lote (status da UI). */
export const elegivelLote = (c) => c?.status === "emitida" || c?.status === "vencida";

/* âncora da seleção: mesmo responsável; sem responsável, a unidade; sem
   nada, a própria cobrança (não agrupa com ninguém). */
export const chaveLote = (c) =>
  c?.respId || (c?.unidadeId ? `u:${c.unidadeId}` : `c:${c?.id}`);

/* cópia ordenada por competência (AAAA-MM asc — dívida mais antiga
   primeiro) e, dentro dela, pela unidade; modal, recibo e PDF usam a
   mesma ordem. */
export const ordenarLote = (cs) => [...(cs || [])].sort((a, b) =>
  String(a?.competencia || "").localeCompare(String(b?.competencia || "")) ||
  String(a?.unidade || "").localeCompare(String(b?.unidade || "")));

/* itens: [{ id, valor, encargos, valorTotal }] (shape de db.cobr).
   modo: "total" | "sem_encargos" | "desconto" (com pctRaw em %).
   → { pct, itens: [{ id, devido, valorFinal, ajuste }], totalDevido,
       totalFinal, totalAjuste, temEncargos, invalido }
   Invariante: totalFinal === soma dos valorFinal JÁ arredondados. */
export function calcularLote(itens, modo, pctRaw) {
  const pct = clampPct(pctRaw);
  const lista = (itens || []).map((c) => {
    const devido = round2(num(c?.valorTotal ?? c?.valor));
    const valorFinal = round2(
      modo === "sem_encargos" ? num(c?.valor)
      : modo === "desconto" ? devido * (1 - pct / 100)
      : devido);
    return { id: c?.id, devido, valorFinal, ajuste: round2(devido - valorFinal) };
  });
  const totalDevido = round2(lista.reduce((s, i) => s + i.devido, 0));
  const totalFinal = round2(lista.reduce((s, i) => s + i.valorFinal, 0));
  return {
    pct, itens: lista, totalDevido, totalFinal,
    totalAjuste: round2(totalDevido - totalFinal),
    temEncargos: (itens || []).some((c) => num(c?.encargos) > 0),
    invalido: !lista.length || totalFinal <= 0 || lista.some((i) => i.valorFinal <= 0),
  };
}
