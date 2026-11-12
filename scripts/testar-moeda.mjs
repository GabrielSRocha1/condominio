/* Sondas da MOEDA no campo de dinheiro (src/lib/moeda.js) — puras, sem app.

   Nasceram de um bug de produção (12/11/2026): o MoneyInput digitava sempre em
   centésimos, então em guarani — moeda sem centavos — digitar "5" virava
   Gs. 0,05, que o Intl arredonda para "Gs. 0". O campo parecia travado no
   zero, e quem insistisse submetia CEM VEZES MENOS do que digitou.

   O bloco F reproduz o campo inteiro (dígitos → tela → valor submetido) nas
   duas famílias de moeda, que é a prova que faltava.

   Uso: node scripts/testar-moeda.mjs */
import { readFileSync } from "node:fs";
import { casasDecimais, escalaMoeda, paraCampo } from "../src/lib/moeda.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const arq = (nome) => readFileSync(new URL(`../${nome}`, import.meta.url), "utf8");

/* as 32 moedas que a tela oferece (MOEDAS do CondoMasterPro.jsx) */
const OFERECIDAS = ["USD", "BRL", "EUR", "GBP", "MXN", "CAD", "CHF", "JPY", "AUD", "NZD",
  "SGD", "HKD", "MYR", "THB", "AED", "DKK", "SEK", "NOK", "PLN", "CZK", "HUF", "RON", "BGN",
  "ARS", "PYG", "BOB", "CLP", "COP", "CRC", "GTQ", "PEN", "UYU"];
const SEM_CENTAVOS = ["JPY", "HUF", "PYG", "CLP", "COP"];

console.log("━━ M · casas decimais por moeda ━━");

ok("M1 as cinco moedas sem centavos do catálogo são reconhecidas",
  SEM_CENTAVOS.every((m) => casasDecimais(m) === 0), SEM_CENTAVOS.join(", "));
ok("M2 todas as outras do catálogo têm centavos",
  OFERECIDAS.filter((m) => !SEM_CENTAVOS.includes(m)).every((m) => casasDecimais(m) === 2));
ok("M3 nenhuma moeda do catálogo fica sem resposta",
  OFERECIDAS.every((m) => Number.isInteger(casasDecimais(m))));
ok("M4 escala é 1 onde não há centavos e 100 onde há",
  escalaMoeda("PYG") === 1 && escalaMoeda("BRL") === 100 && escalaMoeda("USD") === 100);
ok("M5 moeda inválida ou ausente não quebra o campo (cai em 2 casas)",
  casasDecimais("XYZ") === 2 && casasDecimais(null) === 2
  && casasDecimais(undefined) === 2 && casasDecimais("") === 2);

console.log("\n━━ P · texto submetido ao formulário ━━");

ok("P1 com centavos: 8650 unidades viram \"86,50\"", paraCampo(8650, "BRL") === "86,50");
ok("P2 SEM centavos: 20000 unidades viram \"20000\" (e não \"200,00\")",
  paraCampo(20000, "PYG") === "20000", paraCampo(20000, "PYG"));
ok("P3 vazio continua vazio (campo opcional = sem taxa)",
  paraCampo(null, "BRL") === "" && paraCampo(undefined, "PYG") === ""
  && paraCampo(NaN, "BRL") === "");
ok("P4 zero é um valor, não vazio", paraCampo(0, "BRL") === "0,00" && paraCampo(0, "PYG") === "0");

console.log("\n━━ F · o campo de ponta a ponta (dígitos → tela → submetido) ━━");

/* reprodução fiel do MoneyInput: digitar acumula na MENOR unidade */
const parseBRL = (s) => Number(String(s || "0").replace(/[R$\s.]/g, "").replace(",", ".")) || 0;
const campo = (digitos, moeda) => {
  const esc = escalaMoeda(moeda);
  const un = digitos ? parseInt(digitos, 10) : null;
  return {
    tela: un == null ? "" : (un / esc).toLocaleString("en-US", { style: "currency", currency: moeda }),
    valor: parseBRL(paraCampo(un, moeda)),
  };
};

{
  /* o caso do bug: guarani */
  const g = campo("5", "PYG");
  ok("F1 guarani: digitar 5 vale Gs. 5 (antes virava Gs. 0)", g.valor === 5, g.tela);
  const g2 = campo("20000", "PYG");
  ok("F2 guarani: digitar 20000 submete 20000 (antes submetia 200)", g2.valor === 20000, g2.tela);
  /* e a família com centavos segue como sempre */
  const r = campo("8650", "BRL");
  ok("F3 real: digitar 8650 segue valendo 86,50", r.valor === 86.5, r.tela);
  const u = campo("5", "USD");
  ok("F4 dólar: digitar 5 segue valendo 0,05", u.valor === 0.05, u.tela);
  ok("F5 campo vazio vale 0 (sem taxa)", campo("", "PYG").valor === 0);
}

console.log("\n━━ S · paridade com a tela ━━");
{
  const jsx = arq("CondoMasterPro.jsx");
  /* só o corpo do MoneyInput: o AreaInput (m²) divide por 100 com razão —
     metro quadrado tem duas casas sempre, não é moeda */
  const corpo = jsx.slice(jsx.indexOf("function MoneyInput("), jsx.indexOf("function AreaInput("));
  ok("S1 MoneyInput usa a escala da moeda, não 100 fixo",
    /const casas = casasDecimais\(moeda\), esc = 10 \*\* casas/.test(corpo)
    && !/\/ 100/.test(corpo), corpo ? "" : "corpo não encontrado");
  ok("S2 o valor submetido sai por paraCampo", /name={name} value={paraCampo\(un, moeda\)}/.test(jsx));
  ok("S3 nenhum chamador multiplica por 100 (defaultValor é o valor real)",
    !/defaultCents/.test(jsx) && /defaultValor=/.test(jsx));
  ok("S4 todos os campos de dinheiro passam pelo MoneyInput",
    (jsx.match(/<MoneyInput/g) || []).length >= 4);
}

console.log(`\n${falhas ? "❌" : "✅"} moeda: ${falhas} falha(s)`);
process.exitCode = falhas ? 1 : 0;
