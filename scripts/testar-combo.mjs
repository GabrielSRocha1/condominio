/* Sondas do DROPDOWN COM BUSCA (src/lib/combo.js + ComboBusca no JSX).

   Duas metades, as duas sem navegador:
   · PURO — a regra da busca: sem acento, sem caixa, termos em qualquer
     ordem, lista vazia devolve tudo;
   · FONTE — as armadilhas que só aparecem montado e que nenhum teste de
     unidade pega: lista aberta dentro de modal com overflow (seria cortada
     se fosse absoluta), Enter que enviaria o formulário, campo oculto que
     não entra na validação do navegador, e nenhum <select> longo de volta.

   Uso: node scripts/testar-combo.mjs */
import { readFileSync } from "node:fs";
import { filtrarOpcoes, ehListaLonga, semAcento, LISTA_LONGA } from "../src/lib/combo.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};

/* ══════════════════ PURO — a regra da busca ══════════════════ */
console.log("━━ a busca do dropdown (puro) ━━");

const UNIS = [
  ["u1", "Apartamento 1-A"],
  ["u2", "Apartamento 1-D"],
  ["u3", "Apartamento 3-D · Deise"],
  ["u4", "Apartamento 10-A · José Antônio"],
  ["u5", "Cobertura 12-B · Ana"],
  ["u6", "Sala 201 · Órion Contabilidade"],
];
const vals = (r) => r.map(([v]) => v).join(",");

ok("busca vazia devolve a lista inteira", filtrarOpcoes(UNIS, "").length === UNIS.length);
ok("só espaço também", filtrarOpcoes(UNIS, "   ").length === UNIS.length);
ok("acha pelo número", vals(filtrarOpcoes(UNIS, "10")) === "u4");
ok("acha pela letra do apartamento", vals(filtrarOpcoes(UNIS, "1-d")) === "u2");
ok("acha pelo nome do responsável", vals(filtrarOpcoes(UNIS, "deise")) === "u3");
ok("acha pelo tipo", vals(filtrarOpcoes(UNIS, "cobertura")) === "u5");
/* o acento é do rótulo, não de quem procura — ninguém digita "josé" no meio
   de uma busca, e "orion" tem de achar "Órion" */
ok("ignora acento do rótulo", vals(filtrarOpcoes(UNIS, "jose")) === "u4");
ok("ignora acento nos dois lados", vals(filtrarOpcoes(UNIS, "órion")) === "u6");
ok("ignora caixa", vals(filtrarOpcoes(UNIS, "APARTAMENTO 3")) === "u3");
/* dois termos com o separador "·" no meio: exigir a ordem faria "3 deise"
   não achar "Apartamento 3-D · Deise" */
ok("termos em qualquer ordem", vals(filtrarOpcoes(UNIS, "deise 3")) === "u3");
ok("todos os termos são exigidos", filtrarOpcoes(UNIS, "deise cobertura").length === 0);
ok("nada encontrado devolve lista vazia", filtrarOpcoes(UNIS, "zzz").length === 0);
ok("não quebra com lista nula", filtrarOpcoes(null, "a").length === 0);
ok("devolve CÓPIA, não a lista original", filtrarOpcoes(UNIS, "") !== UNIS);

/* o rótulo pode passar por L() antes de comparar (a opção vazia é traduzida) */
ok("aceita tradutor de rótulo",
  vals(filtrarOpcoes([["", "todas"], ["u1", "x"]], "TODAS", (l) => (l === "todas" ? "Todas as unidades" : l))) === "");

ok("semAcento normaliza", semAcento("José Antônio") === "jose antonio");
ok(`lista curta (<= ${LISTA_LONGA}) não vira busca`, !ehListaLonga(LISTA_LONGA) && !ehListaLonga(3));
ok("lista longa vira busca", ehListaLonga(LISTA_LONGA + 1));

/* ══════════════════ FONTE — o que só aparece montado ══════════════════ */
console.log("\n━━ o campo montado na tela (fonte) ━━");
{
  const tela = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
  const combo = tela.slice(tela.indexOf("function ComboBusca("), tela.indexOf("function ComboBusca(") + 6000);

  /* o valor precisa chegar ao FormData: as telas leem o formulário inteiro
     com new FormData(form), e um <div> não é campo de formulário */
  ok("o valor vai num input escondido com o `name`",
    /<input type="hidden" name=\{name\} value=\{sel\} \/>/.test(combo));
  /* ...e o `required` NÃO pode morar nesse escondido: campo oculto fica fora
     da validação do navegador, e o formulário passaria vazio */
  ok("o `required` fica no campo visível, não no escondido",
    /required=\{required\}/.test(combo) && !/type="hidden"[^>]*required/.test(combo));

  /* Enter com a lista aberta é "escolher", não "enviar o formulário" */
  ok("Enter escolhe em vez de enviar o formulário",
    /e\.key === "Enter" && aberto[\s\S]{0,200}e\.preventDefault\(\)/.test(combo));
  ok("Escape fecha e ArrowDown abre",
    /e\.key === "Escape"/.test(combo) && /e\.key === "ArrowDown"/.test(combo));

  /* os modais são max-h-[92vh] overflow-y-auto: lista absoluta seria cortada
     na borda do modal — que é onde este campo mais aparece */
  ok("a lista é FIXA (não é cortada pelo overflow do modal)",
    /className="fixed overflow-y-auto/.test(combo) && /getBoundingClientRect\(\)/.test(combo));
  ok("e reposiciona no scroll do modal (captura), não só no da janela",
    /addEventListener\("scroll", ao, true\)/.test(combo));
  ok("fecha ao clicar fora", /addEventListener\("mousedown", fora\)/.test(combo));
  /* devolver o foco ao campo dentro de escolher() faz o onFocus chamar
     abrir() na mesma batida do setAberto(false): a lista reabre sozinha e
     nunca fecha no clique */
  ok("escolher não devolve o foco (reabriria a lista)",
    !/escolher = \(v\) => \{[\s\S]{0,400}?\.focus\(\)/.test(combo));
  ok("abre para cima quando não há espaço embaixo", /paraCima/.test(combo));

  /* a regra da busca é do módulo puro — se voltar para dentro do JSX, as
     sondas de cima param de provar o que a tela faz */
  ok("a tela usa a regra do módulo puro",
    /filtrarOpcoes\(todas, q, L\)/.test(combo)
    && /import \{ filtrarOpcoes, ehListaLonga \} from "\.\/src\/lib\/combo\.js"/.test(tela));

  /* nenhuma lista de unidade pode ter voltado a ser <select> cru: é o que
     esta mudança veio resolver */
  /* olhar só o MIOLO de cada <select>…</select>: um regex que atravesse o
     fechamento acha o ComboBusca da linha seguinte e acusa o que não há */
  const miolos = [...tela.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)].map(([, m]) => m);
  const crus = miolos.filter((m) => /\bunidades\w*\.map\(|\bpessoasOrd\.map\(/.test(m));
  ok("nenhum <select> cru alimentado por unidades ou pessoas", crus.length === 0,
    crus.length ? `${crus.length} ocorrência(s)` : `${miolos.length} selects conferidos`);
  const usos = (tela.match(/<ComboBusca\b/g) || []).length;
  ok("as listas longas de unidade/pessoa usam o campo com busca", usos >= 11, `${usos} usos`);
}

console.log(falhas ? `\n❌ combo: ${falhas} falha(s)` : "\n🔎 DROPDOWN COM BUSCA OK");
process.exit(falhas ? 1 : 0);
