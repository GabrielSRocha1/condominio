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
import { chaveDoc, pessoaComMesmoDoc, camposQueFaltam, docProvisorio, planoDeDuplicados } from "../src/lib/pessoas.js";

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

/* plano de fusão dos duplicados de mesmo nome (reparo da planilha) */
ok("docProvisorio reconhece P-/M- e deixa documento real em paz",
  docProvisorio("P-abc123") && docProvisorio("m-999") && !docProvisorio("848004-4") && !docProvisorio(""));
const DUP = [
  { id: "a1", nome: "Cynthia Nathaly Orue Martinez", doc: "5827111-2", criadoEm: "2026-11-06T10:00" },
  { id: "a2", nome: "CYNTHIA NATHALY ORUE MARTINEZ", doc: "P-x1", criadoEm: "2026-11-06T11:00" },
  { id: "b1", nome: "Wener Bartholds", doc: "P-y1", criadoEm: "2026-11-05T09:00" },
  { id: "b2", nome: "WENER BARTHOLDS", doc: "P-y2", criadoEm: "2026-11-06T09:00" },
  { id: "c1", nome: "João Silva", doc: "111111", criadoEm: "2026-01-01" },
  { id: "c2", nome: "Joao Silva", doc: "222222", criadoEm: "2026-01-02" }, // dois docs REAIS: não decide
  { id: "d1", nome: "Único", doc: "P-z", criadoEm: "2026-01-01" },
];
const plano = planoDeDuplicados(DUP);
const fus = Object.fromEntries(plano.fusoes.map((f) => [f.destino, f.origens.join(",")]));
ok("mesmo nome (sem caixa/acento): provisório funde no documento real",
  fus.a1 === "a2", JSON.stringify(fus));
ok("todos provisórios: funde no mais antigo",
  fus.b1 === "b2");
ok("dois documentos reais com o mesmo nome: NÃO decide, reporta ambíguo",
  plano.ambiguas.length === 1 && plano.ambiguas[0].includes("c1") && plano.ambiguas[0].includes("c2"));
ok("quem não tem duplicata fica fora do plano",
  plano.fusoes.length === 2 && !JSON.stringify(plano.fusoes).includes("d1"));

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
  /* "permission denied for table usuarios" derrubava a unificação no meio:
     o navegador não tem GRANT nessa tabela — o update é melhor-esforço */
  ok("o update de usuarios na unificação é melhor-esforço (try/catch)",
    /try \{\s*await q\(supabase\.from\("usuarios"\)\.update\(\{ pessoa_id: destinoId \}\)[\s\S]{0,160}\} catch/.test(api));
  ok("o modal mostra o card com TODAS as unidades da pessoa acima do dropdown",
    /edit\?\.unidades\?\.length \|\| 0\) > 1/.test(tela) && /unidades vinculadas:/.test(tela)
    && /unidades: unidadesTodas/.test(api));
}

console.log(falhas ? `\n❌ pessoas-doc: ${falhas} falha(s)` : "\n🪪 DOCUMENTO ÚNICO DE PESSOA OK");
process.exit(falhas ? 1 : 0);
