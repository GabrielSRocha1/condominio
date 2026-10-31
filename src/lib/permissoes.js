/* MATRIZ DE PERMISSÕES — catálogo, padrão por perfil e resolução do override.

   Até aqui a permissão efetiva era o NOME do perfil, repetido em três
   lugares (NAV.roles no front, jwt_perfil() no RLS/RPCs, claims.perfil na
   API) e as tabelas perfis/permissoes/perfil_permissoes eram andaime morto.
   Este módulo é a fonte única: o catálogo de códigos, o padrão de cada
   perfil (que REPRODUZ o comportamento anterior, para o deploy não mudar
   nada) e a regra de resolução do override por condomínio.

   Resolução (a MESMA no banco, em public.jwt_pode):
     1. diretor  → tudo. Regra anti-trava: o dono do condomínio nunca pode
        se fechar fora da própria tela de permissões.
     2. o condomínio tem linhas próprias para o perfil → valem SÓ elas
        (o override SUBSTITUI o padrão; desmarcar tira de verdade).
     3. senão → o padrão do SaaS (linhas com condominio_id nulo).
     4. matriz vazia (SQL não rodado) → degrada ABERTO no padrão abaixo.

   Módulo PURO de propósito (zero imports): roda no Node para as sondas de
   scripts/testar-permissoes.mjs e é importado tanto pela UI quanto por
   api/_lib/permissoes.js. */

/* ── Códigos ──
   grupo "tela"  = libera o item do menu (id igual ao do NAV);
   grupo "acao"  = libera uma operação sensível DENTRO da tela;
   grupo "base"  = coringa de escrita das tabelas sem mapeamento próprio.
   `fixo: true`  = não é delegável, nem aparece no editor (ver PERMISSOES_FIXAS). */
export const PERMISSOES = [
  /* telas — a ordem é a do menu */
  { codigo: "tela.dashboard",   grupo: "tela", tela: "dashboard",   rotulo: "Dashboard" },
  { codigo: "tela.condominio",  grupo: "tela", tela: "condominio",  rotulo: "Condomínio" },
  { codigo: "tela.unidades",    grupo: "tela", tela: "unidades",    rotulo: "Unidades" },
  { codigo: "tela.pessoas",     grupo: "tela", tela: "pessoas",     rotulo: "Pessoas" },
  { codigo: "tela.financeiro",  grupo: "tela", tela: "financeiro",  rotulo: "Financeiro" },
  { codigo: "tela.cobrancas",   grupo: "tela", tela: "cobrancas",   rotulo: "Cobranças QR" },
  { codigo: "tela.multas",      grupo: "tela", tela: "multas",      rotulo: "Multas" },
  { codigo: "tela.comunicados", grupo: "tela", tela: "comunicados", rotulo: "Comunicados" },
  { codigo: "tela.documentos",  grupo: "tela", tela: "documentos",  rotulo: "Documentos" },
  { codigo: "tela.chamados",    grupo: "tela", tela: "chamados",    rotulo: "Manutenção" },
  { codigo: "tela.portaria",    grupo: "tela", tela: "portaria",    rotulo: "Portaria" },
  { codigo: "tela.acessos",     grupo: "tela", tela: "emails",      rotulo: "Gerenciar Acessos" },
  { codigo: "tela.planos",      grupo: "tela", tela: "planos",      rotulo: "Planos e licença" },
  { codigo: "tela.portal",      grupo: "tela", tela: null,          rotulo: "Portal do morador" },

  /* ações sensíveis */
  { codigo: "condominio.editar",   grupo: "acao", rotulo: "Editar o cadastro do condomínio",
    ajuda: "Sem isto a tela Condomínio abre em somente leitura." },
  { codigo: "unidade.criar",       grupo: "acao", rotulo: "Criar unidades e editar área privativa",
    ajuda: "Trocar o responsável financeiro continua liberado para quem vê a tela." },
  { codigo: "financeiro.lancar",   grupo: "acao", rotulo: "Criar lançamentos de receita e despesa" },
  { codigo: "financeiro.aprovar",  grupo: "acao", rotulo: "Aprovar ou rejeitar lançamentos",
    ajuda: "Enforçado por gatilho no banco — esconder o botão não bastaria." },
  { codigo: "financeiro.baixar",   grupo: "acao", rotulo: "Dar baixa em pagamentos",
    ajuda: "Confirmação manual de pagamento e reconciliação." },
  { codigo: "cobranca.emitir",     grupo: "acao", rotulo: "Gerar e emitir cobranças" },
  { codigo: "cobranca.cancelar",   grupo: "acao", rotulo: "Cancelar cobrança indevida" },
  { codigo: "multa.registrar",     grupo: "acao", rotulo: "Registrar multas e advertências" },
  { codigo: "multa.aprovar",       grupo: "acao", rotulo: "Decidir multas após a defesa",
    ajuda: "Enforçado por gatilho no banco." },
  { codigo: "comunicado.publicar", grupo: "acao", rotulo: "Publicar comunicados e convocações" },
  { codigo: "documento.emitir",    grupo: "acao", rotulo: "Emitir documentos timbrados" },
  { codigo: "chamado.abrir",       grupo: "acao", rotulo: "Abrir chamado de manutenção" },
  { codigo: "pagamento.informar",  grupo: "acao", rotulo: "Informar pagamento com comprovante" },
  { codigo: "acesso.gerir",        grupo: "acao", rotulo: "Criar e remover acessos",
    ajuda: "Os perfis criáveis seguem limitados a síndico, tesouraria e morador." },
  { codigo: "licenca.gerir",       grupo: "acao", rotulo: "Contratar, trocar e cancelar a licença",
    ajuda: "Inclui o portal de cobrança da Stripe e o onboarding de recebimento." },
  { codigo: "alteracao.aprovar",   grupo: "acao", rotulo: "Aprovar as alterações do Administrador",
    ajuda: "Abre a tela Aprovações. O próprio Administrador nunca recebe esta permissão — ninguém aprova a si mesmo." },

  /* base + fixas */
  { codigo: "dados.escrever",   grupo: "base", rotulo: "Escrever nos dados do condomínio",
    ajuda: "Coringa das tabelas sem permissão própria (unidades, pessoas, portaria…). Desmarcar deixa o perfil em LEITURA quase total." },
  { codigo: "permissao.gerir",  grupo: "acao", fixo: true, rotulo: "Editar a matriz de permissões" },
  { codigo: "saas.gerir",       grupo: "acao", fixo: true, rotulo: "Administrar o SaaS (planos, assinaturas, clientes)" },
];

export const CODIGOS = PERMISSOES.map((p) => p.codigo);
const PORCODIGO = new Map(PERMISSOES.map((p) => [p.codigo, p]));
export const ehCodigo = (c) => PORCODIGO.has(String(c));
export const infoPermissao = (c) => PORCODIGO.get(String(c)) || null;

/* Não delegáveis: editar a matriz é o caminho mais curto para um perfil se
   promover a tudo, então fica cravado no diretor; saas.gerir é da
   administradora (dona da plataforma), fora de qualquer condomínio. */
export const PERMISSOES_FIXAS = PERMISSOES.filter((p) => p.fixo).map((p) => p.codigo);

/* Perfis que o editor mostra. Diretor não aparece (tem tudo por definição);
   administradora não pertence a condomínio nenhum.
   Os CARGOS criados na aba Gestão herdam o conjunto do NÍVEL escolhido —
   um cargo não é um perfil próprio no banco, é rótulo + nível. */
export const PERFIS_EDITAVEIS = ["administrador_predial", "sindico", "tesouraria", "morador"];
export const PERFIL_TUDO = "diretor";

/* Administrador predial: opera como o diretor, mas toda escrita dele é
   desviada para a fila de aprovação por um gatilho no banco
   (supabase-aprovacoes.sql). Estas permissões NUNCA podem ser dadas a ele —
   não por política, por mecânica: são ações que não passam por escrita
   direta em tabela (RPC SECURITY DEFINER ou endpoint com service role), ou
   seja, a fila não as alcança. Concedê-las faria a promessa "tudo é
   aprovado pelo diretor" virar mentira — e `acesso.gerir` é a pior delas:
   com ela o administrador criaria um síndico e entraria por fora. */
export const PERFIL_SOB_APROVACAO = "administrador_predial";
export const PERMS_VEDADAS_AO_ADMIN = [
  "financeiro.baixar",   // RPC registrar_pagamento_manual
  "cobranca.cancelar",   // RPC cancelar_cobranca
  "acesso.gerir",        // /api/auth/acessos (service role) — escalada
  "licenca.gerir",       // /api/stripe/* (service role)
  "alteracao.aprovar",   // ninguém aprova a si mesmo
];

/* ── Padrão do SaaS — ESPELHA o comportamento anterior à matriz ──
   Conferido contra NAV.roles (telas), supabase-rls.sql (escrita) e os
   gates do CondoMasterPro.jsx (somenteLeitura do Condomínio, podeCriar de
   Unidades, ehDiretor do Paywall). Mudar aqui muda o default de TODOS os
   condomínios que não têm override. */
export const MATRIZ_PADRAO = {
  /* diretor não é listado: PERFIL_TUDO responde por ele (anti-trava) */
  sindico: [
    "tela.dashboard", "tela.condominio", "tela.unidades", "tela.pessoas",
    "tela.financeiro", "tela.cobrancas", "tela.multas", "tela.comunicados",
    "tela.documentos", "tela.chamados", "tela.portaria",
    "dados.escrever", "financeiro.lancar", "financeiro.aprovar", "financeiro.baixar",
    "cobranca.emitir", "cobranca.cancelar", "multa.registrar", "multa.aprovar",
    "comunicado.publicar", "documento.emitir",
  ],
  tesouraria: [
    "tela.dashboard", "tela.unidades", "tela.financeiro", "tela.cobrancas", "tela.documentos",
    "dados.escrever", "financeiro.lancar", "financeiro.aprovar", "financeiro.baixar",
    "cobranca.emitir", "cobranca.cancelar", "documento.emitir",
  ],
  /* mesmas telas e escritas do diretor, menos o que a fila não alcança
     (ver PERMS_VEDADAS_AO_ADMIN) — espelha a view _padrao_administrador */
  administrador_predial: [
    "tela.dashboard", "tela.condominio", "tela.unidades", "tela.pessoas", "tela.financeiro",
    "tela.cobrancas", "tela.multas", "tela.comunicados", "tela.documentos", "tela.chamados",
    "tela.portaria", "tela.acessos",
    "condominio.editar", "unidade.criar", "financeiro.lancar", "financeiro.aprovar",
    "cobranca.emitir", "multa.registrar", "multa.aprovar", "comunicado.publicar",
    "documento.emitir", "chamado.abrir", "dados.escrever",
  ],
  morador: ["tela.portal", "chamado.abrir", "pagamento.informar"],
  administradora: ["saas.gerir"],
  /* conselho_fiscal, funcionario e prestador existem na tabela `perfis` mas
     não têm caminho de login (api/auth/login.js PERFIS) — sem linhas até
     ganharem entrada própria. */
};

/* ── Mapa tabela → permissão de escrita (espelho do SQL) ──
   O supabase-permissoes.sql recria a policy de escrita de cada tabela com
   condominio_id usando este mapa; tabela fora dele cai em dados.escrever.
   Mantido aqui para a sonda provar a PARIDADE entre JS e SQL — se os dois
   divergirem, a UI promete o que o banco não cumpre (ou o contrário). */
export const ESCRITA_PADRAO = "dados.escrever";
export const PERMISSAO_DA_TABELA = {
  lancamentos: "financeiro.lancar",
  cobrancas:   "cobranca.emitir",
  penalidades: "multa.registrar",
  comunicados: "comunicado.publicar",
  documentos:  "documento.emitir",
};
export const permissaoDaTabela = (t) => PERMISSAO_DA_TABELA[String(t)] || ESCRITA_PADRAO;

/* ── Resolução ── */
const comoSet = (x) => (x instanceof Set ? x : new Set(Array.isArray(x) ? x.map(String) : []));

/* Conjunto padrão de um perfil (sem override). Perfil desconhecido = vazio. */
export const permsPadrao = (perfil) =>
  String(perfil) === PERFIL_TUDO ? [...CODIGOS] : [...(MATRIZ_PADRAO[String(perfil)] || [])];

/* Conjunto EFETIVO: override do condomínio substitui o padrão; `null`/
   ausente (nunca `[]`) significa "sem override". Um override vazio é
   legítimo — é o perfil zerado — e por isso `[]` NÃO cai no padrão. */
export function permsEfetivas({ perfil, override = null }) {
  if (String(perfil) === PERFIL_TUDO) return [...CODIGOS];
  if (Array.isArray(override)) return override.filter(ehCodigo).map(String);
  return permsPadrao(perfil);
}

/* Teste de permissão. Aceita array ou Set. O diretor é resolvido antes, em
   permsEfetivas/jwt_pode — aqui só se consulta o conjunto já pronto. */
export const pode = (perms, codigo) => comoSet(perms).has(String(codigo));

/* Tela do NAV liberada? `tela` é o id do item (dashboard, emails, …). */
export function podeTela(perms, tela) {
  const p = PERMISSOES.find((x) => x.grupo === "tela" && x.tela === String(tela));
  return p ? pode(perms, p.codigo) : false;
}

/* Saneia o que vem do editor antes de gravar: só códigos do catálogo, sem
   duplicata, sem as fixas (permissao.gerir/saas.gerir não são delegáveis) e
   sem permissão de gestão para o morador — o chão das RPCs e das policies
   antigas continua exigindo perfil de gestão, então marcar isso para o
   morador prometeria um poder que o banco nega. */
export const PERMS_DO_MORADOR = ["tela.portal", "chamado.abrir", "pagamento.informar"];
export function sanearPerms(perfil, lista) {
  const p = String(perfil);
  const permitidas = p === "morador" ? PERMS_DO_MORADOR : CODIGOS;
  const fora = new Set(PERMISSOES_FIXAS);
  /* o administrador predial não recebe o que a fila de aprovação não
     alcança — nem que o diretor marque na tela */
  if (p === PERFIL_SOB_APROVACAO) for (const c of PERMS_VEDADAS_AO_ADMIN) fora.add(c);
  return [...new Set((Array.isArray(lista) ? lista : []).map(String))]
    .filter((c) => ehCodigo(c) && !fora.has(c) && permitidas.includes(c))
    .sort();
}

/* Dois conjuntos iguais? Usado para não gravar override igual ao padrão
   (linha inútil) e para o botão "Restaurar padrão" saber se há o que fazer. */
export const mesmoConjunto = (a, b) => {
  const x = comoSet(a), y = comoSet(b);
  return x.size === y.size && [...x].every((c) => y.has(c));
};
