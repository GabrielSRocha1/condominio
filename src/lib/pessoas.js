/* Regras PURAS do cadastro de pessoas — zero imports, sondáveis no Node
   (scripts/testar-pessoas-doc.mjs). O documento (CI/RUC/CPF) é a identidade
   civil do cadastro: o unique pessoas(condominio_id, cpf_cnpj) garante UM
   cadastro por pessoa, e estas regras são o que permite à tela tratar
   "mesmo documento" como "mesma pessoa com mais um apartamento" em vez de
   estourar o erro cru do banco. */

/* chave de comparação: "848.004-4", "848004-4 " e "848004-4" são o MESMO
   CI — caixa, espaços e pontos fora; o traço FICA (é o dígito verificador
   nos documentos paraguaios). Mesmo critério do docKey da importação. */
export const chaveDoc = (s) => String(s ?? "").toLowerCase().replace(/[\s.]/g, "");

/* acha OUTRA pessoa (≠ ignorarId) com o mesmo documento. Aceita tanto as
   pessoas da tela (db.pessoas, campo docRaw) quanto linhas cruas do banco
   (campo cpf_cnpj). Documento vazio não casa com nada. */
export function pessoaComMesmoDoc(pessoas, doc, ignorarId = null) {
  const alvo = chaveDoc(doc);
  if (!alvo) return null;
  return (pessoas || []).find((p) => p.id !== ignorarId
    && chaveDoc(p.docRaw ?? p.cpf_cnpj) === alvo) || null;
}

/* fusão de cadastros: o DESTINO manda — do formulário só entra o que o
   destino tem VAZIO. Devolve apenas as colunas a atualizar (objeto vazio =
   nada a fazer). */
export function camposQueFaltam(destino, form) {
  const out = {};
  for (const k of ["telefone", "email", "documento_url"]) {
    if (!destino?.[k] && form?.[k]) out[k] = form[k];
  }
  return out;
}
