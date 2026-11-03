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
