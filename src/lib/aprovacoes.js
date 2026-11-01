/* FILA DE APROVAÇÃO do administrador predial — regras de leitura.

   O desvio das escritas é feito no BANCO (supabase-aprovacoes.sql): o
   gatilho cancela a operação do administrador e guarda a linha proposta em
   `alteracoes_pendentes`. Este módulo é só a camada de LEITURA: traduz a
   linha crua em algo que o diretor entenda — o que é, o que muda, e em que
   ordem aplicar.

   Módulo PURO (zero imports): sondável no Node, usado pela UI.

   A ORDEM importa: uma ação do app vira várias linhas na fila (criar pessoa
   = pessoa + vínculo + responsável da unidade). Aprovar fora de ordem faz a
   filha bater em chave estrangeira — o banco mantém a alteração pendente
   com o erro à vista, mas é desconforto evitável. Por isso a fila é sempre
   apresentada da MAIS ANTIGA para a mais nova. */

export const TABELAS = {
  condominios:              { rotulo: "Dados do condomínio", tela: "condominio" },
  blocos:                   { rotulo: "Bloco",               tela: "unidades" },
  unidades:                 { rotulo: "Unidade",             tela: "unidades" },
  vagas:                    { rotulo: "Vaga",                tela: "unidades" },
  pessoas:                  { rotulo: "Pessoa",              tela: "pessoas" },
  pessoa_vinculos:          { rotulo: "Vínculo da pessoa",   tela: "pessoas" },
  categorias_financeiras:   { rotulo: "Categoria financeira", tela: "financeiro" },
  fundos:                   { rotulo: "Fundo",               tela: "financeiro" },
  lancamentos:              { rotulo: "Lançamento",          tela: "financeiro" },
  cobrancas:                { rotulo: "Cobrança",            tela: "cobrancas" },
  penalidades:              { rotulo: "Multa / advertência", tela: "multas" },
  penalidade_provas:        { rotulo: "Prova da multa",      tela: "multas" },
  comunicados:              { rotulo: "Comunicado",          tela: "comunicados" },
  comunicado_destinatarios: { rotulo: "Destinatário do comunicado", tela: "comunicados" },
  documentos:               { rotulo: "Documento",           tela: "documentos" },
  chamados:                 { rotulo: "Chamado",             tela: "chamados" },
  planilhas_cobranca:       { rotulo: "Planilha de cobranças", tela: "cobrancas" },
  planilha_cobranca_linhas: { rotulo: "Linha da planilha",   tela: "cobrancas" },
};
/* `tabela` carrega a tabela OU o código da ação — o rótulo cobre os dois */
export const rotuloTabela = (t) =>
  TABELAS[String(t)]?.rotulo || ACOES[String(t)]?.rotulo || String(t);
export const telaDe = (t) =>
  TABELAS[String(t)]?.tela || ACOES[String(t)]?.tela || null;

export const OPERACOES = { INSERT: "Criação", UPDATE: "Alteração", DELETE: "Exclusão", ACAO: "Ação" };
export const rotuloOperacao = (o) => OPERACOES[String(o)] || String(o);

/* ─────────────────────────────────────────────────────────────────
   QUEM OPERA SOB APROVAÇÃO — espelho de perfis_sob_aprovacao() no SQL.
   O síndico entrou junto com o administrador predial: ele opera o dia a
   dia e o diretor confirma. A sonda compara esta lista com a do banco.
   ───────────────────────────────────────────────────────────────── */
export const PERFIS_SOB_APROVACAO = ["administrador_predial", "sindico"];
export const ehPerfilSobAprovacao = (p) => PERFIS_SOB_APROVACAO.includes(String(p));

/* ─────────────────────────────────────────────────────────────────
   AÇÕES (operacao = 'ACAO')

   Baixar pagamento, cancelar cobrança e rejeitar pagamento informado não
   são uma escrita só — cada uma mexe em pagamentos, cobranças, lançamentos
   e fundos dentro de uma RPC. Por isso a ação INTEIRA vira uma pendência,
   com os argumentos no payload, e o diretor executa o corpo real ao
   aprovar. `tabela` carrega o código da ação.
   ───────────────────────────────────────────────────────────────── */
export const ACOES = {
  "financeiro.baixar":  { rotulo: "Baixa de pagamento",            tela: "cobrancas" },
  "cobranca.cancelar":  { rotulo: "Cancelamento de cobrança",      tela: "cobrancas" },
  "pagamento.rejeitar": { rotulo: "Rejeição de pagamento informado", tela: "cobrancas" },
};
export const ehAcao = (a) => String(a?.operacao) === "ACAO";

/* ─────────────────────────────────────────────────────────────────
   O QUE NÃO ESPERA O DIRETOR

   ESPELHO do filtro de supabase-aprovacoes.sql — quem manda é o gatilho
   (o app não tem como se impor: a escrita sai do navegador com o JWT do
   usuário). Isto aqui existe para o app SABER de antemão se a ação vai
   valer na hora, e assim dizer a coisa certa na tela e refazer as contas
   derivadas. Mudar um exige mudar o outro; a sonda compara os dois.

   Só CRIAÇÃO entra aqui. Alterar e excluir esperam sempre, em qualquer
   tabela: o risco não está no cadastro novo, está no que muda de valor
   ou some. `blocos` acompanha `unidades` por mecânica — criar unidade
   cria o bloco junto, e um bloco na fila deixaria a unidade apontando
   para uma linha inexistente; `pessoa_vinculos` acompanha `pessoas`
   pelo mesmo motivo.

   `cobrancas` está aqui mas NÃO é livre: o gatilho força status
   'rascunho' na criação, e rascunho é invisível para o morador. O que
   solta a cobrança é o diretor emitir — um UPDATE, que continua na fila.
   Quem define o RESPONSÁVEL FINANCEIRO da unidade (quem paga) também
   continua esperando: é UPDATE em `unidades`.
   ───────────────────────────────────────────────────────────────── */
export const IMEDIATAS = {
  INSERT: ["blocos", "unidades", "pessoas", "pessoa_vinculos", "cobrancas"],
};

/* Criada pelo administrador, a cobrança nasce assim — o diretor emite depois. */
export const COBRANCA_NASCE = "rascunho";

export const exigeAprovacao = (tabela, operacao = "INSERT") =>
  !(IMEDIATAS[String(operacao)] || []).includes(String(tabela));

/* Campos que não interessam ao diretor: ruído de infraestrutura que ele não
   decide e que polui o diff (todo UPDATE mexe em atualizado_em). */
export const CAMPOS_OCULTOS = new Set([
  "id", "condominio_id", "criado_em", "atualizado_em",
]);

/* Rótulo humano de um campo — sem dicionário gigante: troca _ por espaço,
   tira sufixo _id e capitaliza. Casos que valem nome próprio ficam no mapa. */
const NOMES = {
  nome_fantasia: "Nome", razao_social: "Razão social", cpf_cnpj: "Documento",
  valor_original: "Valor", competencia: "Competência", vencimento: "Vencimento",
  descricao: "Descrição", observacao: "Observação", titulo: "Título",
  regras_internas: "Regras internas", encargos_atraso: "Encargos de atraso",
  area_privativa: "Área privativa", fracao_ideal: "Fração ideal",
  /* argumentos das AÇÕES */
  pago_em: "Pago em", forma: "Forma de pagamento", tx: "Comprovante / tx",
  justificativa: "Justificativa", motivo: "Motivo",
};
export function rotuloCampo(campo) {
  const c = String(campo);
  if (NOMES[c]) return NOMES[c];
  const base = c.replace(/_id$/, "").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/* Valor em texto curto para a tabela do diff. jsonb vira JSON compacto;
   null vira travessão (e não "null", que ninguém entende). */
export function valorTexto(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* O DIFF: o que de fato muda.
   · INSERT → todo campo preenchido (não há "antes");
   · UPDATE → só os campos cujo valor difere do anterior;
   · DELETE → o que deixa de existir.
   Comparação por JSON para que jsonb e número cheguem iguais vindos do
   banco (1 e "1" não são o mesmo, e é isso que queremos mostrar). */
/* Identificadores que a AÇÃO carrega para saber em quem mexer: não são
   decisão do diretor e viram uuid cru na tela. A cobrança em questão
   aparece resolvida (unidade + competência) a partir de `alvo_id`. */
export const ARGS_OCULTOS = new Set(["cobranca_id", "informado_id"]);

export function diff(alteracao) {
  const { operacao, payload = {}, anterior } = alteracao || {};
  const iguais = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const campos = Object.keys(payload).filter((c) => !CAMPOS_OCULTOS.has(c));

  /* AÇÃO: o payload são os argumentos da RPC — não há "antes", e o que
     interessa ao diretor é o valor, a forma e a justificativa */
  if (operacao === "ACAO")
    return Object.keys(payload)
      .filter((c) => !CAMPOS_OCULTOS.has(c) && !ARGS_OCULTOS.has(c))
      .filter((c) => payload[c] !== null && payload[c] !== "")
      .map((c) => ({ campo: c, de: null, para: payload[c] }));

  if (operacao === "INSERT")
    return campos
      .filter((c) => payload[c] !== null && payload[c] !== "")
      .map((c) => ({ campo: c, de: null, para: payload[c] }));

  if (operacao === "DELETE")
    return Object.keys(anterior || payload)
      .filter((c) => !CAMPOS_OCULTOS.has(c))
      .filter((c) => (anterior || payload)[c] !== null && (anterior || payload)[c] !== "")
      .map((c) => ({ campo: c, de: (anterior || payload)[c], para: null }));

  return campos
    .filter((c) => !iguais(payload[c], (anterior || {})[c]))
    .map((c) => ({ campo: c, de: (anterior || {})[c], para: payload[c] }));
}

/* Resumo de uma linha da fila para a lista. */
export function resumir(alteracao) {
  const t = rotuloTabela(alteracao?.tabela);
  const nome = alteracao?.resumo;
  /* ação já é um verbo ("Baixa de pagamento"): prefixar "Ação de" só
     atrapalharia a leitura da lista */
  if (ehAcao(alteracao)) return nome ? `${t}: ${nome}` : t;
  const o = rotuloOperacao(alteracao?.operacao);
  return nome ? `${o} de ${t}: ${nome}` : `${o} de ${t}`;
}

/* Ordem de aplicação: mais antiga primeiro, para a mãe ser aprovada antes
   da filha. `pendentes` filtra o que ainda está em aberto. */
export const ordenar = (lista) =>
  [...(lista || [])].sort((a, b) =>
    String(a.solicitado_em || "").localeCompare(String(b.solicitado_em || "")));
export const pendentes = (lista) => ordenar(lista).filter((a) => a.status === "pendente");

/* ─────────────────────────────────────────────────────────────────
   AGRUPAMENTO — uma AÇÃO por cartão, não uma LINHA por cartão.

   "Cadastrar a Danielle" é uma frase só para quem clicou, mas chega aqui
   como três linhas (pessoa + vínculo + responsável da unidade). Mostrá-las
   soltas obriga o diretor a remontar de cabeça o que foi feito — e a
   aprovar na ordem certa, senão a chave estrangeira recusa.

   O que liga mãe e filha é concreto, não heurística de tempo: o app gera o
   id da mãe no cliente (idDaFila em api.js) justamente porque o insert
   desviado não devolve linha. Então a filha JÁ carrega, no payload, o id
   que a mãe propõe. É esse vínculo que remonta a ação.
   ───────────────────────────────────────────────────────────────── */
const TETO_ANINHAMENTO = 10; // mãe→filha→neta; um ciclo nunca acontece, mas não trava

export function agrupar(lista) {
  const linhas = ordenar(lista);

  /* id proposto por cada INSERT pendente → a linha que o propõe */
  const donoDoId = new Map();
  for (const a of linhas) {
    const id = a?.payload?.id;
    if (a?.operacao === "INSERT" && id) donoDoId.set(String(id), a);
  }

  /* uma linha é filha da PRIMEIRA mãe pendente que ela referencia */
  const paiDe = new Map();
  for (const a of linhas) {
    for (const [campo, v] of Object.entries(a?.payload || {})) {
      if (campo === "id" || typeof v !== "string") continue;
      const pai = donoDoId.get(v);
      if (pai && pai !== a) { paiDe.set(a, pai); break; }
    }
  }
  const raizDe = (a) => {
    let r = a;
    for (let i = 0; i < TETO_ANINHAMENTO && paiDe.has(r); i++) r = paiDe.get(r);
    return r;
  };

  const porRaiz = new Map();
  for (const a of linhas) {
    const r = raizDe(a);
    if (!porRaiz.has(r)) porRaiz.set(r, []);
    if (a !== r) porRaiz.get(r).push(a);
  }

  /* duas tentativas do mesmo cadastro propõem conteúdo idêntico — entre um
     clique e o seguinte só mudam os ids gerados no cliente e os carimbos.
     Trocando esses ids por posições, as duas viram a MESMA chave. */
  const chaveDoGrupo = (itens) => {
    const posicao = new Map();
    for (const a of itens) {
      const id = a?.payload?.id;
      if (a?.operacao === "INSERT" && id) posicao.set(String(id), `#${posicao.size}`);
    }
    const semId = (v) => (typeof v === "string" && posicao.has(v) ? posicao.get(v) : v);
    return JSON.stringify(itens.map((a) => [
      a?.tabela, a?.operacao, a?.alvo_id ?? null,
      Object.entries(a?.payload || {})
        .filter(([c]) => !CAMPOS_OCULTOS.has(c))
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([c, v]) => [c, semId(v)]),
    ]));
  };

  const vistas = new Map(); // chave → primeiro grupo que a usou
  return [...porRaiz.entries()].map(([principal, filhas]) => {
    const itens = [principal, ...filhas];
    const chave = chaveDoGrupo(itens);
    const antes = vistas.get(chave) || null;
    if (!antes) vistas.set(chave, principal);
    return {
      id: principal.id,          // o cartão é identificado pela mãe
      principal, itens, chave,
      repetida: !!antes,         // mesmo conteúdo de uma pendência anterior
      repeteDe: antes ? antes.solicitado_em : null,
      /* "parcial" é um estado real: a mãe foi aplicada e a filha falhou na
         chave estrangeira, por exemplo. Esconder isso atrás do status da
         mãe diria que a ação inteira passou. */
      status: itens.every((a) => a.status === principal.status) ? principal.status : "parcial",
      solicitante: principal.solicitante,
      solicitado_em: principal.solicitado_em,
      erro: itens.find((a) => a.erro)?.erro || null,
    };
  });
}

export const pendentesAgrupados = (lista) =>
  agrupar(pendentes(lista));

/* Legenda do cartão quando a ação rendeu mais de uma linha: diz o que vem
   junto, para o diretor não precisar abrir para descobrir. */
export function resumirGrupo(grupo) {
  const extras = (grupo?.itens || []).slice(1);
  if (!extras.length) return "";
  const nomes = [...new Set(extras.map((a) => rotuloTabela(a.tabela)))];
  return `+ ${nomes.join(" · ")}`;
}

/* Campos realmente em jogo no grupo inteiro — é o número que o cartão mostra. */
export const camposDoGrupo = (grupo) =>
  (grupo?.itens || []).reduce((s, a) => s + diff(a).length, 0);

/* Correção do diretor: só os campos que ele realmente mexeu, e nunca um
   campo oculto (id/condominio_id não se corrige à mão na tela). Devolve
   null quando não há correção — assim a RPC grava `corrigida: false`. */
export function correcaoLimpa(original = {}, editado = {}) {
  const fora = CAMPOS_OCULTOS;
  const saida = {};
  for (const [c, v] of Object.entries(editado || {})) {
    if (fora.has(c)) continue;
    if (JSON.stringify(v ?? null) === JSON.stringify(original[c] ?? null)) continue;
    saida[c] = v;
  }
  return Object.keys(saida).length ? saida : null;
}
