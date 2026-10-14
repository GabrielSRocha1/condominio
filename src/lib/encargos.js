/* Encargos de atraso da cobrança — multa fixa + juros de mora por mês.

   A configuração mora em condominios.encargos_atraso (jsonb, coluna que o
   schema sempre teve e ninguém usava):
     { ativo: false, multa_pct: 2, juros_am_pct: 1,
       regime: "simples" | "composto", carencia_dias: 0 }
   `ativo` ausente = false: NENHUM condomínio existente muda até o diretor
   ligar nas configurações. Percentuais em escala humana (2 = 2%).

   A contagem de meses segue a planilla hispano-americana validada na Fase 1
   (coluna CANT.): diferença de meses-CALENDÁRIO entre o mês do vencimento e
   o mês de hoje — virou o mês, conta 1. Nunca negativa; dentro da carência
   (dias corridos após o vencimento) é zero.

   Função pura e compartilhada: api.js (db.cobr/stats/PDF), a UI e as
   funções serverless de pagamento importam DAQUI — um cálculo só, nos
   quatro cantos. Por isso não toca banco nem import nenhum. */

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function normalizarEncargosCfg(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    ativo: r.ativo === true,
    multa_pct: Math.max(0, num(r.multa_pct)),
    juros_am_pct: Math.max(0, num(r.juros_am_pct)),
    regime: r.regime === "composto" ? "composto" : "simples",
    carencia_dias: Math.max(0, Math.trunc(num(r.carencia_dias))),
  };
}

const diaUTC = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/* passou do vencimento + carência? (dias corridos; no dia-limite ainda não) */
export function emAtraso(vencimento, hoje = new Date(), carenciaDias = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(vencimento || ""));
  if (!m) return false;
  const limite = Date.UTC(+m[1], +m[2] - 1, +m[3]) + carenciaDias * 86400000;
  return diaUTC(hoje) > limite;
}

/* meses de atraso no estilo planilla (a coluna CANT. validada na Fase 1):
   meses-CALENDÁRIO entre o mês do vencimento e o de hoje — virou o mês,
   conta 1; atraso dentro do próprio mês é 0 (a multa cobre esse começo). */
export function mesesDeAtraso(vencimento, hoje = new Date()) {
  const m = /^(\d{4})-(\d{2})/.exec(String(vencimento || ""));
  if (!m) return 0;
  return Math.max((hoje.getFullYear() - +m[1]) * 12 + (hoje.getMonth() + 1 - +m[2]), 0);
}

const STATUS_EM_ABERTO = new Set(["emitida", "rascunho", "vencida", "pagamento_informado", "pagamento_divergente"]);

/* cobranca: { valor_original, vencimento, status } (nomes do banco).
   → { meses, multa, juros, encargos, total } — tudo zero com a cfg
   desligada, cobrança paga/cancelada ou dentro do prazo. A multa (única)
   incide assim que o atraso começa; os juros, a cada virada de mês. */
export function calcularEncargos(cobranca, cfg, hoje = new Date()) {
  const zero = { meses: 0, multa: 0, juros: 0, encargos: 0, total: num(cobranca?.valor_original) };
  const c = normalizarEncargosCfg(cfg);
  if (!c.ativo || !cobranca) return zero;
  if (cobranca.status && !STATUS_EM_ABERTO.has(cobranca.status)) return zero;
  const base = num(cobranca.valor_original);
  if (base <= 0) return zero;
  if (!emAtraso(cobranca.vencimento, hoje, c.carencia_dias)) return zero;
  const meses = mesesDeAtraso(cobranca.vencimento, hoje);
  const centavos = (v) => Math.round(v * 100) / 100;
  const multa = centavos(base * (c.multa_pct / 100));
  const juros = centavos(c.regime === "composto"
    ? base * (Math.pow(1 + c.juros_am_pct / 100, meses) - 1)
    : base * (c.juros_am_pct / 100) * meses);
  const encargos = centavos(multa + juros);
  return { meses, multa, juros, encargos, total: centavos(base + encargos) };
}
