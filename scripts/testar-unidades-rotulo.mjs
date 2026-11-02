/* Sonda do RÓTULO de exibição e da BUSCA de unidades (src/lib/unidades.js) —
   pura, sem app nem banco.

   O rótulo colapsa "1001-A" no 10º andar para "10-A". A regra é conservadora
   de propósito: só colapsa quando dá para PROVAR que o número embute o andar,
   porque um palpite errado renomeia a unidade na cara do condomínio. Os casos
   N abaixo são os que ela tem de recusar.

   A busca existe porque a antiga tratava todo termo começado em dígito como
   `numero.startsWith`: "1-A" não achava nada e "A" trazia o prédio inteiro
   (casava com "apartamento").

   Uso: node scripts/testar-unidades-rotulo.mjs */
import { rotuloCurto, mapaRotulos, casaUnidade, letraDaUnidade, expandirUnidades } from "../src/lib/unidades.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const un = (numero, andar, tipo = "apartamento", bloco = "A") => ({ numero, andar, tipo, bloco });
const rot = (u, esperado) => {
  const r = rotuloCurto(u);
  return [r === esperado, r === esperado ? String(r) : `obtido ${JSON.stringify(r)}, esperado ${JSON.stringify(esperado)}`];
};

/* ══ C · colapsos corretos ══ */
console.log("━━ C · o número embute o andar ━━");
ok("C1 1001-A no 10º andar (o caso da tela)", ...rot(un("1001-A", 10), "10-A"));
ok("C2 101-A no 1º andar", ...rot(un("101-A", 1), "1-A"));
ok("C3 sem separador: 1001A no 10º", ...rot(un("1001A", 10), "10-A"));
ok("C4 letra no prefixo: A101 no 1º", ...rot(un("A101", 1), "1-A"));
ok("C5 número = andar + letra: 1D no 1º", ...rot(un("1D", 1), "1-D"));
ok("C6 número = andar + letra, dois dígitos: 12A no 12º", ...rot(un("12A", 12), "12-A"));
ok("C7 letra minúscula sobe para maiúscula", ...rot(un("101a", 1), "1-A"));
ok("C8 térreo (andar 0): 001A", ...rot(un("001A", 0), "0-A"));
ok("C9 duas letras: 1201AB no 12º", ...rot(un("1201AB", 12), "12-AB"));

/* ══ N · recusas (fica o número cru) ══ */
console.log("\n━━ N · na dúvida, não colapsa ━━");
ok("N1 sem letra nenhuma: 402 no 4º", ...rot(un("402", 4), null));
ok("N2 sem letra, numeração clássica: 101 no 1º", ...rot(un("101", 1), null));
ok("N3 andar não informado: 1D sem andar", ...rot(un("1D", null), null));
ok("N4 sobra UM dígito (12D no 1º viraria 1-D e comeria o 12)", ...rot(un("12D", 1), null));
ok("N5 o número não começa pelo andar: 201A no 1º", ...rot(un("201A", 1), null));
ok("N6 box numera sozinho: B12 com andar espelhado 12", ...rot(un("B12", 12, "box"), null));
ok("N7 depósito idem: D3 com andar 3", ...rot(un("D3", 3, "deposito"), null));
ok("N8 letra dos DOIS lados: A101B no 1º", ...rot(un("A101B", 1), null));
ok("N9 zero à esquerda no andar: 0101A no 1º", ...rot(un("0101A", 1), null));
ok("N10 subsolo (andar negativo): 101A no andar -1", ...rot(un("101A", -1), null));
ok("N11 andar não inteiro é ignorado", ...rot(un("101A", 1.5), null));
ok("N12 letra demais não é letra de unidade: 101ABC", ...rot(un("101ABC", 1), null));

/* ══ M · mapa do condomínio inteiro ══ */
console.log("\n━━ M · desambiguação por bloco ━━");
const mapa1 = mapaRotulos([un("1001-A", 10), un("1001-B", 10), un("101-A", 1)]);
ok("M1 condomínio normal: as três colapsam",
  mapa1.get("1001-A|A") === "10-A" && mapa1.get("1001-B|A") === "10-B" && mapa1.get("101-A|A") === "1-A",
  `${mapa1.size} de 3`);
const mapa2 = mapaRotulos([un("101-A", 1), un("102-A", 1)]);
ok("M2 colisão no mesmo bloco (101-A e 102-A dariam 1-A): nenhuma colapsa",
  mapa2.size === 0, `${mapa2.size} entrada(s)`);
const mapa3 = mapaRotulos([un("101-A", 1, "apartamento", "A"), un("101-A", 1, "apartamento", "B")]);
ok("M3 mesmo rótulo em blocos DIFERENTES: as duas colapsam (o bloco separa)",
  mapa3.get("101-A|A") === "1-A" && mapa3.get("101-A|B") === "1-A", `${mapa3.size} de 2`);
const mapa4 = mapaRotulos([un("101-A", 1), un("101-A", 2)]);
ok("M4 chave repetida (bloco homônimo duplicado): descarta as duas",
  mapa4.size === 0, `${mapa4.size} entrada(s)`);
const mapa5 = mapaRotulos([un("402", 4), un("1001-A", 10)]);
ok("M5 só entra no mapa quem colapsa (402 fica de fora)",
  mapa5.size === 1 && mapa5.get("1001-A|A") === "10-A", `${mapa5.size} entrada(s)`);
ok("M6 entrada vazia não quebra", mapaRotulos([]).size === 0 && mapaRotulos(null).size === 0);

/* ══ F · busca ══ */
console.log("\n━━ F · busca por número, letra e responsável ━━");
const linha = (num, rotulo, andar, extra = {}) => ({
  num, rotulo, andar, bloco: "A", tipo: "Apartamento", tipoRaw: "apartamento",
  status: "ocupada", resp: "—", ...extra,
});
const a10 = linha("1001-A", "10-A", 10, { resp: "Inácio Gonçalves" });
const b10 = linha("1001-B", "10-B", 10);
const a01 = linha("101-A", "1-A", 1, { status: "vaga" });
const acha = (q, esperado) => {
  const obtido = [a10, b10, a01].filter((u) => casaUnidade(u, q)).map((u) => u.rotulo);
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  return [bate, bate ? obtido.join(", ") || "nada" : `obtido [${obtido}], esperado [${esperado}]`];
};
ok("F1 a letra sozinha traz só a coluna A (não casa com 'apartamento')", ...acha("a", ["10-A", "1-A"]));
ok("F2 a outra letra", ...acha("b", ["10-B"]));
ok("F3 o andar sozinho", ...acha("10", ["10-A", "10-B"]));
ok("F4 andar 1 não traz o 10", ...acha("1", ["1-A"]));
ok("F5 o rótulo como a tela mostra", ...acha("10-A", ["10-A"]));
ok("F6 o rótulo sem separador", ...acha("10a", ["10-A"]));
ok("F7 o número velho ainda acha (quem decorou 1001)", ...acha("1001", ["10-A", "10-B"]));
ok("F8 prefixo estruturado em espanhol", ...acha("piso 10", ["10-A", "10-B"]));
ok("F9 'andar 1' é numérico: não traz o andar 10", ...acha("andar 1", ["1-A"]));
ok("F10 'andar 01' traz o andar 1", ...acha("andar 01", ["1-A"]));
ok("F11 responsável sem acento acha o acentuado", ...acha("inacio", ["10-A"]));
ok("F12 responsável em maiúscula e com acento", ...acha("INÁCIO", ["10-A"]));
ok("F13 status", ...acha("vaga", ["1-A"]));
ok("F14 tipo traz todas", ...acha("apartamento", ["10-A", "10-B", "1-A"]));
ok("F15 combinando andar e letra", ...acha("piso 10 b", ["10-B"]));
ok("F16 bloco", ...acha("bloco a", ["10-A", "10-B", "1-A"]));
ok("F17 termo que não existe", ...acha("zzz", []));
ok("F18 busca vazia não filtra", ...acha("", ["10-A", "10-B", "1-A"]));
ok("F19 'bloco' ainda sem valor não filtra nada", ...acha("bloco", ["10-A", "10-B", "1-A"]));
ok("F20 'piso' ainda sem valor não filtra nada", ...acha("piso", ["10-A", "10-B", "1-A"]));
ok("F21 letra da unidade lida dos dois lados",
  letraDaUnidade("1001-A") === "a" && letraDaUnidade("A1001") === "a" && letraDaUnidade("402") === "");

/* ══ X · cruzado: tudo que o lote cria tem rótulo estável ══ */
console.log("\n━━ X · o que o lote cria, o rótulo lê ━━");
const lote = expandirUnidades({ numero: "1-A", andar: "1", andarAte: "12" });
const rotulos = lote.map((u) => rotuloCurto({ ...u, tipo: "apartamento" }));
ok("X1 1-A com andares 1 a 12 → 1-A … 12-A",
  rotulos.length === 12 && rotulos.every((r, i) => r === `${i + 1}-A`),
  rotulos.slice(0, 3).join(", ") + " … " + rotulos.slice(-1));
const loteMapa = mapaRotulos(lote.map((u) => ({ ...u, tipo: "apartamento", bloco: "A" })));
ok("X2 nenhuma colisão entre os 12 andares", loteMapa.size === 12, `${loteMapa.size} de 12`);
const semLetra = expandirUnidades({ numero: "1", numeroAte: "4", andar: "1", andarAte: "3" });
ok("X3 lote SEM letra não colapsa nada (101, 102… ficam como estão)",
  semLetra.every((u) => rotuloCurto({ ...u, tipo: "apartamento" }) === null));

console.log(falhas ? `\n❌ ${falhas} sonda(s) falharam` : "\n🏷️  RÓTULO E BUSCA DE UNIDADES OK");
process.exitCode = falhas ? 1 : 0;
