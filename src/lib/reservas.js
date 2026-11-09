/* RESERVAS E ASSEMBLEIAS — regras puras das duas telas.

   As tabelas nasceram no schema (areas_comuns, reservas, assembleias,
   atas); este módulo concentra o que é regra, não tela: janela de
   reserva, pré-checagem de conflito (a AUTORIDADE é a constraint GiST do
   banco — aqui é só conforto imediato), antecedência mínima da área,
   pauta texto ⇄ jsonb, quórum e transições de status.

   Módulo PURO (zero imports): sondável no Node (scripts/testar-reservas.mjs),
   usado pela tela da gestão e pelo portal do morador. */

/* ── Datas ──
   agoraLocal: valor para <input type="datetime-local"> no fuso do
   navegador (promovido daqui para substituir as duas cópias locais que
   existiam em Portaria e PortalMorador). */
export const agoraLocal = (base = new Date()) => {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
/* fim sugerido: início + N horas, no mesmo formato do input */
export const fimPadrao = (inicioLocal, horas = 4) => {
  const d = new Date(inicioLocal);
  if (isNaN(d)) return "";
  d.setHours(d.getHours() + horas);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/* ── Conflito (advisory) ──
   Sobreposição de intervalos na MESMA área, ignorando canceladas e
   concluídas — o mesmo recorte da constraint `exclude using gist … where
   status in ('solicitada','confirmada')`. Devolve a reserva que colide
   (para a tela dizer com quem) ou null. */
const ATIVAS = new Set(["solicitada", "confirmada"]);
export function conflita(reservas, areaId, inicioISO, fimISO, ignorarId = null) {
  const ini = new Date(inicioISO).getTime();
  const fim = new Date(fimISO).getTime();
  if (!(ini < fim)) return null; // janela inválida é problema de outra validação
  return (reservas || []).find((r) =>
    r.areaId === areaId && r.id !== ignorarId && ATIVAS.has(String(r.status))
    && new Date(r.inicio).getTime() < fim && ini < new Date(r.fim).getTime()) || null;
}

/* ── Antecedência mínima da área (regras.antecedencia_horas) ──
   Advisory no portal; a gestão registra o que precisar. */
export function antecedenciaOk(regras, inicioISO, agoraISO = null) {
  const horas = Number(regras?.antecedencia_horas || 0);
  if (!horas) return { ok: true, horas: 0 };
  const agora = agoraISO ? new Date(agoraISO).getTime() : Date.now();
  const ok = new Date(inicioISO).getTime() - agora >= horas * 3600_000;
  return { ok, horas };
}

/* ── Transições de status (quem pode ir para onde) ── */
export const RESERVA_TRANSICOES = {
  solicitada: ["confirmada", "cancelada"],
  confirmada: ["concluida", "cancelada"],
  cancelada: [],
  concluida: [],
};
export const podeTransicionar = (de, para) =>
  (RESERVA_TRANSICOES[String(de)] || []).includes(String(para));

/* ── Pauta: textarea (uma linha por item) ⇄ jsonb (array de strings) ── */
export const pautaParaJson = (texto) =>
  String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
export const pautaParaTexto = (pauta) =>
  (Array.isArray(pauta) ? pauta : []).map(String).join("\n");

/* ── Presenças (assembleias.presencas jsonb = array de chaves de unidade) ── */
export const togglePresenca = (presencas, chave) => {
  const lista = Array.isArray(presencas) ? presencas.map(String) : [];
  return lista.includes(String(chave))
    ? lista.filter((c) => c !== String(chave))
    : [...lista, String(chave)];
};
/* quórum: % de unidades presentes sobre o total, contra o mínimo da
   assembleia (quorum_minimo em %, opcional) */
export function quorum(presencas, totalUnidades, quorumMinimo = null) {
  const presentes = Array.isArray(presencas) ? presencas.length : 0;
  const pct = totalUnidades > 0 ? Math.round((presentes / totalUnidades) * 1000) / 10 : 0;
  const minimo = quorumMinimo === null || quorumMinimo === undefined || quorumMinimo === ""
    ? null : Number(quorumMinimo);
  return { presentes, pct, minimo, atingido: minimo === null ? null : pct >= minimo };
}
