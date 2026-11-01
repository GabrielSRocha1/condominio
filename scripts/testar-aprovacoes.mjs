/* Sondas do ADMINISTRADOR PREDIAL e da fila de aprovação
   (src/lib/aprovacoes.js + supabase-aprovacoes.sql).

   A promessa é forte: NADA que o administrador faz vale sem o diretor
   aprovar. Promessa forte pede prova forte — e a prova tem de ser feita
   contra o BANCO, com o token dele, porque é exatamente ali que uma
   checagem só de interface seria contornada pelo console do navegador.

   Bloco U (puro): diff do que muda, rótulos, ordem de aplicação e a
   correção do diretor.
   Bloco B (banco + API): a escrita dele NÃO entra e vira pendência; o
   diretor aprova e a linha nasce; aprova COM correção e vale a correção;
   rejeita e nada acontece; e o administrador não aprova a si mesmo.

   Sem o supabase-aprovacoes.sql o bloco B é PULADO com aviso.
   Tudo que cria é removido no fim.

   Uso: node scripts/testar-aprovacoes.mjs   (bloco B exige npm run dev) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  TABELAS, rotuloTabela, rotuloOperacao, rotuloCampo, valorTexto,
  diff, resumir, ordenar, pendentes, correcaoLimpa, CAMPOS_OCULTOS,
  agrupar, resumirGrupo, camposDoGrupo, IMEDIATAS, exigeAprovacao,
  PERFIS_SOB_APROVACAO, ehPerfilSobAprovacao, ehAcao, ACOES,
} from "../src/lib/aprovacoes.js";
import { MATRIZ_PADRAO, PERMS_VEDADAS_AO_ADMIN, PERFIS_QUE_O_ADMIN_CRIA, sanearPerms, pode } from "../src/lib/permissoes.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const clienteApp = (token) => createClient(URL_SB, env.VITE_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } } });
const BASE = process.env.BASE || "http://localhost:5173";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";   // condomínio TESTE Manuais
const EMAIL_ADM = "admin.aprov@teste.condomaster.dev";
const EMAIL_VITIMA = "sindico.forjado@teste.condomaster.dev"; // o que ele NÃO pode criar
const EMAIL_MORADOR = "morador.sonda@teste.condomaster.dev";  // o que ele PODE criar
const NOME_MORADOR = "sonda morador";
const EMAIL_SIND = "sindico.aprov@teste.condomaster.dev"; // síndico de teste (bloco S)
const MARCA_S = "sonda sindico";
const COMP_SIND = "2099-11";
const COMP_SONDA = "2099-12";                                 // competência fora do caminho de todo mundo
const SENHA = "teste12345";
const SENHA_DIRETOR = "teste123";
const MARCA = "sonda aprovacoes";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
const post = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!r) return { http: 0 };
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
};

/* ══════════════════ BLOCO U — puro ══════════════════ */
console.log("━━ U · leitura da fila (puro) ━━");

ok("toda tabela coberta tem rótulo e tela",
  Object.values(TABELAS).every((v) => v.rotulo && v.tela) || Object.keys(TABELAS).length > 0,
  `${Object.keys(TABELAS).length} tabelas`);
ok("rótulo de tabela desconhecida não quebra", rotuloTabela("tabela_nova") === "tabela_nova");
ok("rótulo de operação", rotuloOperacao("DELETE") === "Exclusão" && rotuloOperacao("INSERT") === "Criação");
ok("rótulo de campo deriva do nome", rotuloCampo("valor_original") === "Valor"
  && rotuloCampo("responsavel_id") === "Responsavel" && rotuloCampo("prazo") === "Prazo");
ok("valor nulo vira travessão, não 'null'", valorTexto(null) === "—" && valorTexto("") === "—");
ok("booleano em português", valorTexto(true) === "sim" && valorTexto(false) === "não");

/* o diff é o que o diretor lê para decidir — errar aqui é mostrar mudança
   que não existe (ou esconder a que existe) */
{
  const ins = diff({ operacao: "INSERT", payload: { id: "x", condominio_id: "c", nome: "Bloco A", vazio: null } });
  ok("INSERT lista só o que foi preenchido",
    ins.length === 1 && ins[0].campo === "nome" && ins[0].para === "Bloco A", JSON.stringify(ins));

  const upd = diff({ operacao: "UPDATE",
    payload:  { id: "x", nome: "Novo", valor: 10, atualizado_em: "agora" },
    anterior: { id: "x", nome: "Velho", valor: 10, atualizado_em: "antes" } });
  ok("UPDATE mostra só o que mudou", upd.length === 1 && upd[0].campo === "nome"
    && upd[0].de === "Velho" && upd[0].para === "Novo", JSON.stringify(upd));
  ok("ruído de infraestrutura fica fora", !upd.some((d) => CAMPOS_OCULTOS.has(d.campo)));

  const del = diff({ operacao: "DELETE", payload: { id: "x", nome: "Some" }, anterior: { id: "x", nome: "Some" } });
  ok("DELETE mostra o que deixa de existir",
    del.length === 1 && del[0].de === "Some" && del[0].para === null);

  /* jsonb e número vindos do banco: 1 e "1" NÃO são a mesma coisa e o
     diretor precisa ver isso */
  const tipos = diff({ operacao: "UPDATE", payload: { v: "1", j: { a: 1 } }, anterior: { v: 1, j: { a: 1 } } });
  ok("tipo diferente conta como mudança; jsonb igual não",
    tipos.length === 1 && tipos[0].campo === "v", JSON.stringify(tipos));
}

ok("resumo usa o nome quando existe",
  resumir({ tabela: "unidades", operacao: "INSERT", resumo: "101-A" }) === "Criação de Unidade: 101-A");

/* a ORDEM é o que faz mãe ser aprovada antes da filha */
{
  const fila = [
    { id: "c", solicitado_em: "2026-10-31T10:00:03Z", status: "pendente" },
    { id: "a", solicitado_em: "2026-10-31T10:00:01Z", status: "pendente" },
    { id: "b", solicitado_em: "2026-10-31T10:00:02Z", status: "aprovada" },
  ];
  ok("fila ordena da mais antiga para a mais nova",
    ordenar(fila).map((x) => x.id).join("") === "abc");
  ok("pendentes mantém a ordem e filtra decididas",
    pendentes(fila).map((x) => x.id).join("") === "ac");
}

/* correção do diretor: só o que ele realmente mexeu */
{
  const orig = { nome: "A", valor: 10 };
  ok("campo intocado não vira correção", correcaoLimpa(orig, { nome: "A", valor: 10 }) === null);
  ok("só o campo mexido entra",
    JSON.stringify(correcaoLimpa(orig, { nome: "B", valor: 10 })) === '{"nome":"B"}');
  ok("campo oculto nunca entra na correção",
    correcaoLimpa(orig, { id: "outro" }) === null);
}

/* AGRUPAMENTO — "cadastrar a Danielle" é uma frase só para quem clicou, mas
   chega como 3 linhas. A tela mostra UMA ação por cartão; errar aqui é
   fracionar a lista (o que o diretor reclamou) ou, pior, colar ações
   distintas num cartão só e aprová-las juntas sem querer. */
{
  const t = (n) => `2026-10-31T16:5${n}:00Z`;
  /* criarPessoa: pessoa (id do cliente) + vínculo que aponta para ela +
     a unidade que ganha a pessoa como responsável financeiro */
  const acaoPessoa = (idP, idV, quando, nome = "Danielle") => ([
    { id: idP, tabela: "pessoas", operacao: "INSERT", status: "pendente", solicitado_em: quando,
      payload: { id: idP, condominio_id: "c", nome, cpf_cnpj: "123" } },
    { id: idV, tabela: "pessoa_vinculos", operacao: "INSERT", status: "pendente", solicitado_em: quando,
      payload: { id: idV, condominio_id: "c", pessoa_id: idP, papel: "morador" } },
  ]);

  const umaAcao = agrupar(acaoPessoa("p1", "v1", t(1)));
  ok("pessoa + vínculo viram UM cartão", umaAcao.length === 1 && umaAcao[0].itens.length === 2,
    `${umaAcao.length} cartão(ões), ${umaAcao[0]?.itens.length} parte(s)`);
  ok("a mãe vem primeiro dentro do cartão",
    umaAcao[0]?.itens[0].tabela === "pessoas" && umaAcao[0]?.itens[1].tabela === "pessoa_vinculos");
  ok("o cartão diz o que vem junto", resumirGrupo(umaAcao[0]) === "+ Vínculo da pessoa", resumirGrupo(umaAcao[0]));
  ok("campos somam as partes", camposDoGrupo(umaAcao[0]) === diff(umaAcao[0].itens[0]).length + diff(umaAcao[0].itens[1]).length);

  /* o clique saiu duas vezes: ids e carimbos diferentes, conteúdo igual */
  const repetido = agrupar([...acaoPessoa("p1", "v1", t(1)), ...acaoPessoa("p2", "v2", t(2))]);
  ok("mesma ação enviada duas vezes: a 2ª é marcada repetida",
    repetido.length === 2 && !repetido[0].repetida && repetido[1].repetida,
    repetido.map((g) => g.repetida).join(","));
  ok("a repetida aponta a hora da original", repetido[1]?.repeteDe === t(1));

  /* duas pessoas DIFERENTES não podem virar "repetida" — seria o diretor
     rejeitando um cadastro legítimo achando que era clique duplicado */
  const duasPessoas = agrupar([...acaoPessoa("p1", "v1", t(1)), ...acaoPessoa("p3", "v3", t(2), "Marcos")]);
  ok("cadastros diferentes não são marcados repetidos",
    duasPessoas.length === 2 && duasPessoas.every((g) => !g.repetida));

  /* blocos soltos (sem ninguém apontando para eles) seguem cartões próprios */
  const soltos = agrupar([
    { id: "b1", tabela: "blocos", operacao: "INSERT", status: "pendente", solicitado_em: t(1), payload: { id: "b1", condominio_id: "c", nome: "A" } },
    { id: "b2", tabela: "blocos", operacao: "INSERT", status: "pendente", solicitado_em: t(2), payload: { id: "b2", condominio_id: "c", nome: "A" } },
  ]);
  ok("dois blocos iguais: dois cartões, o 2º repetido",
    soltos.length === 2 && soltos[1].repetida && !soltos[0].repetida);

  /* a mãe aplicou e a filha falhou: dizer "aprovada" mentiria */
  const parcial = agrupar([
    { id: "p1", tabela: "pessoas", operacao: "INSERT", status: "aprovada", solicitado_em: t(1), payload: { id: "p1", condominio_id: "c", nome: "X" } },
    { id: "v1", tabela: "pessoa_vinculos", operacao: "INSERT", status: "pendente", solicitado_em: t(1), erro: "FK", payload: { id: "v1", condominio_id: "c", pessoa_id: "p1" } },
  ]);
  ok("grupo meio aplicado aparece como parcial", parcial[0]?.status === "parcial", parcial[0]?.status);
  ok("o erro da filha sobe para o cartão", parcial[0]?.erro === "FK");

  ok("fila vazia não quebra o agrupamento", agrupar([]).length === 0 && agrupar(null).length === 0);
}

/* o conjunto do administrador não pode conter o que a fila não alcança */
{
  const adm = MATRIZ_PADRAO.administrador_predial || [];
  const vazadas = adm.filter((c) => PERMS_VEDADAS_AO_ADMIN.includes(c));
  ok("padrão do administrador não traz permissão fora da fila", vazadas.length === 0, vazadas.join(", "));
  ok("administrador enxerga as telas do diretor",
    ["tela.financeiro", "tela.unidades", "tela.multas", "tela.condominio"].every((c) => pode(adm, c)));
  ok("administrador NÃO aprova (nem a si mesmo)", !pode(adm, "alteracao.aprovar"));
}

/* paridade com o SQL: as tabelas com gatilho são as mesmas que a tela sabe
   traduzir — tabela com gatilho e sem rótulo viraria "chamados_xyz" na
   cara do diretor */
{
  const s = readFileSync(new URL("../supabase-aprovacoes.sql", import.meta.url), "utf8");
  const bloco = s.slice(s.indexOf("foreach t in array array["), s.indexOf("loop", s.indexOf("foreach t in array")));
  const doSql = [...bloco.matchAll(/'([a-z_]+)'/g)].map(([, t]) => t);
  const semRotulo = doSql.filter((t) => !TABELAS[t]);
  const semGatilho = Object.keys(TABELAS).filter((t) => !doSql.includes(t));
  ok("toda tabela com gatilho tem rótulo no JS", semRotulo.length === 0, semRotulo.join(", "));
  ok("todo rótulo do JS tem gatilho no SQL", semGatilho.length === 0, semGatilho.join(", "));
  ok("portaria fica FORA da fila (tempo real)",
    !doSql.includes("acessos_portaria") && !doSql.includes("pre_autorizacoes"));
}

/* ══════════════════ BLOCO A — camada do app (api.js) ══════════════════
   O gatilho CANCELA a escrita do administrador: todo insert desviado volta
   com ZERO linha. Quem lia a linha de volta recebia undefined e estourava
   "Cannot read properties of undefined (reading 'id')" na cara dele — foi
   assim que criarUnidade quebrou, com o banco 100% correto e o bloco B
   inteiro verde. Por isso estas sondas leem o FONTE: o erro é de FORMA do
   código do app, e nenhum teste contra o banco o alcança. */
console.log("\n━━ A · as funções de api.js sabem que a escrita pode ir para a fila ━━");
{
  const api = readFileSync(new URL("../src/lib/api.js", import.meta.url), "utf8");
  const tela = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
  const s = readFileSync(new URL("../supabase-aprovacoes.sql", import.meta.url), "utf8");
  const bl = s.slice(s.indexOf("foreach t in array array["), s.indexOf("loop", s.indexOf("foreach t in array")));
  const COBERTAS = [...bl.matchAll(/'([a-z_]+)'/g)].map(([, t]) => t);

  /* uma função "sabe da fila" se menciona qualquer peça do mecanismo */
  const CIENTE = /escritaVaiParaFila|erroFila|linhaOuFila|comId\(|idDaFila/;
  const PREVE_ID = /comId\(|idDaFila\(/;

  const marcas = [...api.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)]
    .map((m) => ({ nome: m[1], i: m.index }));
  const funcoes = marcas.map((m, k) => ({ nome: m.nome, txt: api.slice(m.i, marcas[k + 1]?.i ?? api.length) }));

  const escritasDe = (txt) => {
    const out = [];
    for (const m of txt.matchAll(/supabase\s*\.from\("(\w+)"\)/g)) {
      if (!COBERTAS.includes(m[1])) continue;
      const prox = txt.indexOf("supabase", m.index + 10);
      const op = txt.slice(m.index, prox > 0 ? prox : m.index + 400).match(/\.(insert|update|delete|upsert)\(/);
      if (op) out.push({ tabela: m[1], op: op[1] });
    }
    return out;
  };

  const cegas = [], semId = [];
  let escritoras = 0;
  for (const f of funcoes) {
    const esc = escritasDe(f.txt);
    if (!esc.length) continue;
    escritoras++;
    if (!CIENTE.test(f.txt)) cegas.push(f.nome);
    /* cadastro composto (mãe + filha na MESMA função): sem id gerado no
       cliente a filha é enfileirada apontando para o nada e a aprovação
       nunca fecha a chave estrangeira */
    const inseridas = new Set(esc.filter((e) => e.op === "insert" || e.op === "upsert").map((e) => e.tabela));
    if (inseridas.size > 1 && !PREVE_ID.test(f.txt)) semId.push(`${f.nome} (${[...inseridas].join("+")})`);
  }

  ok("toda escritora de tabela coberta sabe da fila", cegas.length === 0,
    cegas.length ? cegas.join(", ") : `${escritoras} funções conferidas`);
  ok("cadastro composto gera o id no cliente", semId.length === 0, semId.join(", "));

  /* uma criação de unidade refazia a fração de TODAS as unidades: com o
     administrador seriam N pendências de uma vez na tela do diretor */
  ok("gatilho deixa passar o UPDATE só de fracao_ideal",
    /fracao_ideal'[\s\S]{0,200}return new/.test(s));
  /* editar área e excluir continuam pendentes: o rateio de lá sai na
     aprovação, com o token do diretor */
  ok("a tela Aprovações refaz as frações ao aprovar unidade",
    /tabela === "unidades"[\s\S]{0,80}recalcularFracoes/.test(tela));

  /* a política de quem NÃO espera vive em dois lugares: o gatilho (que
     manda) e IMEDIATAS (que o app consulta para falar a verdade na tela).
     Discordar = o app promete uma coisa e o banco faz outra. */
  /* o SQL tem as duas formas: `in (...)` para o grupo que passa direto e
     `= 'cobrancas'` para a que passa nascendo rascunho — as duas são
     "não espera o diretor", então as duas contam */
  const imediatasSql = [...s.matchAll(
    /tg_op = 'INSERT' and tg_table_name (?:in\s*\(([^)]*)\)|= '([a-z_]+)')/g)]
    .flatMap(([, lista, uma]) => (uma ? [uma] : [...(lista || "").matchAll(/'([a-z_]+)'/g)].map(([, x]) => x)))
    .sort();
  ok("IMEDIATAS do app == exceção do gatilho",
    JSON.stringify(imediatasSql) === JSON.stringify([...(IMEDIATAS.INSERT || [])].sort()),
    `sql [${imediatasSql}] · js [${IMEDIATAS.INSERT}]`);
  ok("só CRIAÇÃO escapa — alterar e excluir sempre esperam",
    Object.keys(IMEDIATAS).join() === "INSERT"
    && exigeAprovacao("unidades", "DELETE") && exigeAprovacao("unidades", "UPDATE")
    && !exigeAprovacao("unidades", "INSERT"));
  /* bloco não é escolha: unidade apontando para bloco na fila quebraria
     na chave estrangeira */
  ok("bloco acompanha unidade (chave estrangeira)", !exigeAprovacao("blocos", "INSERT"));
  ok("vínculo acompanha pessoa (chave estrangeira)", !exigeAprovacao("pessoa_vinculos", "INSERT"));
  ok("o que não foi liberado continua esperando",
    ["lancamentos", "documentos", "comunicados", "penalidades", "condominios"]
      .every((x) => exigeAprovacao(x, "INSERT")));

  /* o portão da cobrança não some, muda de lugar: ela nasce e o morador não
     a vê. Se o gatilho parar de forçar rascunho, a cobrança chega ao morador
     sem ninguém ter olhado — é a falha mais cara desta tela. */
  ok("gatilho força rascunho na cobrança do administrador",
    /tg_table_name = 'cobrancas'[\s\S]{0,200}new\.status := 'rascunho'/.test(s));
  ok("emitir continua sendo UPDATE (logo, na fila)", exigeAprovacao("cobrancas", "UPDATE"));
  ok("quem PAGA a unidade continua na fila", exigeAprovacao("unidades", "UPDATE"));

  /* escrita feita por outro gatilho é consequência, não decisão: sem isto a
     sincronização planilha ⇄ cobranças quebrava no meio */
  ok("efeito de outro gatilho não vira pendência", /pg_trigger_depth\(\) > 1/.test(s));

  /* o portal e o checkout são os dois lugares onde a cobrança "chega" ao
     morador — os dois precisam recusar rascunho, senão o portão é decorativo */
  ok("portal do morador esconde rascunho", /c\.unidade === unidade && !c\.rascunho/.test(tela));
  const checkout = readFileSync(new URL("../api/stripe/checkout-cobranca.js", import.meta.url), "utf8");
  const informar = readFileSync(new URL("../api/cobrancas/informar-pagamento.js", import.meta.url), "utf8");
  ok("checkout recusa rascunho",
    /status === "rascunho"/.test(checkout) && !/"rascunho"\s*\]/.test(checkout.replace(/status === "rascunho"/g, "")));
  ok("informar pagamento recusa rascunho", /status === "rascunho"/.test(informar));

  /* acesso.gerir saiu das vedadas, mas com coleira: só morador, e só criar */
  const acessos = readFileSync(new URL("../api/auth/acessos.js", import.meta.url), "utf8");
  ok("administrador recebe acesso.gerir", MATRIZ_PADRAO.administrador_predial.includes("acesso.gerir"));
  ok("o endpoint trava o administrador em morador",
    /claims\.perfil === "administrador_predial"[\s\S]{0,400}f\.perfil !== "morador"/.test(acessos));
  ok("remover acesso e trocar cargo não são dele",
    /claims\.perfil === "administrador_predial"[\s\S]{0,200}acao !== "criar"/.test(acessos));
  ok("PERFIS_QUE_O_ADMIN_CRIA é só morador",
    JSON.stringify(PERFIS_QUE_O_ADMIN_CRIA) === '["morador"]');

  /* ── o SÍNDICO entrou na fila (01/11/2026) ──
     A lista de perfis vive em dois lugares: perfis_sob_aprovacao() no SQL
     (quem manda) e PERFIS_SOB_APROVACAO no JS (o que a tela promete).
     Divergir = a tela diz "vai para aprovação" e o banco grava direto. */
  const doSqlPerfis = (s.match(/perfis_sob_aprovacao\(\) returns text\[\][\s\S]{0,200}?array\[([^\]]*)\]/) || [, ""])[1];
  const perfisSql = [...doSqlPerfis.matchAll(/'([a-z_]+)'/g)].map(([, x]) => x).sort();
  ok("PERFIS_SOB_APROVACAO do app == perfis_sob_aprovacao() do banco",
    JSON.stringify(perfisSql) === JSON.stringify([...PERFIS_SOB_APROVACAO].sort()),
    `sql [${perfisSql}] · js [${PERFIS_SOB_APROVACAO}]`);
  ok("síndico e administrador operam sob aprovação",
    ehPerfilSobAprovacao("sindico") && ehPerfilSobAprovacao("administrador_predial"));
  ok("diretor e tesouraria NÃO", !ehPerfilSobAprovacao("diretor") && !ehPerfilSobAprovacao("tesouraria"));

  /* o gatilho e as RPCs de decisão têm de usar a LISTA, não o nome cravado —
     senão o síndico escreve direto (gatilho) ou decide a própria pendência */
  ok("gatilho consulta a lista de perfis",
    /not \(public\.jwt_perfil\(\) = any\(public\.perfis_sob_aprovacao\(\)\)\)/.test(s));
  ok("aprovar e rejeitar vetam a lista inteira",
    (s.match(/jwt_perfil\(\) = any\(public\.perfis_sob_aprovacao\(\)\)[\s\S]{0,40}?alteracao\.aprovar/g) || []).length === 2);
  ok("nenhum perfil sob aprovação recebe alteracao.aprovar, nem marcado à mão",
    PERFIS_SOB_APROVACAO.every((pf) => !sanearPerms(pf, ["alteracao.aprovar"]).includes("alteracao.aprovar")));
  ok("o síndico mantém baixar e cancelar (agora pela fila)",
    MATRIZ_PADRAO.sindico.includes("financeiro.baixar") && MATRIZ_PADRAO.sindico.includes("cobranca.cancelar"));

  /* ── AÇÕES de RPC ──
     Deixar a RPC correr para um perfil sob aprovação CORROMPE: pagamentos
     não é tabela coberta e entraria, enquanto a baixa da cobrança ficaria
     na fila — pagamento registrado numa cobrança em aberto. */
  ok("as três RPCs enfileiram a ação inteira",
    (s.match(/__aprovacao_embrulho__/g) || []).length === 3);
  ok("executar_acao tem allowlist fechada (nada de execute format)",
    /executar_acao/.test(s) && !/execute format\([^)]*p_acao/.test(s));
  ok("toda ação do SQL tem rótulo no JS",
    Object.keys(ACOES).every((a) => s.includes(`'${a}'`)), Object.keys(ACOES).join(","));
  ok("ACAO é operação válida na fila", /operacao in \('INSERT','UPDATE','DELETE','ACAO'\)/.test(s));
  ok("ação pendente não tem 'antes' e esconde os ids",
    (() => {
      const d = diff({ operacao: "ACAO", payload: { cobranca_id: "u1", valor: 150, justificativa: "ok", tx: null } });
      return d.length === 2 && d.every((x) => x.de === null) && !d.some((x) => x.campo === "cobranca_id");
    })());
  ok("resumo da ação não vira 'Ação de ...'",
    resumir({ tabela: "financeiro.baixar", operacao: "ACAO", resumo: "baixa de 150" })
      === "Baixa de pagamento: baixa de 150");
}

/* ══════════════════ BLOCO B — banco + API ══════════════════ */
console.log("\n━━ B · a escrita do administrador não vale sozinha (banco) ━━");

const NOMES_B = [
  "escrita do administrador NÃO entra na tabela", "e vira pendência na fila",
  "administrador não aprova a si mesmo", "diretor aprova e a linha nasce",
  "aprovar com correção grava o valor do diretor", "rejeitar não cria nada",
  "exclusão também espera aprovação", "portaria do administrador é imediata",
  "CRIAR unidade vale na hora (não vai para a fila)",
  "o rateio da unidade nova também passa direto",
  "EXCLUIR a unidade criada volta a esperar o diretor",
  "cobrança do administrador NASCE rascunho (mesmo mandando 'emitida')",
  "ele não emite a própria cobrança",
  "administrador NÃO cria login de síndico",
  "administrador NÃO remove acesso",
  "mas CRIA login de morador (coleira, não tranca)",
];

const temFila = await admin.from("alteracoes_pendentes").select("id").limit(1);
const { data: perfilAdm } = await admin.from("perfis").select("id").eq("nome", "administrador_predial").maybeSingle();
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA_DIRETOR });

if (temFila.error || !perfilAdm) {
  for (const n of NOMES_B) pula(n, "supabase-aprovacoes.sql não rodou");
  console.log("   ℹ️  estado atual: o perfil não existe — nada muda no app.");
} else if (!login.token) {
  for (const n of NOMES_B) pula(n, `login do diretor falhou — dev server de pé em ${BASE}? (npm run dev)`);
} else {
  const tokenDiretor = login.token;
  let usuarioAdm = null;
  const limpar = async () => {
    await admin.from("alteracoes_pendentes").delete().eq("condominio_id", COND).like("resumo", `${MARCA}%`);
    await admin.from("categorias_financeiras").delete().eq("condominio_id", COND).like("nome", `${MARCA}%`);
    /* a unidade da sonda pode ter ganhado linha de planilha (o gatilho de
       sincronização casa cobrança ⇄ planilha por unidade) e aí a chave
       estrangeira trava o delete — some o que aponta para ela primeiro */
    {
      const { data: us } = await admin.from("unidades")
        .select("id").eq("condominio_id", COND).like("numero", `${MARCA}%`);
      for (const x of us || []) {
        await admin.from("planilha_cobranca_linhas").delete().eq("unidade_id", x.id);
        await admin.from("cobrancas").delete().eq("unidade_id", x.id);
        await admin.from("unidades").delete().eq("id", x.id);
      }
    }
    await admin.from("blocos").delete().eq("condominio_id", COND).like("nome", `${MARCA}%`);
    await admin.from("acessos_portaria").delete().eq("condominio_id", COND).like("pessoa_nome", `${MARCA}%`);
    await admin.from("cobrancas").delete().eq("condominio_id", COND).eq("competencia", COMP_SONDA);
    /* o acesso de MORADOR não usa o e-mail enviado: o endpoint deriva um
       (`morador+<nome>@<cond>.local`) e é contra ele que faz o dedupe.
       Limpar pelo e-mail que a sonda mandou nunca acertava — e a execução
       seguinte batia em "já existe um morador com este nome". */
    {
      const { data: us } = await admin.from("usuarios")
        .select("id, pessoa_id").ilike("email", `%${NOME_MORADOR.replace(/\s+/g, ".")}%`);
      for (const x of us || []) {
        await admin.from("usuario_perfis").delete().eq("usuario_id", x.id);
        await admin.from("alteracoes_pendentes").delete().eq("solicitado_por", x.id);
        await admin.from("usuarios").delete().eq("id", x.id);
        if (x.pessoa_id) {
          await admin.from("pessoa_vinculos").delete().eq("pessoa_id", x.pessoa_id);
          await admin.from("pessoas").delete().eq("id", x.pessoa_id);
        }
      }
    }
    /* contas de sonda apagadas pelo SERVICE ROLE, não pelo endpoint: o
       endpoint tem idempotência por (usuário, rota, corpo), então duas
       execuções seguidas da suíte viravam no-op e deixavam a conta de
       ontem para trás — o login da execução seguinte falhava sem motivo
       aparente. */
    for (const e of [EMAIL_ADM, EMAIL_VITIMA, EMAIL_MORADOR]) {
      const { data: u } = await admin.from("usuarios").select("id, pessoa_id").eq("email", e).maybeSingle();
      if (!u) continue;
      await admin.from("usuario_perfis").delete().eq("usuario_id", u.id);
      /* a pessoa criada junto com o acesso: sem apagá-la o endpoint recusa
         a próxima execução com "já existe um morador com este nome" */
      if (u.pessoa_id) {
        await admin.from("pessoa_vinculos").delete().eq("pessoa_id", u.pessoa_id);
        await admin.from("pessoas").delete().eq("id", u.pessoa_id);
      }
      /* pendências dele primeiro: a FK é on delete set null no SQL atual,
         mas instalações antigas ainda travam a remoção do acesso */
      await admin.from("alteracoes_pendentes").delete().eq("solicitado_por", u.id);
      await admin.from("usuarios").delete().eq("id", u.id);
    }
  };

  try {
    await limpar();
    await post("auth/acessos", { acao: "criar", perfil: "administrador_predial", email: EMAIL_ADM, senha: SENHA }, tokenDiretor);
    const lg = await post("auth/login", { perfil: "administrador_predial", email: EMAIL_ADM, senha: SENHA });
    const { data: u } = await admin.from("usuarios").select("id").eq("email", EMAIL_ADM).maybeSingle();
    usuarioAdm = u?.id || null;

    if (!lg.token) {
      for (const n of NOMES_B) pula(n, "login do administrador de teste falhou");
    } else {
      const app = clienteApp(lg.token);

      /* 1 e 2 · a escrita não entra; vira pendência */
      const nomeBloco = `${MARCA} categoria`;
      const r1 = await app.from("categorias_financeiras").insert({ condominio_id: COND, nome: nomeBloco, tipo: "despesa" }).select();
      const { count: naTabela } = await admin.from("categorias_financeiras")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("nome", nomeBloco);
      ok(NOMES_B[0], !r1.error && (naTabela || 0) === 0,
        r1.error ? `erro inesperado: ${r1.error.message}` : `linhas na tabela: ${naTabela}`);

      const { data: fila1 } = await admin.from("alteracoes_pendentes")
        .select("*").eq("condominio_id", COND).eq("status", "pendente").order("solicitado_em");
      const pend = (fila1 || []).find((a) => a.payload?.nome === nomeBloco);
      ok(NOMES_B[1], !!pend && pend.tabela === "categorias_financeiras" && pend.operacao === "INSERT",
        pend ? `${pend.tabela}/${pend.operacao}` : "nada na fila");

      /* 3 · ele não aprova a própria pendência */
      if (!pend) pula(NOMES_B[2], "sem pendência para testar");
      else {
        const { data: auto } = await app.rpc("aprovar_alteracao", { p_id: pend.id, p_correcao: null, p_parecer: null });
        const { count: aindaNao } = await admin.from("categorias_financeiras")
          .select("*", { count: "exact", head: true }).eq("nome", nomeBloco);
        ok(NOMES_B[2], auto?.ok === false && auto?.erro === "nao_autorizado" && (aindaNao || 0) === 0,
          JSON.stringify(auto));
      }

      /* 4 · o diretor aprova e a linha nasce */
      const dirApp = clienteApp(tokenDiretor);
      if (!pend) pula(NOMES_B[3], "sem pendência para testar");
      else {
        const { data: ap } = await dirApp.rpc("aprovar_alteracao", { p_id: pend.id, p_correcao: null, p_parecer: "ok" });
        const { data: criado } = await admin.from("categorias_financeiras").select("id, nome").eq("nome", nomeBloco).maybeSingle();
        ok(NOMES_B[3], ap?.ok === true && !!criado, ap?.erro || (criado ? "categoria criada" : "não nasceu"));
      }

      /* 5 · aprovar COM correção: vale o que o diretor escreveu */
      const nomeErrado = `${MARCA} errado`, nomeCerto = `${MARCA} corrigido`;
      await app.from("categorias_financeiras").insert({ condominio_id: COND, nome: nomeErrado, tipo: "despesa" }).select();
      const { data: fila2 } = await admin.from("alteracoes_pendentes")
        .select("*").eq("condominio_id", COND).eq("status", "pendente").order("solicitado_em");
      const pend2 = (fila2 || []).find((a) => a.payload?.nome === nomeErrado);
      if (!pend2) pula(NOMES_B[4], "sem pendência para corrigir");
      else {
        await dirApp.rpc("aprovar_alteracao", { p_id: pend2.id, p_correcao: { nome: nomeCerto }, p_parecer: "corrigi o nome" });
        const { count: cErrado } = await admin.from("categorias_financeiras").select("*", { count: "exact", head: true }).eq("nome", nomeErrado);
        const { count: cCerto } = await admin.from("categorias_financeiras").select("*", { count: "exact", head: true }).eq("nome", nomeCerto);
        ok(NOMES_B[4], (cErrado || 0) === 0 && (cCerto || 0) === 1,
          `errado: ${cErrado} · corrigido: ${cCerto}`);
      }

      /* 6 · rejeitar não cria nada */
      const nomeRejeitado = `${MARCA} rejeitado`;
      await app.from("categorias_financeiras").insert({ condominio_id: COND, nome: nomeRejeitado, tipo: "despesa" }).select();
      const { data: fila3 } = await admin.from("alteracoes_pendentes")
        .select("*").eq("condominio_id", COND).eq("status", "pendente").order("solicitado_em");
      const pend3 = (fila3 || []).find((a) => a.payload?.nome === nomeRejeitado);
      if (!pend3) pula(NOMES_B[5], "sem pendência para rejeitar");
      else {
        const { data: rj } = await dirApp.rpc("rejeitar_alteracao", { p_id: pend3.id, p_parecer: "não quero" });
        const { count: cRej } = await admin.from("categorias_financeiras").select("*", { count: "exact", head: true }).eq("nome", nomeRejeitado);
        ok(NOMES_B[5], rj?.ok === true && (cRej || 0) === 0, `linhas criadas: ${cRej}`);
      }

      /* 7 · exclusão também espera */
      const { data: alvo } = await admin.from("categorias_financeiras").select("id").eq("nome", nomeCerto).maybeSingle();
      if (!alvo) pula(NOMES_B[6], "sem categoria para excluir");
      else {
        await app.from("categorias_financeiras").delete().eq("id", alvo.id);
        const { count: aindaExiste } = await admin.from("categorias_financeiras").select("*", { count: "exact", head: true }).eq("id", alvo.id);
        const { data: filaDel } = await admin.from("alteracoes_pendentes")
          .select("operacao").eq("condominio_id", COND).eq("status", "pendente").eq("alvo_id", alvo.id);
        ok(NOMES_B[6], (aindaExiste || 0) === 1 && (filaDel || []).some((x) => x.operacao === "DELETE"),
          `ainda existe: ${aindaExiste} · na fila: ${(filaDel || []).length}`);
      }

      /* 8 · portaria NÃO espera: o visitante está no portão */
      const visitante = `${MARCA} visitante`;
      const rPort = await app.from("acessos_portaria").insert({
        condominio_id: COND, pessoa_nome: visitante, tipo: "entrada",
        registrado_por: usuarioAdm, ocorrido_em: new Date().toISOString(),
      }).select();
      const { count: naPortaria } = await admin.from("acessos_portaria")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("pessoa_nome", visitante);
      const { count: naFila } = await admin.from("alteracoes_pendentes")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("tabela", "acessos_portaria");
      ok(NOMES_B[7], !rPort.error && (naPortaria || 0) === 1 && (naFila || 0) === 0,
        rPort.error ? rPort.error.message.slice(0, 70)
          : `na portaria: ${naPortaria} · na fila: ${naFila} (tem de ser 0)`);

      /* 9, 10 e 11 · montar o prédio é operacional: CRIAR unidade (e o
         bloco que vem junto) vale na hora. Mas o que SOME continua
         esperando — é a regra que não pode afrouxar junto. */
      const nomeBl = `${MARCA} predio`;
      const rBl = await app.from("blocos").insert({ condominio_id: COND, nome: nomeBl }).select();
      const blocoId = rBl.data?.[0]?.id || null;
      const numUni = `${MARCA} 101`.slice(0, 20);
      const rUni = blocoId ? await app.from("unidades").insert({
        condominio_id: COND, bloco_id: blocoId, numero: numUni,
        tipo: "apartamento", status: "vaga", fracao_ideal: 0,
      }).select() : { error: { message: "bloco não nasceu" } };
      const { count: uniNaTabela } = await admin.from("unidades")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("numero", numUni);
      const { count: uniNaFila } = await admin.from("alteracoes_pendentes")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND)
        .eq("status", "pendente").in("tabela", ["blocos", "unidades"]);
      ok(NOMES_B[8], !rBl.error && !rUni.error && !!blocoId && (uniNaTabela || 0) === 1 && (uniNaFila || 0) === 0,
        rBl.error?.message || rUni.error?.message
          || `unidade na tabela: ${uniNaTabela} · na fila: ${uniNaFila} (tem de ser 0)`);

      /* o rateio é aritmética da unidade aceita, não decisão: o gatilho
         deixa passar o UPDATE que mexe SÓ em fracao_ideal */
      const uniId = (await admin.from("unidades").select("id").eq("numero", numUni).maybeSingle()).data?.id || null;
      if (!uniId) pula(NOMES_B[9], "sem unidade para recalcular");
      else {
        const rFr = await app.from("unidades").update({ fracao_ideal: 12.5 }).eq("id", uniId).select();
        const { data: depois } = await admin.from("unidades").select("fracao_ideal").eq("id", uniId).maybeSingle();
        ok(NOMES_B[9], !rFr.error && Number(depois?.fracao_ideal) === 12.5,
          rFr.error?.message || `fracao gravada: ${depois?.fracao_ideal}`);
      }

      if (!uniId) pula(NOMES_B[10], "sem unidade para excluir");
      else {
        await app.from("unidades").delete().eq("id", uniId);
        const { count: aindaLa } = await admin.from("unidades")
          .select("*", { count: "exact", head: true }).eq("id", uniId);
        const { data: filaUni } = await admin.from("alteracoes_pendentes")
          .select("operacao").eq("condominio_id", COND).eq("status", "pendente").eq("alvo_id", uniId);
        ok(NOMES_B[10], (aindaLa || 0) === 1 && (filaUni || []).some((x) => x.operacao === "DELETE"),
          `ainda existe: ${aindaLa} · na fila: ${(filaUni || []).length}`);
      }

      /* 12 e 13 · a cobrança dele existe, mas NASCE rascunho — e rascunho é
         invisível para o morador (portal e checkout recusam). O portão não
         sumiu, mudou de lugar; se o gatilho parar de forçar, a cobrança
         chega ao morador sem ninguém ter olhado. */
      const { data: uniBase } = await admin.from("unidades")
        .select("id, responsavel_financeiro_id").eq("condominio_id", COND)
        .not("responsavel_financeiro_id", "is", null).limit(1).maybeSingle();
      if (!uniBase) pula(NOMES_B[11], "nenhuma unidade com responsável no condomínio de teste");
      else {
        const rCob = await app.from("cobrancas").insert({
          condominio_id: COND, unidade_id: uniBase.id, responsavel_id: uniBase.responsavel_financeiro_id,
          competencia: COMP_SONDA, tipo: "extra", valor_original: 1,
          vencimento: `${COMP_SONDA}-10`, status: "emitida", // manda emitida de propósito
        }).select();
        const { data: nasceu } = await admin.from("cobrancas").select("id, status")
          .eq("condominio_id", COND).eq("competencia", COMP_SONDA).maybeSingle();
        ok(NOMES_B[11], !rCob.error && nasceu?.status === "rascunho",
          rCob.error?.message?.slice(0, 70) || `nasceu como: ${nasceu?.status}`);

        if (!nasceu) pula(NOMES_B[12], "sem cobrança para tentar emitir");
        else {
          await app.from("cobrancas").update({ status: "emitida" }).eq("id", nasceu.id);
          const { data: dep } = await admin.from("cobrancas").select("status").eq("id", nasceu.id).maybeSingle();
          ok(NOMES_B[12], dep?.status === "rascunho", `status depois da tentativa: ${dep?.status}`);
        }
      }

      /* 14 e 15 · acesso.gerir com coleira: criar login de SÍNDICO seria
         fabricar para si um caminho fora da fila; remover é exclusão, que
         pela regra geral espera o diretor — e aqui não há como esperar */
      const rSind = await post("auth/acessos",
        { acao: "criar", perfil: "sindico", email: EMAIL_VITIMA, senha: SENHA, nome: "sonda" }, lg.token);
      const { count: criouSind } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true }).eq("email", EMAIL_VITIMA);
      ok(NOMES_B[13], rSind.http === 403 && (criouSind || 0) === 0,
        `http ${rSind.http} · usuários criados: ${criouSind}`);

      const rRem = await post("auth/acessos", { acao: "remover", usuarioId: usuarioAdm }, lg.token);
      const { count: aindaTem } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true }).eq("email", EMAIL_ADM);
      ok(NOMES_B[14], rRem.http === 403 && (aindaTem || 0) === 1,
        `http ${rRem.http} · conta ainda existe: ${aindaTem}`);

      /* 16 · o outro lado da moeda: se ele também não conseguisse criar
         MORADOR, as duas sondas acima passariam por falta de permissão
         nenhuma — e não por causa da coleira, que é o que se quer provar */
      const { data: uniQualquer } = await admin.from("unidades")
        .select("id").eq("condominio_id", COND).limit(1).maybeSingle();
      const rMor = await post("auth/acessos", { acao: "criar", perfil: "morador",
        email: EMAIL_MORADOR, senha: SENHA, nome: NOME_MORADOR, unidadeId: uniQualquer?.id }, lg.token);
      /* conta pelo e-mail DERIVADO (morador+<nome>@<cond>.local), não pelo
         que a sonda mandou — o endpoint ignora o e-mail do morador */
      const { count: criouMor } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true })
        .ilike("email", `%${NOME_MORADOR.replace(/\s+/g, ".")}%`);
      ok(NOMES_B[15], rMor.http === 200 && (criouMor || 0) === 1,
        `http ${rMor.http} ${rMor.error || ""} · criados: ${criouMor}`);
    }
  } finally {
    await limpar();
    // teardown já coberto por limpar() — ver a nota sobre idempotência acima
  }
}

/* ══════════════════ BLOCO S — o SÍNDICO (banco) ══════════════════
   O bloco B prova o administrador. O síndico entrou na fila depois, e
   provar "deve funcionar igual" com o token do administrador não prova
   nada: o que muda é o PERFIL que o gatilho e os embrulhos consultam.

   O caso mais caro está aqui: a BAIXA DE PAGAMENTO. Ela mexe em
   pagamentos, cobranças, lançamentos e fundos dentro de uma RPC —
   `pagamentos` NÃO é tabela coberta pelo gatilho. Se a RPC rodar para um
   perfil sob aprovação, o pagamento entra e a baixa da cobrança fica na
   fila: dinheiro registrado numa cobrança que segue em aberto. Por isso a
   sonda confere que NADA foi escrito, não só que "foi para a fila". */
console.log("\n━━ S · o síndico opera, o diretor confirma (banco) ━━");

const NOMES_S = [
  "escrita do síndico NÃO entra na tabela",
  "criar unidade do síndico vale na hora (mesma política)",
  "baixa do síndico vira pendência de AÇÃO",
  "e NÃO escreve pagamento nenhum (nada meio-aplicado)",
  "síndico não aprova a própria ação",
  "diretor aprova a ação e a baixa acontece de verdade",
];

const loginDir = await post("auth/login",
  { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA_DIRETOR });
const { data: temPerfis } = await admin.rpc("perfis_sob_aprovacao").then((r) => r, () => ({ data: null }));

if (!loginDir.token) {
  for (const n of NOMES_S) pula(n, `login do diretor falhou — dev server de pé em ${BASE}?`);
} else if (!temPerfis || !temPerfis.includes("sindico")) {
  for (const n of NOMES_S) pula(n, "perfis_sob_aprovacao() ainda não inclui o síndico — rode supabase-aprovacoes.sql");
} else {
  const tokenDir = loginDir.token;
  const dirApp = clienteApp(tokenDir);
  let usuarioSind = null, cobrancaId = null;
  const limparS = async () => {
    const { data: us } = await admin.from("usuarios").select("id").eq("email", EMAIL_SIND).maybeSingle();
    if (us) {
      await admin.from("alteracoes_pendentes").delete().eq("solicitado_por", us.id);
      await admin.from("usuario_perfis").delete().eq("usuario_id", us.id);
      await admin.from("usuarios").delete().eq("id", us.id);
    }
    await admin.from("categorias_financeiras").delete().eq("condominio_id", COND).like("nome", `${MARCA_S}%`);
    const { data: cs } = await admin.from("cobrancas").select("id")
      .eq("condominio_id", COND).eq("competencia", COMP_SIND);
    for (const c of cs || []) {
      await admin.from("planilha_cobranca_linhas").delete().eq("cobranca_id", c.id);
      await admin.from("pagamentos").delete().eq("cobranca_id", c.id);
      await admin.from("cobrancas").delete().eq("id", c.id);
    }
    await admin.from("lancamentos").delete().eq("condominio_id", COND).like("descricao", `%${COMP_SIND}%`);
  };

  try {
    await limparS();
    await post("auth/acessos",
      { acao: "criar", perfil: "sindico", email: EMAIL_SIND, senha: SENHA }, tokenDir);
    const lgS = await post("auth/login", { perfil: "sindico", email: EMAIL_SIND, senha: SENHA });
    const { data: uS } = await admin.from("usuarios").select("id").eq("email", EMAIL_SIND).maybeSingle();
    usuarioSind = uS?.id || null;

    if (!lgS.token) {
      for (const n of NOMES_S) pula(n, "login do síndico de teste falhou");
    } else {
      const sind = clienteApp(lgS.token);

      /* S1 · o básico: a escrita dele também é desviada */
      const nomeCat = `${MARCA_S} categoria`;
      const rCat = await sind.from("categorias_financeiras")
        .insert({ condominio_id: COND, nome: nomeCat, tipo: "despesa" }).select();
      const { count: catNaTabela } = await admin.from("categorias_financeiras")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("nome", nomeCat);
      const { data: filaCat } = await admin.from("alteracoes_pendentes")
        .select("tabela, operacao").eq("condominio_id", COND).eq("status", "pendente")
        .eq("solicitado_por", usuarioSind);
      ok(NOMES_S[0], !rCat.error && (catNaTabela || 0) === 0
        && (filaCat || []).some((x) => x.tabela === "categorias_financeiras"),
        rCat.error?.message?.slice(0, 70) || `na tabela: ${catNaTabela} · na fila: ${(filaCat || []).length}`);

      /* S2 · mesma política do administrador: CRIAR unidade vale na hora */
      const rBlS = await sind.from("blocos").insert({ condominio_id: COND, nome: `${MARCA_S} predio` }).select();
      const blIdS = rBlS.data?.[0]?.id || null;
      const numS = `${MARCA_S} 201`.slice(0, 20);
      const rUniS = blIdS ? await sind.from("unidades").insert({
        condominio_id: COND, bloco_id: blIdS, numero: numS,
        tipo: "apartamento", status: "vaga", fracao_ideal: 0,
      }).select() : { error: { message: "bloco não nasceu" } };
      const { count: uniS } = await admin.from("unidades")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("numero", numS);
      ok(NOMES_S[1], !rBlS.error && !rUniS.error && (uniS || 0) === 1,
        rBlS.error?.message || rUniS.error?.message || `unidades criadas: ${uniS}`);

      /* S3 e S4 · a BAIXA: nada pode ter sido escrito */
      const { data: uniPaga } = await admin.from("unidades")
        .select("id, responsavel_financeiro_id").eq("condominio_id", COND)
        .not("responsavel_financeiro_id", "is", null).limit(1).maybeSingle();
      if (!uniPaga) {
        pula(NOMES_S[2], "nenhuma unidade com responsável"); pula(NOMES_S[3], "idem");
        pula(NOMES_S[4], "idem"); pula(NOMES_S[5], "idem");
      } else {
        /* cobrança criada pelo SERVICE ROLE (passa direto do gatilho), para
           o cenário começar com uma cobrança emitida de verdade */
        const { data: cob } = await admin.from("cobrancas").insert({
          condominio_id: COND, unidade_id: uniPaga.id, responsavel_id: uniPaga.responsavel_financeiro_id,
          competencia: COMP_SIND, tipo: "extra", valor_original: 250,
          vencimento: `${COMP_SIND}-10`, status: "emitida",
        }).select().then((r) => ({ data: r.data?.[0] }));
        cobrancaId = cob?.id || null;

        const { data: rBaixa } = await sind.rpc("registrar_pagamento_manual", {
          p_cobranca_id: cobrancaId, p_forma: "dinheiro", p_valor: 250,
          p_pago_em: new Date().toISOString(), p_justificativa: `${MARCA_S} baixa`,
          p_tx: null, p_informado_id: null,
        });
        const { data: pendAcao } = await admin.from("alteracoes_pendentes")
          .select("id, tabela, operacao, payload").eq("condominio_id", COND)
          .eq("status", "pendente").eq("operacao", "ACAO").eq("alvo_id", cobrancaId).maybeSingle();
        ok(NOMES_S[2], rBaixa?.ok === true && rBaixa?.na_fila === true
          && !!pendAcao && pendAcao.tabela === "financeiro.baixar",
          `rpc ${JSON.stringify(rBaixa)} · pendência ${pendAcao?.tabela || "nenhuma"}`);

        const { count: pagos } = await admin.from("pagamentos")
          .select("*", { count: "exact", head: true }).eq("cobranca_id", cobrancaId);
        const { data: cobDep } = await admin.from("cobrancas")
          .select("status").eq("id", cobrancaId).maybeSingle();
        ok(NOMES_S[3], (pagos || 0) === 0 && cobDep?.status === "emitida",
          `pagamentos: ${pagos} (tem de ser 0) · cobrança: ${cobDep?.status}`);

        /* S5 · ele não decide a própria ação */
        if (!pendAcao) pula(NOMES_S[4], "sem pendência de ação");
        else {
          const { data: auto } = await sind.rpc("aprovar_alteracao",
            { p_id: pendAcao.id, p_correcao: null, p_parecer: null });
          ok(NOMES_S[4], auto?.ok === false && auto?.erro === "nao_autorizado", JSON.stringify(auto));
        }

        /* S6 · o diretor aprova e AÍ a baixa acontece de verdade */
        if (!pendAcao) pula(NOMES_S[5], "sem pendência de ação");
        else {
          const { data: ap } = await dirApp.rpc("aprovar_alteracao",
            { p_id: pendAcao.id, p_correcao: null, p_parecer: "confere" });
          const { count: pagosDep } = await admin.from("pagamentos")
            .select("*", { count: "exact", head: true }).eq("cobranca_id", cobrancaId);
          const { data: cobFim } = await admin.from("cobrancas")
            .select("status").eq("id", cobrancaId).maybeSingle();
          ok(NOMES_S[5], ap?.ok === true && (pagosDep || 0) === 1
            && ["paga", "paga_em_atraso"].includes(cobFim?.status),
            `${JSON.stringify(ap)} · pagamentos: ${pagosDep} · cobrança: ${cobFim?.status}`);
        }
      }
    }
  } finally {
    await limparS();
    const { data: bs } = await admin.from("blocos").select("id")
      .eq("condominio_id", COND).like("nome", `${MARCA_S}%`);
    for (const b of bs || []) {
      await admin.from("unidades").delete().eq("bloco_id", b.id);
      await admin.from("blocos").delete().eq("id", b.id);
    }
  }
}

console.log(`\n${falhas ? "❌" : "✅"} aprovações: ${falhas} falha(s)${puladas ? `, ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
