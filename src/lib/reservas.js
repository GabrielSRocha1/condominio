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

/* ── Lembrete: quão PRÓXIMA está a reserva ──

   O sino do morador mostrava toda reserva futura confirmada, para sempre: uma
   de três meses à frente tinha o mesmo peso de uma que é amanhã. Esta regra dá
   a noção de proximidade que faltava — e devolve `null` para a distante, que é
   o que a tira do sino (ela segue na aba e no card do Início).

   A fase é decidida por DIA DE CALENDÁRIO local, não por aritmética de horas:
   uma reserva às 9h de amanhã está a 20h de distância, e "em 20h" tem de ler
   "amanhã", não "hoje". `diaLocal` indexa o dia via Date.UTC dos componentes
   LOCAIS, que é imune a horário de verão (somar 86400000 não é).

   `agora` é parâmetro para a sonda poder fixar o instante — sem isso o teste
   dependeria do relógio da máquina. */
const diaLocal = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};
const diasEntre = (a, b) => Math.round((diaLocal(b) - diaLocal(a)) / 86400000);
const instante = (v) => (typeof v === "number" ? v : new Date(v).getTime());

export function faseReserva(reserva, agora = Date.now(), horas = 48) {
  const vazio = { fase: null, horasAte: null };
  if (!reserva || String(reserva.status) !== "confirmada") return vazio;
  const ini = instante(reserva.inicio), ag = instante(agora);
  if (!Number.isFinite(ini) || !Number.isFinite(ag)) return vazio;
  const fim = instante(reserva.fim);
  /* acontecendo agora: vale mais que qualquer lembrete */
  if (ini <= ag) return Number.isFinite(fim) && ag < fim ? { fase: "em_curso", horasAte: 0 } : vazio;
  const horasAte = (ini - ag) / 3600000;
  if (horasAte > horas) return { fase: null, horasAte };  // fora da janela: sai do sino
  const dias = diasEntre(ag, ini);
  return { fase: dias === 0 ? "hoje" : dias === 1 ? "amanha" : "proxima", horasAte };
}

/* A próxima reserva confirmada da lista (molde do proxAssembleia do portal).
   Ordena ASCENDENTE de propósito: db.reservas chega descendente por `inicio`
   (api.js), então pegar [0] sem reordenar daria a mais distante. Inclui a que
   está em curso (fim >= agora) — é a mais relevante enquanto acontece. */
export function proximaReserva(reservas, agora = Date.now()) {
  const ag = instante(agora);
  return (reservas || [])
    .filter((r) => String(r.status) === "confirmada"
      && Number.isFinite(instante(r.fim ?? r.inicio))
      && instante(r.fim ?? r.inicio) >= ag)
    .sort((a, b) => instante(a.inicio) - instante(b.inicio))[0] || null;
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

/* ── Cancelar: o que acontece com a TAXA ──

   Confirmar uma área com taxa gera a cobrança 'extra' da unidade
   (confirmar_reserva). Cancelar a reserva sem tocar nela deixava a cobrança
   viva e sem reserva que a justifique — e o tipo 'extra' não vira linha da
   planilha (o sync pula), então ela não tinha NENHUM caminho de tela para
   ser cancelada. Quem cancela a reserva agora cancela a taxa na mesma
   transação (RPC cancelar_reserva), e esta função é o que a tela usa para
   dizer o efeito ANTES do clique.

   Dinheiro já recebido não se move por aqui: taxa paga ou com informe
   pendente recusa o cancelamento — a devolução é ato explícito da tela
   Cobranças, a mesma regra que a RPC cancelar_cobranca já aplica.

   Entrada: a reserva mapeada pelo loadAll ({ status, taxa, cobrancaId,
   cobrancaStatus }) — `cobrancaStatus` é o status de EXIBIÇÃO
   (COBR_STATUS_UI: pago, emitida, vencida, cancelada, informado,
   divergente), não o enum do banco. */
const TAXA_TRAVA = { pago: "taxa_paga", informado: "taxa_informe_pendente", divergente: "taxa_informe_pendente" };
export function efeitoCancelamento(reserva) {
  if (!reserva || !podeTransicionar(reserva.status, "cancelada"))
    return { podeCancelar: false, cancelaTaxa: false, valor: 0, motivo: "status_invalido" };
  const motivo = TAXA_TRAVA[String(reserva.cobrancaStatus)] || null;
  if (reserva.cobrancaId && motivo)
    return { podeCancelar: false, cancelaTaxa: false, valor: Number(reserva.taxa) || 0, motivo };
  /* taxa já cancelada (ou área sem taxa): cancelar a reserva é só a reserva */
  const cancelaTaxa = !!reserva.cobrancaId && String(reserva.cobrancaStatus) !== "cancelada";
  return { podeCancelar: true, cancelaTaxa, valor: cancelaTaxa ? Number(reserva.taxa) || 0 : 0, motivo: null };
}

/* ── Desfazer uma entrada do histórico de `reservas` ──

   Espelho JS da guarda da RPC desfazer_alteracao: ela decide pelo PAR
   antes/depois, não pela relação (recusar um pedido não mexe em dinheiro
   nenhum e sempre foi tão indesfazível quanto a confirmação que gera a
   cobrança). Aqui é só para a aba esconder o botão que o servidor recusaria
   — a autoridade continua no banco.

   `linha` = linha da view historico_unificado ({ acao, antes, depois });
   `reserva` = a reserva de hoje (db.reservas), ou null se já não existe. */
export function podeDesfazerReserva(linha, reserva) {
  const antes = linha?.antes || {}, depois = linha?.depois || {};
  /* desfazer a CONFIRMAÇÃO (foi ela que criou a cobrança): só se a taxa
     ainda puder ser cancelada junto */
  if (String(linha?.acao) === "UPDATE" && !antes.cobranca_id && depois.cobranca_id) {
    const motivo = TAXA_TRAVA[String(reserva?.cobrancaStatus)] || null;
    return { ok: !motivo, motivo };
  }
  /* desfazer um CANCELAMENTO exigiria re-emitir a taxa que foi cancelada —
     o Histórico não emite cobrança: confirmar de novo é pela tela Reservas */
  if (antes.cobranca_id && String(reserva?.cobrancaStatus) === "cancelada")
    return { ok: false, motivo: "taxa_cancelada" };
  return { ok: true, motivo: null };
}

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
