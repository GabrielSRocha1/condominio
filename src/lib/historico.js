/* HISTÓRICO DE ALTERAÇÕES — regras de leitura da trilha unificada.

   A aba Histórico (tela.historico, padrão: só o diretor) lê a view
   public.historico_unificado (supabase-historico.sql), que mescla DUAS
   fontes append-only:
     · `auditoria`         — CRUD das telas, gravado pelo gatilho genérico
       trg_historico (acao INSERT/UPDATE/DELETE/DESFAZ, com antes/depois);
     · `auditoria_eventos` — segurança e eventos de negócio já existentes
       (logins, acessos, permissões, pagamentos…), acao 'EVENTO'.
   Este módulo traduz a linha crua em algo legível: categoria do chip,
   verbo com cor, descrição e diff — e decide o que é desfazível.

   Módulo quase puro: importa SÓ de ./aprovacoes.js (zero imports), para
   reusar rótulos de tabela/campo e não criar drift com a tela Aprovações.
   Sondável no Node: scripts/testar-historico.mjs. */

import { rotuloTabela, rotuloCampo, valorTexto, CAMPOS_OCULTOS } from "./aprovacoes.js";

/* ── Chips de categoria (a ordem é a da tela) ── */
export const CATEGORIAS = [
  { id: "financas",    rotulo: "Finanças" },
  { id: "cobrancas",   rotulo: "Cobranças" },
  { id: "pessoas",     rotulo: "Pessoas" },
  { id: "unidades",    rotulo: "Unidades" },
  { id: "multas",      rotulo: "Multas" },
  { id: "comunicacao", rotulo: "Comunicação" },
  { id: "operacao",    rotulo: "Operação" },
  { id: "seguranca",   rotulo: "Segurança e acessos" },
];

/* ── entidade (tabela OU evento) → categoria ──
   As TABELAS são as 19 cobertas pelo gatilho trg_historico (a sonda compara
   esta lista com os arrays do supabase-historico.sql — paridade obrigatória).
   Os EVENTOS são o vocabulário de auditoria_eventos: api/_lib/seguranca.js
   (+ login/esqueci/acessos/permissoes) e os triggers de seguranca3,
   planilhas e planilha-sync. Rótulo de tabela vem de aprovacoes.TABELAS;
   o de evento é a própria frase (EVENTOS abaixo). */
export const ENTIDADES = {
  /* tabelas do gatilho genérico */
  categorias_financeiras:   "financas",
  fundos:                   "financas",
  lancamentos:              "financas",
  cobrancas:                "cobrancas",
  planilhas_cobranca:       "cobrancas",
  pessoas:                  "pessoas",
  pessoa_vinculos:          "pessoas",
  condominios:              "unidades",
  blocos:                   "unidades",
  unidades:                 "unidades",
  vagas:                    "unidades",
  penalidades:              "multas",
  penalidade_provas:        "multas",
  comunicados:              "comunicacao",
  comunicado_destinatarios: "comunicacao",
  documentos:               "comunicacao",
  chamados:                 "operacao",
  acessos_portaria:         "operacao",
  pre_autorizacoes:         "operacao",
  areas_comuns:             "operacao",
  reservas:                 "operacao",
  assembleias:              "comunicacao",
  atas:                     "comunicacao",
  /* eventos de auditoria_eventos */
  pagamento_registrado:     "cobrancas",
  informe_criado:           "cobrancas",
  informe_confirmado:       "cobrancas",
  informe_rejeitado:        "cobrancas",
  cobranca_cancelada:       "cobrancas",
  planilha_criada:          "cobrancas",
  planilha_atualizada:      "cobrancas",
  login_sucesso:            "seguranca",
  login_falha:              "seguranca",
  login_bloqueado:          "seguranca",
  logout:                   "seguranca",
  conta_criada:             "seguranca",
  condominio_criado:        "seguranca",
  acesso_criado:            "seguranca",
  acesso_removido:          "seguranca",
  acesso_papel_alterado:    "seguranca",
  perfil_concedido:         "seguranca",
  perfil_removido:          "seguranca",
  permissoes_alteradas:     "seguranca",
  permissoes_restauradas:   "seguranca",
  codigo_recuperacao_gerado:"seguranca",
  senha_recuperada:         "seguranca",
  sessao_reuso_detectado:   "seguranca",
};

/* evento → frase PT (traduzida na tela por L()). Famílias com sufixo
   variável (recuperacao_*, informe_*) caem no prefixo. */
export const EVENTOS = {
  login_sucesso:             "Entrou no sistema",
  login_falha:               "Tentativa de login falhou",
  login_bloqueado:           "Login bloqueado por excesso de tentativas",
  logout:                    "Saiu do sistema",
  conta_criada:              "Conta criada",
  condominio_criado:         "Condomínio criado",
  acesso_criado:             "Acesso criado",
  acesso_removido:           "Acesso removido",
  acesso_papel_alterado:     "Papel do acesso alterado",
  perfil_concedido:          "Perfil de acesso concedido",
  perfil_removido:           "Perfil de acesso removido",
  permissoes_alteradas:      "Matriz de permissões alterada",
  permissoes_restauradas:    "Matriz de permissões restaurada ao padrão",
  codigo_recuperacao_gerado: "Código de recuperação de senha gerado",
  senha_recuperada:          "Senha redefinida",
  sessao_reuso_detectado:    "Reuso de sessão detectado (possível roubo de token)",
  pagamento_registrado:      "Pagamento registrado (baixa)",
  informe_criado:            "Pagamento informado pelo morador",
  informe_confirmado:        "Pagamento informado confirmado",
  informe_rejeitado:         "Pagamento informado rejeitado",
  cobranca_cancelada:        "Cobrança cancelada",
  planilha_criada:           "Planilha de cobranças criada",
  planilha_atualizada:       "Planilha de cobranças atualizada",
};
const PREFIXOS = [
  ["recuperacao_", { categoria: "seguranca", frase: "Recuperação de senha" }],
  ["informe_",     { categoria: "cobrancas", frase: "Pagamento informado — atualização" }],
];
const porPrefixo = (e) => PREFIXOS.find(([p]) => String(e).startsWith(p))?.[1] || null;

export const categoriaDe = (entidade) =>
  ENTIDADES[String(entidade)] || porPrefixo(entidade)?.categoria || "outros";
/* duas tabelas auditadas não existem em aprovacoes.TABELAS (nunca entraram
   na fila) — rótulo local para não vazar nome cru de tabela na tela */
const ROTULOS_EXTRA = {
  pre_autorizacoes: "Pré-autorização de visita",
  acessos_portaria: "Registro de portaria",
  areas_comuns: "Área comum",
  reservas: "Reserva",
  assembleias: "Assembleia",
  atas: "Ata",
};
export const rotuloEntidade = (entidade) => {
  const e = String(entidade);
  if (EVENTOS[e]) return "Sistema"; /* evento não tem "tabela": a frase é a descrição */
  return ROTULOS_EXTRA[e] || rotuloTabela(e);
};
export const fraseEvento = (entidade) =>
  EVENTOS[String(entidade)] || porPrefixo(entidade)?.frase || String(entidade);
/* entidades do filtro server-side (.in) de um chip; null = sem filtro */
export const entidadesDaCategoria = (catId) =>
  !catId || catId === "todas" ? null
    : Object.keys(ENTIDADES).filter((e) => ENTIDADES[e] === catId);

/* ── Verbos ──
   INSERT numa tabela-FILHA é "Adicionou" (adicionou uma vaga à unidade, uma
   prova à multa…) — pedido explícito: criou/editou/excluiu/adicionou. */
export const TABELAS_FILHAS = new Set([
  "blocos", "vagas", "pessoa_vinculos", "penalidade_provas", "comunicado_destinatarios",
]);
export const VERBOS = {
  INSERT: { rotulo: "Criou",    tom: "ok" },
  UPDATE: { rotulo: "Editou",   tom: "info" },
  DELETE: { rotulo: "Excluiu",  tom: "danger" },
  DESFAZ: { rotulo: "Desfez",   tom: "warn" },
  EVENTO: { rotulo: "Evento",   tom: "dim" },
};
export function verboAcao(linha) {
  const a = String(linha?.acao || "");
  if (a === "INSERT" && TABELAS_FILHAS.has(String(linha?.entidade)))
    return { rotulo: "Adicionou", tom: "ok" };
  return VERBOS[a] || { rotulo: a || "—", tom: "dim" };
}

/* ── Diff e descrição ── */
const iguais = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const vivos = (obj) =>
  Object.keys(obj || {}).filter((c) => !CAMPOS_OCULTOS.has(c))
    .filter((c) => obj[c] !== null && obj[c] !== "");

/* [{campo, de, para}] — para o modal de detalhe. EVENTO vira pares do
   `detalhe` jsonb (de = null). */
export function diffLinha(linha) {
  const { acao, antes, depois, detalhe } = linha || {};
  if (acao === "EVENTO")
    return vivos(detalhe).map((c) => ({ campo: c, de: null, para: detalhe[c] }));
  if (acao === "INSERT")
    return vivos(depois).map((c) => ({ campo: c, de: null, para: depois[c] }));
  if (acao === "DELETE")
    return vivos(antes).map((c) => ({ campo: c, de: antes[c], para: null }));
  /* UPDATE e DESFAZ: só o que de fato mudou */
  const campos = new Set([...Object.keys(antes || {}), ...Object.keys(depois || {})]);
  return [...campos].filter((c) => !CAMPOS_OCULTOS.has(c))
    .filter((c) => !iguais((antes || {})[c], (depois || {})[c]))
    .map((c) => ({ campo: c, de: (antes || {})[c], para: (depois || {})[c] }));
}

/* resumo humano da linha afetada (quem é o "Apto 10-A" da história).
   `papel` e `email` entraram por causa das tabelas sem nome próprio:
   um vínculo excluído mostrava "—" quando tem "sindico" para contar. */
const CHAVES_RESUMO = ["nome", "nome_fantasia", "titulo", "descricao", "numero", "competencia", "papel", "email"];
export function resumoLinha(linha) {
  const alvo = linha?.depois || linha?.antes || {};
  for (const c of CHAVES_RESUMO) if (alvo[c]) return String(alvo[c]);
  return "";
}

const curto = (v, n = 40) => {
  const s = valorTexto(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

/* O que do `detalhe` de um EVENTO vale mostrar na PRÓPRIA linha — valores
   legíveis (nome, e-mail, perfil…), nunca uuid (uuid fica para o modal).
   Um "Acesso removido" sem isto não dizia QUEM foi removido. */
const DETALHE_VISIVEL = ["nome", "email", "perfil", "papel", "unidade", "competencia", "valor", "motivo", "forma", "origem", "descricao"];
const ehUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function detalheCurto(linha) {
  const d = linha?.detalhe;
  if (!d || typeof d !== "object" || Array.isArray(d)) return "";
  return DETALHE_VISIVEL
    .filter((k) => d[k] !== null && d[k] !== undefined && d[k] !== "" && !ehUuid(d[k]) && typeof d[k] !== "object")
    .map((k) => curto(d[k])).join(" · ");
}

/* Uma frase por linha da tabela. UPDATE: "Valor: 100 → 150 (+2 campos)". */
export function descrever(linha, maxCampos = 3) {
  const acao = String(linha?.acao || "");
  if (acao === "EVENTO") {
    const det = detalheCurto(linha);
    return det ? `${fraseEvento(linha?.entidade)} · ${det}` : fraseEvento(linha?.entidade);
  }
  const resumo = resumoLinha(linha);
  if (acao === "INSERT" || acao === "DELETE") return resumo;
  const d = diffLinha(linha);
  const mostra = d.slice(0, maxCampos)
    .map(({ campo, de, para }) => `${rotuloCampo(campo)}: ${curto(de)} → ${curto(para)}`);
  const resto = d.length - mostra.length;
  return mostra.join(" · ") + (resto > 0 ? ` (+${resto})` : "");
}

export function rotuloAutor(linha) {
  if (linha?.autor_nome) return String(linha.autor_nome);
  if (linha?.autor_email) return String(linha.autor_email);
  return String(linha?.perfil || "") === "sistema" || !linha?.usuario_id ? "Sistema" : "—";
}

/* busca client-side na página carregada, sem acento e sem caixa */
const chata = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filtrarBusca(linhas, q) {
  const alvo = chata(q).trim();
  if (!alvo) return linhas || [];
  return (linhas || []).filter((l) =>
    chata(`${descrever(l, 99)} ${rotuloAutor(l)} ${rotuloEntidade(l.entidade)} ${l.perfil || ""}`).includes(alvo));
}

/* ── Desfazer ──
   Espelho EXATO do array bloqueado na RPC desfazer_alteracao
   (supabase-historico.sql) — a sonda compara os dois. Dinheiro fica fora:
   baixa, cancelamento e rejeição mexem em várias tabelas dentro de RPCs
   próprias; desfazer só a parte auditada deixaria o caixa sem lastro. */
export const ENTIDADES_SEM_DESFAZER = new Set([
  "cobrancas", "lancamentos", "fundos", "planilhas_cobranca", "acessos_portaria",
  /* confirmar reserva GERA cobrança (confirmar_reserva) — desfazer a
     reserva deixaria a cobrança sem lastro (09/11/2026) */
  "reservas",
]);
export function podeDesfazer(linha) {
  if (String(linha?.fonte) !== "dados") return false;
  if (!["INSERT", "UPDATE", "DELETE"].includes(String(linha?.acao))) return false;
  if (ENTIDADES_SEM_DESFAZER.has(String(linha?.entidade))) return false;
  /* jsonb gigante foi gravado como marcador — não dá para restaurar fiel */
  if (linha?.antes?._grande || linha?.depois?._grande) return false;
  return true;
}
