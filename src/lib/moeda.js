/* MOEDA — quantas casas decimais ela tem, e qual é a menor unidade em que o
   campo de dinheiro digita.

   Existe por causa de um bug real (12/11/2026): o MoneyInput assumia que TODA
   moeda tem centavos e digitava em centésimos. Em guarani — que não tem
   centavos — digitar "5" virava Gs. 0,05, que o Intl arredonda para "Gs. 0":
   o campo parecia travado no zero. Pior que a aparência: quem insistisse e
   digitasse 20000 submetia Gs. 200, cem vezes menos.

   Entre as 32 moedas que o app oferece, cinco não têm centavos — JPY, HUF,
   PYG, CLP e COP. A resposta vem do próprio Intl em vez de uma lista à mão:
   lista é coisa que envelhece, e o navegador já carrega a tabela ISO.

   Nota sobre o HUF: a lista zero-decimal da Stripe (ZERO_DECIMAIS em
   api/stripe/_lib/comum.js) NÃO inclui o forint, porque a Stripe o cobra em
   unidades menores. As duas respostas estão certas em camadas diferentes —
   aqui é quanto a PESSOA digita (na Hungria o preço é "1 234 Ft", sem
   fillér); lá é como a Stripe recebe. O banco guarda o número decimal, não
   unidades menores, então as duas não se encontram.

   Módulo PURO (zero imports), sondável no Node: scripts/testar-moeda.mjs. */

export function casasDecimais(moeda) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: String(moeda || "USD") })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    return 2; // moeda fora do ISO: trata como as comuns, em vez de quebrar o campo
  }
}

/* Em quantas partes a unidade se divide: 100 onde há centavos, 1 onde não há.
   É por este número que o campo multiplica e divide — nunca por 100 fixo. */
export const escalaMoeda = (moeda) => 10 ** casasDecimais(moeda);

/* Valor digitado (na menor unidade) → o texto que vai no formulário, no
   formato que o parseBRL da camada de dados entende ("86,50", "20000"). */
export const paraCampo = (unidades, moeda) => {
  if (unidades == null || !Number.isFinite(unidades)) return "";
  const casas = casasDecimais(moeda);
  return (unidades / 10 ** casas).toFixed(casas).replace(".", ",");
};
