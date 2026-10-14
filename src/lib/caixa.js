/* Saldo do caixa com ÂNCORA manual.

   O diretor informa na aba Gestão: "o caixa em <data> é <valor>" (positivo
   ou negativo — regras_internas.financeiro.caixa = { valor, em }). O saldo
   exibido passa a ser esse valor somado a tudo que entrou/saiu DEPOIS da
   data; o dia da âncora já está contido no número digitado. Sem âncora,
   vale a soma de sempre (receitas − despesas pagas).

   Puro e sem imports — a sonda testa sem subir o app (mesmo racional de
   encargos.js). `lancamentos` no shape cru do banco: { status, tipo,
   valor, data "AAAA-MM-DD" }. */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function saldoComAncora(lancamentos = [], caixa = null) {
  const temAncora = caixa && caixa.em && Number.isFinite(Number(caixa.valor));
  const base = temAncora ? num(caixa.valor) : 0;
  const corte = temAncora ? String(caixa.em).slice(0, 10) : "";
  return lancamentos.reduce((s, l) => {
    if (l?.status !== "pago") return s;
    if (temAncora && !(String(l.data || "") > corte)) return s; // até a âncora, já está no valor
    return s + (l.tipo === "receita" ? num(l.valor) : -num(l.valor));
  }, base);
}
