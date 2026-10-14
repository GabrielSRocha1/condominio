/* Sonda da EXPANSÃO de unidades em lote (src/lib/unidades.js) — pura, sem
   app nem banco.

   Cobre a regressão do comportamento SEM letra (que não muda em nada) e as
   regras novas COM letra: andar espelhando o número quando o andar não é
   informado, e UMA unidade por andar (pareamento) quando há intervalo de
   andares — com erro claro quando as faixas têm quantidades diferentes.

   Uso: node scripts/testar-unidades-lote.mjs */
import { expandirUnidades } from "../src/lib/unidades.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const igual = (f, esperado) => {
  const r = expandirUnidades(f);
  const bate = JSON.stringify(r) === JSON.stringify(esperado);
  return [bate, bate ? `${r.length} unidade(s)` : `obtido ${JSON.stringify(r)}`];
};
const erra = (f, trecho) => {
  try { expandirUnidades(f); return [false, "não lançou erro"]; }
  catch (e) { return [String(e.message).includes(trecho), e.message]; }
};
const u = (numero, andar) => ({ numero, andar });

/* ══ R · regressão SEM letra (comportamento de sempre, intocado) ══ */
console.log("━━ R · sem letra (nada muda) ━━");
ok("R1 intervalo simples sem andar", ...igual({ numero: "1", numeroAte: "3" },
  [u("1", null), u("2", null), u("3", null)]));
ok("R2 produto andar × sequência (1–3 com andares 1–3 = 9 unidades)", ...igual(
  { numero: "1", numeroAte: "3", andar: "1", andarAte: "3" },
  [u("101", 1), u("102", 1), u("103", 1), u("201", 2), u("202", 2), u("203", 2), u("301", 3), u("302", 3), u("303", 3)]));
ok("R3 zeros à esquerda preservados (01–04 com andares 1–2)", ...igual(
  { numero: "01", numeroAte: "04", andar: "1", andarAte: "2" },
  [u("101", 1), u("102", 1), u("103", 1), u("104", 1), u("201", 2), u("202", 2), u("203", 2), u("204", 2)]));
ok("R4 andares altos (1–4 com andares 9–11)", ...igual(
  { numero: "1", numeroAte: "4", andar: "9", andarAte: "11" },
  [u("901", 9), u("902", 9), u("903", 9), u("904", 9), u("1001", 10), u("1002", 10), u("1003", 10), u("1004", 10), u("1101", 11), u("1102", 11), u("1103", 11), u("1104", 11)]));
ok("R5 térreo (andar 0) mantém o formato", ...igual(
  { numero: "1", numeroAte: "2", andar: "0", andarAte: "1" },
  [u("001", 0), u("002", 0), u("101", 1), u("102", 1)]));
ok("R6 número avulso sem letra e sem andar segue cru", ...igual({ numero: "LJ" }, [u("LJ", null)]));
ok("R7 andar único informado vale para todos", ...igual(
  { numero: "1", numeroAte: "2", andar: "5" }, [u("1", 5), u("2", 5)]));

/* ══ L · letra: andar espelha o número ══ */
console.log("\n━━ L · letra sem andar (espelho) ━━");
ok("L1 1A até 3A sem andar → 1A/1, 2A/2, 3A/3", ...igual(
  { numero: "1A", numeroAte: "3A" }, [u("1A", 1), u("2A", 2), u("3A", 3)]));
ok("L2 unidade única 12A sem andar → andar 12", ...igual({ numero: "12A" }, [u("12A", 12)]));
ok("L3 prefixo A1 até A3 sem andar → A1/1, A2/2, A3/3", ...igual(
  { numero: "A1", numeroAte: "A3" }, [u("A1", 1), u("A2", 2), u("A3", 3)]));
ok("L4 com andar ÚNICO informado, respeita (todos no 5)", ...igual(
  { numero: "1A", numeroAte: "3A", andar: "5" }, [u("1A", 5), u("2A", 5), u("3A", 5)]));

/* ══ P · letra + intervalo de andares: um por andar (pareado) ══ */
console.log("\n━━ P · letra com andares (um por andar) ━━");
ok("P1 1A–3A com andares 1–3 → 101A/1, 202A/2, 303A/3", ...igual(
  { numero: "1A", numeroAte: "3A", andar: "1", andarAte: "3" },
  [u("101A", 1), u("202A", 2), u("303A", 3)]));
ok("P2 prefixo A1–A3 com andares 1–3 → A101/1, A202/2, A303/3", ...igual(
  { numero: "A1", numeroAte: "A3", andar: "1", andarAte: "3" },
  [u("A101", 1), u("A202", 2), u("A303", 3)]));
ok("P3 número ÚNICO 1A com andares 1–3 replica por andar (101A/1, 201A/2, 301A/3)", ...igual(
  { numero: "1A", andar: "1", andarAte: "3" },
  [u("101A", 1), u("201A", 2), u("301A", 3)]));
ok("P4 faixas que não começam juntas (5A–7A com andares 1–3) pareiam na ordem", ...igual(
  { numero: "5A", numeroAte: "7A", andar: "1", andarAte: "3" },
  [u("105A", 1), u("206A", 2), u("307A", 3)]));

/* ══ E · erros ══ */
console.log("\n━━ E · validações ━━");
ok("E1 letra com quantidades diferentes (1A–5A vs andares 1–3) → erro claro",
  ...erra({ numero: "1A", numeroAte: "5A", andar: "1", andarAte: "3" }, "mesma quantidade"));
ok("E2 letras diferentes no intervalo (1A até 3B) → erro",
  ...erra({ numero: "1A", numeroAte: "3B" }, "iguais"));
ok("E3 sem dígitos com andares (LJ) → erro",
  ...erra({ numero: "LJ", andar: "1", andarAte: "2" }, "use números"));
ok("E4 andar final menor que o inicial → erro",
  ...erra({ numero: "1", andar: "3", andarAte: "1" }, "andar final"));
ok("E5 teto de 500 unidades",
  ...erra({ numero: "1", numeroAte: "600" }, "Máximo de 500"));

console.log(falhas ? `\n❌ ${falhas} sonda(s) falharam` : "\n🏢 UNIDADES EM LOTE OK");
process.exitCode = falhas ? 1 : 0;
