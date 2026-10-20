/* Feed de movimentações do sino — regras puras de apresentação.

   Os eventos nascem no BANCO (triggers do supabase-notificacoes.sql gravam
   em `notificacoes` a cada pagamento recebido e conta paga); o App só os
   consulta (listarNotificacoes, polling de 30 s) e exibe no sino da gestão.
   Aqui mora a tradução "linha do banco → item do sino", para a UI e a
   sonda compartilharem o mesmo cálculo:

   - formatarNotificacao: evento conhecido vira { chave, detalhe, cor, tela };
     evento desconhecido (futuro) cai no `titulo` gravado pelo trigger —
     o sino nunca quebra por um evento novo no banco;
   - contarNaoVistas: compara instantes absolutos (Date.parse de ISO UTC),
     nunca string formatada em fuso local — "visto até" vem do localStorage;
   - horaCurta: exibe no fuso do navegador (o banco grava UTC).

   Função pura e compartilhada: sem banco, sem import nenhum. */

/* evento do banco → apresentação; `chave` passa por L() na UI. */
export const EVENTOS_FEED = {
  "pagamento.confirmado": { chave: "Entrada recebida", cor: "ok", tela: "cobrancas" },
  "receita.recebida": { chave: "Receita recebida", cor: "ok", tela: "financeiro" },
  "conta.paga": { chave: "Conta paga", cor: "warn", tela: "financeiro" },
};

/* ISO → epoch ms; lixo/ausente → null (tolera "+00:00", "Z" e frações). */
const ts = (iso) => {
  const n = Date.parse(iso ?? "");
  return Number.isFinite(n) ? n : null;
};

/* "2026-05" (competencia char(7) do banco) → "05/2026"; lixo → "". */
const compCurta = (c) =>
  /^\d{4}-\d{2}/.test(String(c ?? "")) ? `${String(c).slice(5, 7)}/${String(c).slice(0, 4)}` : "";

/* linha de `notificacoes` → item do sino.
   → { id, chave, detalhe, valor, cor, tela, quando }
   `chave` é rótulo traduzível; `detalhe` é dado (unidade/competência ou
   descrição) e não passa por L(); payload corrompido não explode. */
export function formatarNotificacao(n) {
  const p = n?.payload && typeof n.payload === "object" ? n.payload : {};
  const conhecido = EVENTOS_FEED[n?.evento];
  const v = Number(p.valor);
  const base = {
    id: n?.id, valor: Number.isFinite(v) ? v : null, quando: n?.criado_em || null,
    cor: conhecido?.cor || "info", tela: conhecido?.tela || "financeiro",
  };
  if (!conhecido) return { ...base, chave: null, detalhe: String(n?.titulo || "") };
  if (n.evento === "pagamento.confirmado") {
    const comp = compCurta(p.competencia);
    const detalhe = [p.unidade, comp].filter(Boolean).join(" · ");
    return { ...base, chave: conhecido.chave, detalhe };
  }
  return { ...base, chave: conhecido.chave, detalhe: String(p.descricao || "") };
}

/* quantos itens do feed chegaram DEPOIS do último "visto até".
   feed indisponível (null) → 0; nunca visto → todas contam; instante
   exatamente igual ao visto não conta como novo. */
export function contarNaoVistas(feed, vistoAteISO) {
  if (!Array.isArray(feed)) return 0;
  const visto = ts(vistoAteISO);
  if (visto == null) return feed.length;
  return feed.reduce((s, n) => {
    const q = ts(n?.criado_em);
    return s + (q != null && q > visto ? 1 : 0);
  }, 0);
}

/* o item chegou depois do visto? (destaque no dropdown) — compara instante
   absoluto, nunca string ("+00:00" vs "Z"); sem visto, tudo é novo; item
   sem data nunca destaca. */
export const ehNova = (iso, vistoISO) => {
  const q = ts(iso);
  if (q == null) return false;
  const v = ts(vistoISO);
  return v == null || q > v;
};

/* ISO UTC → "dd/mm hh:mm" no fuso do navegador; lixo → "". */
export function horaCurta(iso) {
  const n = ts(iso);
  if (n == null) return "";
  const d = new Date(n);
  const p2 = (x) => String(x).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/* criado_em mais novo do feed (ISO) — o polling compara com o da sondagem
   anterior para detectar movimentação vinda de OUTRA janela/usuário e
   recarregar os dados do app (saldo, cards e pendências acompanham o sino).
   Não confia na ordem do feed; feed vazio/indisponível → null. */
export function maisRecente(feed) {
  if (!Array.isArray(feed)) return null;
  let melhor = null, melhorTs = null;
  for (const n of feed) {
    const q = ts(n?.criado_em);
    if (q != null && (melhorTs == null || q > melhorTs)) { melhorTs = q; melhor = n.criado_em; }
  }
  return melhor;
}

/* chave do "visto até" no localStorage — por condomínio E por perfil (o
   mesmo navegador pode alternar diretor/tesouraria sem zerar o do outro). */
export const chaveVisto = (condId, role) => `${condId || "?"}:${role || "?"}`;
