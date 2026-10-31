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
export const rotuloTabela = (t) => TABELAS[String(t)]?.rotulo || String(t);

export const OPERACOES = { INSERT: "Criação", UPDATE: "Alteração", DELETE: "Exclusão" };
export const rotuloOperacao = (o) => OPERACOES[String(o)] || String(o);

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
export function diff(alteracao) {
  const { operacao, payload = {}, anterior } = alteracao || {};
  const iguais = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const campos = Object.keys(payload).filter((c) => !CAMPOS_OCULTOS.has(c));

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
  const o = rotuloOperacao(alteracao?.operacao);
  const nome = alteracao?.resumo;
  return nome ? `${o} de ${t}: ${nome}` : `${o} de ${t}`;
}

/* Ordem de aplicação: mais antiga primeiro, para a mãe ser aprovada antes
   da filha. `pendentes` filtra o que ainda está em aberto. */
export const ordenar = (lista) =>
  [...(lista || [])].sort((a, b) =>
    String(a.solicitado_em || "").localeCompare(String(b.solicitado_em || "")));
export const pendentes = (lista) => ordenar(lista).filter((a) => a.status === "pendente");

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
