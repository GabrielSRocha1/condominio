/* BUSCA DOS DROPDOWNS LONGOS — a regra, sem React.

   Um condomínio com 90 apartamentos vira uma lista de 90 linhas: achar
   "Apartamento 3-D" rolando é trabalho. Acima de LISTA_LONGA opções o campo
   passa a filtrar enquanto se digita; abaixo disso continua `<select>`
   nativo, que no celular abre o seletor do sistema e é melhor assim.

   O que se digita casa contra o RÓTULO inteiro — e o rótulo das unidades já
   carrega número, letra, bloco, tipo e o nome do responsável
   ("Apartamento 3-D · Deise"), então uma busca por substring resolve os
   quatro casos de uma vez, sem a tela precisar saber o que é uma unidade.

   Módulo PURO (zero imports): sondável no Node, usado pela UI. */

/* acima disto, o campo vira busca. 8 ≈ o que cabe sem rolar a lista */
export const LISTA_LONGA = 8;

/* "Apartamento 3-D · Deise" e "apartamento 3-d · deise" são a mesma coisa
   para quem procura — e ninguém digita acento no meio de uma busca */
export const semAcento = (s) => String(s ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* `opcoes` é [[valor, rotulo], …] — a mesma forma do <option value>…</option>.
   Busca vazia devolve a lista inteira (o campo recém-aberto mostra tudo).
   Os termos são TODOS exigidos, em qualquer ordem: "3 deise" acha
   "Apartamento 3-D · Deise" mesmo com o separador no meio. */
export function filtrarOpcoes(opcoes, q, rotulo = (l) => l) {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return [...(opcoes || [])];
  return (opcoes || []).filter(([, l]) => {
    const alvo = semAcento(rotulo(l));
    return termos.every((termo) => alvo.includes(termo));
  });
}

/* a lista é longa o bastante para pagar o campo de busca? */
export const ehListaLonga = (n) => Number(n) > LISTA_LONGA;

/* FILTRO DA LISTA DE COBRANÇAS — prefixo por PALAVRA, não substring.

   Substring no alvo inteiro fazia "1-a" achar TODAS as unidades: a chave
   antiga ("801-A", "1201-A") termina em "…1-A", então toda linha casava.
   A regra aqui é a que a pessoa espera do que escreveu: cada termo digitado
   precisa ser o COMEÇO de alguma palavra do alvo — "1" acha 1-A, 10-A e
   12-A; "1-a" acha só a 1-A; "12-a" só a 12-A; "801" continua achando a
   chave antiga decorada; "dei" acha "Deise". Termos em qualquer ordem,
   todos exigidos, sem acento e sem caixa — como em filtrarOpcoes. */
export function casaPorPrefixo(alvo, q) {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return true;
  const palavras = semAcento(alvo).split(/\s+/).filter(Boolean);
  return termos.every((termo) => palavras.some((p) => p.startsWith(termo)));
}
