/* Sondas do DOCUMENTO ÚNICO DE PESSOA (src/lib/pessoas.js + fluxo no JSX).

   O unique pessoas(condominio_id, cpf_cnpj) está certo — cadastro único por
   pessoa. O que estas sondas prendem é a regra que faz "mesmo documento" ser
   tratado como "a mesma pessoa com mais um apartamento":
   · PURO — chave de comparação do documento, busca de pessoa pelo doc e o
     fill-empty da unificação (o destino manda);
   · FONTE — o modal de Pessoas pré-checa e unifica; criarPessoa reusa o
     cadastro existente; unificarPessoas reponta as 5 tabelas que apontam
     pessoa e preserva os ids de vínculo (update, não recria).

   Uso: node scripts/testar-pessoas-doc.mjs */
import { readFileSync } from "node:fs";
import { chaveDoc, pessoaComMesmoDoc, camposQueFaltam } from "../src/lib/pessoas.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};

/* ══════════ PURO — a identidade é o documento ══════════ */
console.log("━━ documento único (puro) ━━");

ok("chaveDoc ignora caixa, espaços e pontos — o traço fica (dígito verificador)",
  chaveDoc("848.004-4") === "848004-4" && chaveDoc(" 848004-4 ") === "848004-4"
  && chaveDoc("ABC 12.3") === "abc123",
  `"848.004-4"→${chaveDoc("848.004-4")}`);
ok("chaveDoc: vazio e nulo viram chave vazia", chaveDoc("") === "" && chaveDoc(null) === "" && chaveDoc() === "");

const PESSOAS = [
  { id: "p1", nome: "Dominico Orue", docRaw: "848004-4" },
  { id: "p2", nome: "Responsável 1-A", docRaw: "P-abc123def456" },
  { id: "p3", nome: "Telsec S.A.", docRaw: "80020358-5" },
];
ok("acha a pessoa pelo documento, mesmo formatado diferente",
  pessoaComMesmoDoc(PESSOAS, "848.004-4")?.id === "p1" && pessoaComMesmoDoc(PESSOAS, " 848004-4")?.id === "p1");
ok("ignora a própria pessoa (edição não acusa a si mesma)",
  pessoaComMesmoDoc(PESSOAS, "848004-4", "p1") === null);
ok("outra pessoa com o doc É acusada mesmo na edição",
  pessoaComMesmoDoc(PESSOAS, "848004-4", "p2")?.id === "p1");
ok("documento vazio não casa com nada; lista nula não quebra",
  pessoaComMesmoDoc(PESSOAS, "") === null && pessoaComMesmoDoc(null, "848004-4") === null);
ok("aceita linhas cruas do banco (cpf_cnpj) além das da tela (docRaw)",
  pessoaComMesmoDoc([{ id: "x", cpf_cnpj: "848004-4" }], "848.004-4")?.id === "x");

/* fill-empty: o destino manda — só o vazio dele é preenchido */
const destino = { telefone: "+595973660916", email: "", documento_url: null };
const form = { telefone: "+5511999", email: "novo@x.com", documento_url: "https://arq" };
const falta = camposQueFaltam(destino, form);
ok("unificação preenche SÓ o que falta no destino",
  !("telefone" in falta) && falta.email === "novo@x.com" && falta.documento_url === "https://arq",
  JSON.stringify(falta));
ok("nada a preencher devolve objeto vazio (e nulos não quebram)",
  Object.keys(camposQueFaltam({ telefone: "a", email: "b", documento_url: "c" }, form)).length === 0
  && Object.keys(camposQueFaltam(null, null)).length === 0);

/* ══════════ FONTE — o fluxo montado ══════════ */
console.log("\n━━ o fluxo nas telas (fonte) ━━");
{
  const tela = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/lib/api.js", import.meta.url), "utf8");

  ok("o modal de Pessoas pré-checa o documento e oferece unificar",
    /pessoaComMesmoDoc\(db\.pessoas, f\.doc, edit\.id\)/.test(tela)
    && /unificarPessoas\(db\.ctx, edit, outra\.id, f\)/.test(tela)
    && /confirm\(`\$\{L\("Este documento já é de"\)\}/.test(tela));
  ok("criar pessoa com doc existente REUSA o cadastro (vínculo novo, nunca duplica)",
    /pessoaComMesmoDoc\(todas, f\.doc\)/.test(api));
  const unificar = api.slice(api.indexOf("export async function unificarPessoas"),
    api.indexOf("export async function unificarPessoas") + 4000);
  ok("unificarPessoas reponta vínculos, unidades, cobranças, penalidades e usuários",
    /pessoa_vinculos"\)\.update\(\{ pessoa_id: destinoId \}\)/.test(unificar)
    && /responsavel_financeiro_id: destinoId/.test(unificar)
    && /responsavel_id: destinoId/.test(unificar)
    && /infrator_id: destinoId/.test(unificar)
    && /usuarios"\)\.update\(\{ pessoa_id: destinoId \}\)/.test(unificar));
  ok("vínculos passam por UPDATE (ids preservados — chamados os referenciam)",
    !/pessoa_vinculos"\)\.insert/.test(unificar));
  ok("funcionário/prestador nunca são apagados na deduplicação",
    /\["funcionario", "prestador"\]\.includes\(v\.papel\)/.test(unificar));
  ok("o unique estourando vira mensagem de gente (rede de proteção)",
    /ERRO_DOC_DUPLICADO/.test(api) && /docJaExiste\(e\)/.test(api));
}

console.log(falhas ? `\n❌ pessoas-doc: ${falhas} falha(s)` : "\n🪪 DOCUMENTO ÚNICO DE PESSOA OK");
process.exit(falhas ? 1 : 0);
