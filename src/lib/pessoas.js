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

/* documento provisório: "P-…" (responsável criado pela planilha/acessos) e
   "M-…" (morador provisório) — cadastros que ainda esperam o documento real */
export const docProvisorio = (d) => /^[MP]-/i.test(String(d ?? ""));

const chaveNome = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

/* Plano de fusão dos cadastros duplicados que o reparo da planilha deixou:
   o dono de VÁRIOS apartamentos virou várias pessoas de mesmo nome, uma com
   o documento real e as demais presas no provisório ("doc já usado").
   Regras: mesmo nome + no máximo UM documento real → funde os provisórios
   nele (ou no mais antigo, se todos provisórios). Mesmo nome com DOIS
   documentos reais pode ser gente diferente — não decide, reporta.
   Entrada: [{ id, nome, doc, criadoEm }]; saída: { fusoes: [{ destino,
   origens }], ambiguas: [[ids]] }. Pura — quem grava é o chamador. */
export function planoDeDuplicados(pessoas) {
  const grupos = new Map();
  for (const p of pessoas || []) {
    const k = chaveNome(p.nome);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const fusoes = [], ambiguas = [];
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const ordem = [...g].sort((a, b) => String(a.criadoEm ?? "").localeCompare(String(b.criadoEm ?? "")));
    const reais = ordem.filter((p) => !docProvisorio(p.doc));
    if (reais.length > 1) { ambiguas.push(ordem.map((p) => p.id)); continue; }
    const destino = reais[0] || ordem[0];
    fusoes.push({ destino: destino.id, origens: ordem.filter((p) => p.id !== destino.id).map((p) => p.id) });
  }
  return { fusoes, ambiguas };
}
