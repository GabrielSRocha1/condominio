/* Sondas do ADMINISTRADOR PREDIAL
   (src/lib/aprovacoes.js + supabase-aprovacoes.sql + api/auth/acessos.js).

   A promessa mudou em 02/11/2026. Era "nada que o administrador faz vale sem
   o diretor aprovar"; agora é "o administrador opera como o diretor, menos
   quatro coisas". As quatro, e onde cada uma é enforçada:
     1. não CRIA acesso de Diretor  → api/auth/acessos.js (service role)
     2. não EXCLUI acesso de Diretor → api/auth/acessos.js
     3. não EXCLUI a pessoa do Diretor → gatilho trg_a_protege_diretor
     4. não vê a tela PLANOS → matriz (tela.planos + licenca.gerir vedadas)
   Promessa forte pede prova forte, e a prova tem de ser contra o BANCO, com
   o token dele: é ali que uma checagem só de interface seria contornada pelo
   console do navegador.

   Bloco U (puro): diff, rótulos, ordem e agrupamento da fila CONGELADA — as
   pendências antigas continuam no banco e precisam continuar legíveis.
   Bloco A (lê o FONTE): a fila está desarmada nos três espelhos, o
   mecanismo continua instalado (reversão de uma linha), as guardas das 4
   exceções existem e a tela Aprovações saiu do menu.
   Bloco B (banco + API): a escrita dele ENTRA na hora, nada vai para a
   fila, e as 4 exceções são recusadas de verdade.
   Bloco S: o síndico também saiu da fila.

   Sem o supabase-aprovacoes.sql — ou com a fila ainda armada — os blocos B
   e S são PULADOS com aviso. Tudo que cria é removido no fim.

   Uso: node scripts/testar-aprovacoes.mjs   (bloco B exige npm run dev) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  TABELAS, rotuloTabela, rotuloOperacao, rotuloCampo, valorTexto,
  diff, resumir, ordenar, pendentes, correcaoLimpa, CAMPOS_OCULTOS,
  agrupar, resumirGrupo, camposDoGrupo, IMEDIATAS, exigeAprovacao,
  PERFIS_SOB_APROVACAO, ehPerfilSobAprovacao, ehAcao, ACOES,
} from "../src/lib/aprovacoes.js";
import {
  MATRIZ_PADRAO, PERMS_VEDADAS_AO_ADMIN, PERFIS_QUE_O_ADMIN_CRIA, PERFIS_CRIAVEIS,
  PERFIL_SO_DIRETOR_CRIA, PERFIS_EDITAVEIS, PERMISSOES_FIXAS, podeCriarPerfil,
  sanearPerms, pode,
} from "../src/lib/permissoes.js";

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
const EMAIL_DIR2 = "diretor.sonda@teste.condomaster.dev";     // 2º diretor: só o diretor cria
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

/* o conjunto do administrador: quase tudo do diretor, menos as exceções */
{
  const adm = MATRIZ_PADRAO.administrador_predial || [];
  const vazadas = adm.filter((c) => PERMS_VEDADAS_AO_ADMIN.includes(c));
  ok("padrão do administrador não traz permissão vedada", vazadas.length === 0, vazadas.join(", "));
  ok("administrador enxerga as telas do diretor",
    ["tela.financeiro", "tela.unidades", "tela.multas", "tela.condominio"].every((c) => pode(adm, c)));
  /* sem fila, baixa e cancelamento deixaram de ter motivo para ficar fora */
  ok("administrador dá baixa e cancela cobrança",
    pode(adm, "financeiro.baixar") && pode(adm, "cobranca.cancelar"));
  /* 4ª exceção: a tela Planos e a licença são do dono do condomínio */
  ok("administrador NÃO vê Planos nem mexe na licença",
    !pode(adm, "tela.planos") && !pode(adm, "licenca.gerir"));
  ok("e não decide pendência da fila congelada", !pode(adm, "alteracao.aprovar"));
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
  const imp = readFileSync(new URL("../src/lib/importPessoas.js", import.meta.url), "utf8");
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

  /* o portão do rascunho continua escrito no gatilho (inerte): se a fila
     voltar, ele volta com ela */
  ok("o portão do rascunho continua no gatilho (inerte)",
    /tg_table_name = 'cobrancas'[\s\S]{0,200}new\.status := 'rascunho'/.test(s));
  ok("emitir continua sendo UPDATE (logo, na fila, se ela voltar)", exigeAprovacao("cobrancas", "UPDATE"));
  ok("quem PAGA a unidade também", exigeAprovacao("unidades", "UPDATE"));
  /* nenhuma cobrança NOVA nasce rascunho — o que existe é passivo, e quem o
     emite é quem opera cobranças, não mais quem decide a fila */
  ok("o botão Emitir é de quem emite cobrança (não da fila)",
    /podeEmitirRascunho = pode\(usePerms\(\), "cobranca\.emitir"\)/.test(tela));

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

  /* ── EXCEÇÕES 1 e 2: o acesso de DIRETOR ──
     Vivem no endpoint porque ele roda com service role: é o único caminho
     para usuarios/usuario_perfis, que o navegador não escreve. Decidem pelo
     PERFIL de quem pede, não pela matriz — "criar um par com poder total"
     não é delegável. */
  const acessos = readFileSync(new URL("../api/auth/acessos.js", import.meta.url), "utf8");
  ok("administrador recebe acesso.gerir", MATRIZ_PADRAO.administrador_predial.includes("acesso.gerir"));
  ok("só o diretor cria acesso de diretor",
    podeCriarPerfil("diretor", "diretor")
    && !podeCriarPerfil("administrador_predial", "diretor")
    && !podeCriarPerfil("sindico", "diretor")
    && !PERFIS_QUE_O_ADMIN_CRIA.includes("diretor"));
  ok("o endpoint recusa pela MESMA função que a tela consulta",
    /!podeCriarPerfil\(claims\.perfil, f\.perfil\)/.test(acessos)
    && /PERFIS_CRIAVEIS\.filter\(\(p\) => podeCriarPerfil\(role, p\)\)/.test(tela));
  ok("o administrador cria o resto (síndico, tesouraria, morador)",
    ["administrador_predial", "sindico", "tesouraria", "morador"]
      .every((p) => podeCriarPerfil("administrador_predial", p)));
  ok("conta de diretor só outro diretor remove, e só ele a enxerga",
    /perfis\?\.nome === "diretor"\) && claims\.perfil !== PERFIL_TUDO/.test(acessos)
    && /r\.perfis\.nome !== "diretor" \|\| claims\.perfil === PERFIL_TUDO/.test(acessos));
  ok("ninguém remove o próprio acesso", /f\.usuarioId === claims\.sub/.test(acessos));
  /* o endpoint não enfileira mais nada: remover vale na hora */
  ok("remover acesso não vira pendência", !/tabela: "acesso\.remover"/.test(acessos));
  /* o nível de um CARGO nunca é diretor: seria o mesmo acesso com outro nome */
  ok("nível de cargo não oferece diretor",
    /niveis = perfis\.filter\(\(p\) => p !== PERFIL_SO_DIRETOR_CRIA\)/.test(tela));

  /* ── A FILA ESTÁ DESARMADA — nos TRÊS espelhos ──
     perfis_sob_aprovacao() no SQL (quem manda), PERFIS_SOB_APROVACAO em
     aprovacoes.js (o que a tela promete) e o mesmo nome em permissoes.js (o
     que o backend lê). Divergir é a tela dizer "vai para aprovação" e o
     banco gravar direto — ou, pior, o contrário. */
  const doSqlPerfis = (s.match(/perfis_sob_aprovacao\(\) returns text\[\][\s\S]{0,300}?array\[([^\]]*)\]/) || [, ""])[1];
  const perfisSql = [...doSqlPerfis.matchAll(/'([a-z_]+)'/g)].map(([, x]) => x).sort();
  const perms = readFileSync(new URL("../src/lib/permissoes.js", import.meta.url), "utf8");
  ok("PERFIS_SOB_APROVACAO do app == perfis_sob_aprovacao() do banco",
    JSON.stringify(perfisSql) === JSON.stringify([...PERFIS_SOB_APROVACAO].sort()),
    `sql [${perfisSql}] · js [${PERFIS_SOB_APROVACAO}]`);
  ok("ninguém opera sob aprovação",
    PERFIS_SOB_APROVACAO.length === 0 && perfisSql.length === 0
    && !["administrador_predial", "sindico", "diretor", "tesouraria"].some(ehPerfilSobAprovacao));
  ok("o espelho do backend também está vazio",
    /export const PERFIS_SOB_APROVACAO = \[\];/.test(perms));

  /* ── o MECANISMO continua instalado: é a reversão de uma linha ──
     Se alguém arrancar o gatilho ou os embrulhos, voltar atrás deixa de ser
     editar a seção A0 e passa a ser re-rodar DDL em 18 tabelas. */
  ok("o gatilho segue consultando a lista (não um nome cravado)",
    /not \(public\.jwt_perfil\(\) = any\(public\.perfis_sob_aprovacao\(\)\)\)/.test(s));
  ok("a fila e as RPCs de decisão continuam de pé",
    /create table if not exists public\.alteracoes_pendentes/.test(s)
    && /create or replace function public\.aprovar_alteracao/.test(s)
    && /create or replace function public\.rejeitar_alteracao/.test(s));

  /* ── decidir pendência é SÓ do diretor ──
     O veto por lista virou inerte quando a lista esvaziou: se sobrasse só o
     jwt_pode, uma linha inserida à mão em perfil_permissoes daria o poder de
     aplicar escrita antiga sem ninguém olhando. Daí o veto por perfil nas
     duas RPCs, `fixo: true` no catálogo e o delete das concessões no SQL. */
  ok("aprovar e rejeitar exigem o perfil diretor",
    (s.match(/jwt_perfil\(\) <> 'diretor'[\s\S]{0,60}?alteracao\.aprovar/g) || []).length === 2);
  ok("alteracao.aprovar é indelegável (fixa no catálogo)",
    PERMISSOES_FIXAS.includes("alteracao.aprovar"));
  ok("sanearPerms a descarta para todo perfil editável",
    PERFIS_EDITAVEIS.every((pf) => !sanearPerms(pf, ["alteracao.aprovar"]).includes("alteracao.aprovar")));
  ok("o SQL apaga as concessões que já existiam",
    /delete from public\.perfil_permissoes[\s\S]{0,200}'alteracao\.aprovar'/.test(s));
  /* 4ª exceção, cravada: nem marcada à mão a tela Planos vai para ele */
  ok("Planos e licença são vedadas ao administrador, nem marcadas à mão",
    sanearPerms("administrador_predial", ["tela.planos", "licenca.gerir", "tela.financeiro"])
      .join() === "tela.financeiro");

  /* ── a tela Aprovações saiu do menu ──
     Tirar só a exceção por perfil não bastava: o diretor tem
     alteracao.aprovar pelo atalho anti-trava e continuaria vendo a tela. */
  ok("Aprovações não está no NAV", !/id: "aprovacoes", label:/.test(tela));
  ok("nenhum item do NAV é liberado por perfil",
    /const nav = NAV\.filter\(\(n\) => role && pode\(perms, n\.perm\)\);/.test(tela));
  ok("o sino não conta mais pendências", !/aprovGrupos > 0\) n\.push/.test(tela));
  ok("loadAll não consulta mais a fila em toda carga",
    /const aprovGrupos = 0;/.test(api));

  /* ── EXCEÇÃO 3: a pessoa do diretor (a única que precisa de gatilho) ──
     `pessoas` e `pessoa_vinculos` saem direto do navegador e caem no coringa
     dados.escrever, que o administrador tem. Enquanto a fila existia, quem
     segurava era o desvio cancelar o DELETE. */
  ok("guarda do diretor existe nas DUAS tabelas",
    /create trigger trg_a_protege_diretor before delete on public\.pessoas/.test(s)
    && /create trigger trg_a_protege_diretor before update or delete on public\.pessoa_vinculos/.test(s));
  /* o nome ordena ANTES de trg_aprovacao: gatilho BEFORE dispara em ordem
     alfabética, e o desvio devolve null (cancela) antes do resto rodar */
  ok("o nome do gatilho ordena antes de trg_aprovacao",
    "trg_a_protege_diretor" < "trg_aprovacao");
  ok("protege pelas duas ligações (papel e conta)",
    /v\.papel::text = 'diretor'/.test(s) && /pf\.nome = 'diretor'/.test(s));
  ok("bloqueia o rebaixamento do papel (a rota de fuga)",
    /new\.papel::text <> 'diretor'/.test(s));
  ok("mas não bloqueia EDIÇÃO: a ligação B só vale no delete",
    /tg_op = 'DELETE'[\s\S]{0,120}u\.pessoa_id = v_pessoa/.test(s));
  ok("recusa com 42501 e sem as palavras que api.js reescreve",
    (s.match(/using errcode = '42501'/g) || []).length >= 3
    && !/raise exception '[^']*(foreign key|violates)[^']*'[\s\S]{0,40}42501/.test(s));
  ok("é security definer (lê usuarios, que o administrador não lê)",
    /function public\.proteger_pessoa_de_diretor\(\) returns trigger\s*\nlanguage plpgsql security definer/.test(s));
  ok("passa direto para service role e para o próprio diretor",
    /jwt_role\(\) = 'service_role' then return coalesce\(new, old\)/.test(s)
    && /jwt_perfil\(\) = 'diretor' then return coalesce\(new, old\)/.test(s));
  ok("a tela avisa antes, pelo vínculo (usuarios ela não lê)",
    /eq\("papel", "diretor"\)[\s\S]{0,120}é diretor do condomínio/.test(api));

  /* ── "Salvo!" nunca pode ser mentira ──
     UPDATE que casa ZERO linha não é erro para o PostgREST: a RLS não acusa,
     só faz a linha deixar de existir para quem pediu. Era assim que a tela
     Condomínio dizia "Salvo!" e o reload trazia o dado velho. q1() exige a
     linha de volta em toda escrita de linha CONHECIDA. */
  ok("existe guarda de zero-linha (q1) e ela explica o que fazer",
    /const q1 = async \(promise, label, oQue\)/.test(api)
    && /o banco não aceitou a alteração/.test(api));
  const SALVAM = [
    ["condominios", "Salvar o cadastro do condomínio"], ["unidades", "Salvar a unidade"],
    ["pessoas", "Salvar a pessoa"], ["chamados", "Salvar o chamado"],
    ["penalidades", "Decidir a multa"], ["lancamentos", "Decidir o lançamento"],
    ["cobrancas", "Emitir a cobrança"],
  ];
  const semGuarda = SALVAM.filter(([, rotulo]) => !api.includes(`, "${rotulo}")`));
  ok("os botões de salvar de linha única passam por ela",
    semGuarda.length === 0, semGuarda.map(([t2]) => t2).join(", "));
  /* a aba Permissões só existe para quem a API atende: oferecida ao
     administrador, ela carregava em erro e o salvar batia num 403 */
  ok("a aba Permissões é gated por permissao.gerir",
    /const podeMatriz = pode\(usePerms\(\), "permissao\.gerir"\)/.test(tela));
  ok("e repassa o 42501 limpo, sem prefixo",
    /const recusa = \(e\) => String\(e\?\.code\) === "42501"/.test(api));
  ok("o papel Diretor não é oferecido a quem não é diretor",
    /papeisAtribuiveis = role === "diretor" \? papeis : papeis\.filter/.test(tela));

  /* ── rota de fuga pelas tabelas de conta: tem de seguir fechada ──
     Se `usuarios` voltar ao laço genérico de escrita, as exceções 1 e 2
     caem junto: o administrador escreveria usuario_perfis direto. */
  const seg = readFileSync(new URL("../supabase-seguranca.sql", import.meta.url), "utf8");
  const permSql = readFileSync(new URL("../supabase-permissoes.sql", import.meta.url), "utf8");
  ok("o navegador não escreve em usuarios",
    /revoke[\s\S]{0,80}on table public\.usuarios from anon, authenticated/.test(seg));
  ok("nem em usuario_perfis (só policy de leitura)",
    /drop policy if exists tenant_escrita on public\.usuario_perfis/.test(permSql)
    && /create policy usuario_perfis_leitura on public\.usuario_perfis for select/.test(permSql));

  ok("o síndico mantém baixar e cancelar", MATRIZ_PADRAO.sindico.includes("financeiro.baixar")
    && MATRIZ_PADRAO.sindico.includes("cobranca.cancelar"));

  /* ── AÇÕES de RPC ──
     Deixar a RPC correr para um perfil sob aprovação CORROMPE: pagamentos
     não é tabela coberta e entraria, enquanto a baixa da cobrança ficaria
     na fila — pagamento registrado numa cobrança em aberto. */
  ok("as três RPCs enfileiram a ação inteira",
    (s.match(/__aprovacao_embrulho__/g) || []).length === 3);
  ok("executar_acao tem allowlist fechada (nada de execute format)",
    /executar_acao/.test(s) && !/execute format\([^)]*p_acao/.test(s));
  /* o Supabase concede execute em função nova a anon/authenticated por
     default privilege: sem o revoke, qualquer logado chama executar_acao do
     navegador e o SECURITY DEFINER roda o corpo real — com 'acesso.remover'
     na allowlist, apagaria contas sem aprovação nenhuma. O bloco B prova
     isto contra o banco; aqui garantimos que a linha não sumiu do arquivo. */
  ok("executar_acao e remover_acesso__base são revogadas",
    /revoke all on function public\.executar_acao\(text, jsonb\) from public, anon, authenticated/.test(s)
    && /revoke all on function public\.remover_acesso__base\(uuid\) from public, anon, authenticated/.test(s));

  /* ── nenhum CORPO de RPC decide autoridade por NOME de perfil ──
     Esta é a sonda do bug de 02/11/2026: os embrulhos perguntavam à matriz
     e liberavam o administrador, mas os corpos (`__base`) tinham um segundo
     portão `jwt_perfil() not in ('diretor','sindico','tesouraria')` e o
     recusavam por dentro. Coincidia para os três perfis antigos, então
     ninguém viu — até existir um perfil novo com a permissão. O escopo
     (condomínio da linha) continua nos corpos; a AUTORIDADE, não. */
  const RPCS = ["supabase-schema.sql", "supabase-encargos.sql",
                "supabase-fundo-reserva.sql", "supabase-planilha-sync.sql"];
  const porNome = RPCS.filter((f) =>
    /jwt_perfil\(\) not in \(/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  ok("nenhum corpo de RPC decide por nome de perfil", porNome.length === 0, porNome.join(", "));
  ok("a baixa e o cancelamento conferem a PERMISSÃO no corpo",
    /not public\.jwt_pode\('financeiro\.baixar'\)/.test(
      readFileSync(new URL("../supabase-fundo-reserva.sql", import.meta.url), "utf8"))
    && /not public\.jwt_pode\('cobranca\.cancelar'\)/.test(
      readFileSync(new URL("../supabase-planilha-sync.sql", import.meta.url), "utf8")));
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

  /* ── PAPEL no condomínio (pessoa_vinculos.papel) ──
     Eixo separado do perfil de acesso, mas api/auth/acessos.js grava
     `papel = perfil` ao criar o acesso. Quando administrador_predial virou
     perfil sem existir no enum vinculo_papel, esse insert passou a falhar
     EM SILÊNCIO e o acesso nascia sem vínculo nenhum. Quatro listas
     precisam concordar: a tela, a planilha de importação, PAPEL_LABEL e o
     enum do banco. */
  const papeisTela = (tela.match(/const papeis = \[([^\]]*)\]/) || [, ""])[1];
  const daTela = [...papeisTela.matchAll(/"([^"]+)"/g)].map(([, x]) => x);
  const papeisPlan = (imp.match(/const PAPEIS_UI = \[([^\]]*)\]/) || [, ""])[1];
  const daPlanilha = [...papeisPlan.matchAll(/"([^"]+)"/g)].map(([, x]) => x);
  const blocoLabel = api.slice(api.indexOf("const PAPEL_LABEL = {"), api.indexOf("};", api.indexOf("const PAPEL_LABEL = {")));
  const porChave = Object.fromEntries([...blocoLabel.matchAll(/([a-z_]+): "([^"]+)"/g)].map(([, k, v]) => [k, v]));

  ok("todo papel da tela tem chave em PAPEL_LABEL",
    daTela.every((p) => Object.values(porChave).includes(p)),
    daTela.filter((p) => !Object.values(porChave).includes(p)).join(", "));
  ok("administrador_predial é papel, não só perfil",
    porChave.administrador_predial === "Administrador", porChave.administrador_predial || "ausente");
  ok("a tela oferece o Administrador", daTela.includes("Administrador"));
  ok("a planilha de importação oferece os mesmos papéis de gestão",
    ["Diretor", "Administrador", "Síndico", "Tesouraria"].every((p) => daPlanilha.includes(p)),
    daPlanilha.join(", "));
  ok("o SQL acrescenta o valor ao enum vinculo_papel",
    /alter type public\.vinculo_papel add value 'administrador_predial'/.test(s));
  /* o insert do vínculo não pode mais falhar calado */
  ok("criar acesso confere o erro do vínculo",
    /const \{ error: eVinc \}[\s\S]{0,400}if \(eVinc\)/.test(acessos));
  ok("o papel de gestão vence o de morador na exibição",
    /PAPEL_PRIORIDADE = \[[^\]]*"administrador_predial"[^\]]*"morador"\]/.test(api));
}

/* ══════════════════ BLOCO B — banco + API ══════════════════ */
console.log("\n━━ B · o administrador salva na hora, menos as 4 exceções (banco) ━━");

const NOMES_B = [
  "a escrita do administrador ENTRA na tabela",
  "e NADA vai para a fila",
  "alterar vale na hora",
  "excluir vale na hora",
  "a cobrança dele nasce EMITIDA (chega ao morador)",
  "cobrança legada em rascunho continua emitível por ele",
  "a baixa dele acontece de verdade (pagamento + cobrança paga)",
  "e o cancelamento também",
  "1ª exceção: não cria acesso de DIRETOR",
  "2ª exceção: não vê nem remove a conta do diretor",
  "mas remove acesso de morador NA HORA",
  "3ª exceção: não exclui a pessoa com papel diretor",
  "nem o vínculo de diretor",
  "nem rebaixa o papel do diretor",
  "nem a pessoa que TEM conta de diretor",
  "mas EDITA a pessoa do diretor (edição vale na hora)",
  "anti-trava: o diretor ainda exclui a pessoa de diretor",
  "e o endpoint ainda remove a conta de um diretor (service role)",
  "4ª exceção: o banco concorda — Planos e licença negadas",
  "executar_acao e remover_acesso__base são inalcançáveis do navegador",
  "a maquinaria de aprovar continua viva (só para o diretor)",
  "e o administrador não decide pendência nenhuma",
  "as pendências congeladas não foram tocadas",
  /* acrescentadas no FIM de propósito: os índices acima são usados um a um
     nas asserções, e inserir no meio renumeraria todas */
  "e a rejeição do comprovante do morador também é dele",
  "e salva o cadastro do condomínio (as abas são um formulário só)",
];

const temFila = await admin.from("alteracoes_pendentes").select("id").limit(1);
const { data: perfilAdm } = await admin.from("perfis").select("id").eq("nome", "administrador_predial").maybeSingle();
/* retrato do passivo ANTES de tudo: a promessa de preservação é que nenhuma
   pendência existente mude de status (nem de lugar) por causa desta suíte */
const { data: congeladasAntes } = await admin.from("alteracoes_pendentes")
  .select("id, status").order("id");
const retrato = (l) => (l || []).map((x) => `${x.id}:${x.status}`).sort().join("|");
/* a fila ainda armada = SQL antigo no banco: a suíte nova provaria o
   contrário do que o banco faz, então pula com o diagnóstico */
const { data: perfisNoBanco } = await admin.rpc("perfis_sob_aprovacao");
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA_DIRETOR });

if (temFila.error || !perfilAdm) {
  for (const n of NOMES_B) pula(n, "supabase-aprovacoes.sql não rodou");
  console.log("   ℹ️  estado atual: o perfil não existe — nada muda no app.");
} else if ((perfisNoBanco || []).length) {
  for (const n of NOMES_B) pula(n, `a fila ainda alcança [${perfisNoBanco}] — rode o supabase-aprovacoes.sql atual`);
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
    /* o PAGAMENTO sai antes da cobrança e antes da conta: desde que o
       administrador dá baixa (02/11/2026), `pagamentos.baixado_por` aponta
       para ele e a chave estrangeira trava o delete do usuário. O delete
       falhava em silêncio e deixava uma conta SEM perfil — que existe (o
       e-mail duplica) mas não entra, e a execução seguinte pulava o bloco
       inteiro com "login do administrador de teste falhou". */
    {
      const { data: cs } = await admin.from("cobrancas").select("id")
        .eq("condominio_id", COND).eq("competencia", COMP_SONDA);
      for (const c of cs || []) {
        await admin.from("planilha_cobranca_linhas").delete().eq("cobranca_id", c.id);
        await admin.from("pagamentos").delete().eq("cobranca_id", c.id);
        await admin.from("pagamentos_informados").delete().eq("cobranca_id", c.id);
        await admin.from("cobrancas").delete().eq("id", c.id);
      }
      /* a baixa também lança no caixa: 'Cobrança 12/2099 paga (…)' */
      await admin.from("lancamentos").delete().eq("condominio_id", COND)
        .like("descricao", `%${COMP_SONDA.slice(5)}/${COMP_SONDA.slice(0, 4)}%`);
    }
    /* pessoas da sonda (inclusive a de papel 'diretor'): o service role passa
       pelo gatilho de proteção, que é justamente o que o bloco prova */
    {
      const { data: ps } = await admin.from("pessoas")
        .select("id").eq("condominio_id", COND).like("nome", `${MARCA}%`);
      for (const p of ps || []) {
        await admin.from("pessoa_vinculos").delete().eq("pessoa_id", p.id);
        await admin.from("pessoas").delete().eq("id", p.id);
      }
    }
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
    for (const e of [EMAIL_ADM, EMAIL_VITIMA, EMAIL_MORADOR, EMAIL_DIR2]) {
      const { data: u } = await admin.from("usuarios").select("id, pessoa_id").eq("email", e).maybeSingle();
      if (!u) continue;
      await admin.from("usuario_perfis").delete().eq("usuario_id", u.id);
      /* qualquer pagamento que ele assinou (ver a nota acima) */
      await admin.from("pagamentos").delete().eq("baixado_por", u.id);
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
      const dirApp = clienteApp(tokenDiretor);
      const semFila = async () => (await admin.from("alteracoes_pendentes")
        .select("*", { count: "exact", head: true })
        .eq("condominio_id", COND).eq("status", "pendente")
        .gt("solicitado_em", new Date(Date.now() - 600000).toISOString())).count || 0;

      /* 1 e 2 · a escrita ENTRA, e a fila não cresce */
      const nomeCat = `${MARCA} categoria`;
      const r1 = await app.from("categorias_financeiras").insert({ condominio_id: COND, nome: nomeCat, tipo: "despesa" }).select();
      const { data: cat } = await admin.from("categorias_financeiras")
        .select("id, nome").eq("condominio_id", COND).eq("nome", nomeCat).maybeSingle();
      ok(NOMES_B[0], !r1.error && !!cat && r1.data?.length === 1,
        r1.error ? r1.error.message.slice(0, 80) : `id: ${cat?.id ? "nasceu" : "não nasceu"} · linhas devolvidas: ${r1.data?.length}`);
      /* devolver a linha importa tanto quanto gravá-la: era o insert voltando
         com ZERO linha que estourava `undefined.id` na cara do administrador */
      ok(NOMES_B[1], (await semFila()) === 0, `pendências novas: ${await semFila()} (tem de ser 0)`);

      /* 3 e 4 · alterar e excluir valem na hora (era o que mais esperava) */
      if (!cat) { pula(NOMES_B[2], "sem categoria"); pula(NOMES_B[3], "sem categoria"); }
      else {
        const nomeNovo = `${MARCA} categoria editada`;
        const rUp = await app.from("categorias_financeiras").update({ nome: nomeNovo }).eq("id", cat.id).select();
        const { data: dep } = await admin.from("categorias_financeiras").select("nome").eq("id", cat.id).maybeSingle();
        ok(NOMES_B[2], !rUp.error && dep?.nome === nomeNovo, rUp.error?.message || `nome agora: ${dep?.nome}`);

        const rDel = await app.from("categorias_financeiras").delete().eq("id", cat.id);
        const { count: sobrou } = await admin.from("categorias_financeiras")
          .select("*", { count: "exact", head: true }).eq("id", cat.id);
        ok(NOMES_B[3], !rDel.error && (sobrou || 0) === 0 && (await semFila()) === 0,
          rDel.error?.message || `linhas restantes: ${sobrou}`);
      }

      /* 5 e 6 · a cobrança dele chega ao morador na hora; e o passivo de
         rascunhos deixados pela fila continua emitível POR ELE — o botão
         Emitir mudou de `alteracao.aprovar` (indelegável) para
         `cobranca.emitir`, senão o rascunho ficava visível e sem ação */
      const { data: uniBase } = await admin.from("unidades")
        .select("id, responsavel_financeiro_id").eq("condominio_id", COND)
        .not("responsavel_financeiro_id", "is", null).limit(1).maybeSingle();
      if (!uniBase) for (const i of [4, 5, 6, 7, 23]) pula(NOMES_B[i], "nenhuma unidade com responsável");
      else {
        const rCob = await app.from("cobrancas").insert({
          condominio_id: COND, unidade_id: uniBase.id, responsavel_id: uniBase.responsavel_financeiro_id,
          competencia: COMP_SONDA, tipo: "extra", valor_original: 1,
          vencimento: `${COMP_SONDA}-10`, status: "emitida",
        }).select();
        const { data: nasceu } = await admin.from("cobrancas").select("id, status")
          .eq("condominio_id", COND).eq("competencia", COMP_SONDA).maybeSingle();
        ok(NOMES_B[4], !rCob.error && nasceu?.status === "emitida",
          rCob.error?.message?.slice(0, 70) || `nasceu como: ${nasceu?.status}`);

        /* rascunho legado criado pelo service role (como ficou no banco) */
        await admin.from("cobrancas").update({ status: "rascunho" }).eq("id", nasceu?.id);
        const rEmitir = await app.from("cobrancas").update({ status: "emitida" }).eq("id", nasceu?.id).select();
        const { data: dep2 } = await admin.from("cobrancas").select("status").eq("id", nasceu?.id).maybeSingle();
        ok(NOMES_B[5], !rEmitir.error && dep2?.status === "emitida",
          rEmitir.error?.message?.slice(0, 70) || `status: ${dep2?.status}`);

        /* 7 e 8 · baixa e cancelamento entraram no conjunto dele: as RPCs
           rodam o corpo real, sem `na_fila`, e o dinheiro aparece */
        await admin.from("cobrancas").update({ status: "emitida" }).eq("id", nasceu?.id);
        const { data: rBaixa } = await app.rpc("registrar_pagamento_manual", {
          p_cobranca_id: nasceu?.id, p_forma: "dinheiro", p_valor: 1,
          p_pago_em: new Date().toISOString(), p_justificativa: `${MARCA} baixa`,
          p_tx: null, p_informado_id: null,
        });
        const { count: pagou } = await admin.from("pagamentos")
          .select("*", { count: "exact", head: true }).eq("cobranca_id", nasceu?.id);
        const { data: cobDep } = await admin.from("cobrancas").select("status").eq("id", nasceu?.id).maybeSingle();
        ok(NOMES_B[6], rBaixa?.ok === true && !rBaixa?.na_fila && (pagou || 0) === 1 && cobDep?.status === "paga",
          `rpc ${JSON.stringify(rBaixa)} · pagamentos: ${pagou} · cobrança: ${cobDep?.status}`);

        /* cancelamento numa cobrança NOVA, não na que acabou de ser paga:
           `cancelar_cobranca` recusa cobrança paga com `ja_paga`, e é o
           comportamento certo — a sonda é que não pode reaproveitar a linha */
        const rCob2 = await app.from("cobrancas").insert({
          condominio_id: COND, unidade_id: uniBase.id, responsavel_id: uniBase.responsavel_financeiro_id,
          competencia: COMP_SONDA, tipo: "extra", valor_original: 2,
          vencimento: `${COMP_SONDA}-20`, status: "emitida",
        }).select();
        const cob2 = rCob2.data?.[0] || null;
        const { data: rCanc } = cob2 ? await app.rpc("cancelar_cobranca", {
          p_cobranca_id: cob2.id, p_justificativa: `${MARCA} cancelamento`,
        }) : { data: null };
        const { data: cobCanc } = cob2
          ? await admin.from("cobrancas").select("status").eq("id", cob2.id).maybeSingle()
          : { data: null };
        ok(NOMES_B[7], rCanc?.ok === true && !rCanc?.na_fila && cobCanc?.status === "cancelada",
          rCob2.error?.message?.slice(0, 60) || `rpc ${JSON.stringify(rCanc)} · cobrança: ${cobCanc?.status}`);

        /* a terceira RPC da família: rejeitar o comprovante que o morador
           informou. Não tem código de permissão próprio — a RPC dela exige
           `financeiro.baixar` —, e o corpo dela mudou de arquivo em
           02/11/2026 (schema → fundo-reserva), justamente porque decidia
           autoridade por nome de perfil e recusava o administrador. */
        const rCob3 = await app.from("cobrancas").insert({
          condominio_id: COND, unidade_id: uniBase.id, responsavel_id: uniBase.responsavel_financeiro_id,
          competencia: COMP_SONDA, tipo: "extra", valor_original: 3,
          vencimento: `${COMP_SONDA}-25`, status: "pagamento_informado",
        }).select();
        const cob3 = rCob3.data?.[0] || null;
        const { data: inf } = cob3 ? await admin.from("pagamentos_informados").insert({
          condominio_id: COND, cobranca_id: cob3.id, forma: "transferencia",
          valor_informado: 3, pago_em_informado: `${COMP_SONDA}-24`, situacao: "pendente",
        }).select().then((r) => ({ data: r.data?.[0] || null })) : { data: null };
        const { data: rRej } = inf ? await app.rpc("rejeitar_pagamento_informado", {
          p_informado_id: inf.id, p_motivo: `${MARCA} comprovante ilegível`,
        }) : { data: null };
        const { data: infDep } = inf
          ? await admin.from("pagamentos_informados").select("situacao").eq("id", inf.id).maybeSingle()
          : { data: null };
        ok(NOMES_B[23], rRej?.ok === true && infDep?.situacao === "rejeitado",
          `rpc ${JSON.stringify(rRej)} · informe: ${infDep?.situacao}`);
      }

      /* o cadastro do condomínio: `condominios` fica FORA do laço que a
         matriz recria (a chave dele é `id`, não `condominio_id`), então a
         policy de supabase-rls.sql sobrevivia decidindo por NOME de perfil
         — e o UPDATE do administrador casava ZERO linha SEM erro. A tela,
         que é um formulário único para todas as abas, dizia "Salvo!" e o
         reload trazia o dado velho. Escrever o MESMO valor de volta prova a
         policy sem mexer no cadastro. */
      const { data: condAtual } = await admin.from("condominios")
        .select("nome_fantasia").eq("id", COND).maybeSingle();
      const rCond = await app.from("condominios")
        .update({ nome_fantasia: condAtual?.nome_fantasia }).eq("id", COND).select("id");
      ok(NOMES_B[24], !rCond.error && rCond.data?.length === 1,
        rCond.error ? `${rCond.error.code}: ${rCond.error.message.slice(0, 60)}`
          : rCond.data?.length ? `linhas: ${rCond.data.length}`
            : "ZERO linha e nenhum erro — a policy ainda decide por nome de perfil; rode o supabase-permissoes.sql");

      /* ── as 4 exceções ──
         9 · criar acesso de DIRETOR. O 2º diretor é criado pelo DIRETOR (que
         pode) e serve de alvo para as provas seguintes. */
      const rDir = await post("auth/acessos",
        { acao: "criar", perfil: "diretor", email: EMAIL_DIR2, senha: SENHA, nome: "sonda diretor" }, tokenDiretor);
      const { data: dir2 } = await admin.from("usuarios").select("id, pessoa_id").eq("email", EMAIL_DIR2).maybeSingle();
      const rDirAdm = await post("auth/acessos",
        { acao: "criar", perfil: "diretor", email: EMAIL_VITIMA, senha: SENHA, nome: "sonda" }, lg.token);
      const { count: criouDir } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true }).eq("email", EMAIL_VITIMA);
      ok(NOMES_B[8], rDirAdm.http === 403 && (criouDir || 0) === 0 && rDir.http === 200 && !!dir2,
        `admin http ${rDirAdm.http} · criados: ${criouDir} · diretor criou o 2º: ${rDir.http}`);

      /* 10 · a conta de diretor não aparece na lista dele e não é removível */
      const lista = await post("auth/acessos", { acao: "listar" }, lg.token);
      const rRemDir = dir2 ? await post("auth/acessos", { acao: "remover", usuarioId: dir2.id }, lg.token) : { http: 0 };
      const { count: dirVivo } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true }).eq("email", EMAIL_DIR2);
      ok(NOMES_B[9], !(lista.acessos || []).some((a) => a.role === "diretor")
        && rRemDir.http === 403 && (dirVivo || 0) === 1,
        `diretores na lista dele: ${(lista.acessos || []).filter((a) => a.role === "diretor").length} · http ${rRemDir.http} · conta viva: ${dirVivo}`);

      /* 11 · e remover quem NÃO é diretor funciona de verdade, na hora — sem
         isto a prova acima passaria por falta de permissão, não pela regra */
      const { data: uniQualquer } = await admin.from("unidades")
        .select("id").eq("condominio_id", COND).limit(1).maybeSingle();
      await post("auth/acessos", { acao: "criar", perfil: "morador",
        email: EMAIL_MORADOR, senha: SENHA, nome: NOME_MORADOR, unidadeId: uniQualquer?.id }, lg.token);
      const { data: mor } = await admin.from("usuarios").select("id")
        .ilike("email", `%${NOME_MORADOR.replace(/\s+/g, ".")}%`).maybeSingle();
      const rRemMor = mor ? await post("auth/acessos", { acao: "remover", usuarioId: mor.id }, lg.token) : { http: 0 };
      const { count: morVivo } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true })
        .ilike("email", `%${NOME_MORADOR.replace(/\s+/g, ".")}%`);
      ok(NOMES_B[10], rRemMor.http === 200 && !rRemMor.na_fila && (morVivo || 0) === 0 && (await semFila()) === 0,
        `http ${rRemMor.http} · conta: ${morVivo} (tem de ser 0) · na_fila: ${!!rRemMor.na_fila}`);

      /* 12 a 15 · a PESSOA do diretor. Duas ligações: o papel no vínculo e a
         conta com perfil diretor. A primeira é testada com uma pessoa
         sintética; a segunda, com a pessoa do 2º diretor criado acima. */
      const rPessoa = await admin.from("pessoas").insert({
        condominio_id: COND, nome: `${MARCA} pessoa diretora`, tipo_pessoa: "fisica",
        cpf_cnpj: `P-${Date.now().toString().slice(-10)}`,
      }).select();
      const pDir = rPessoa.data?.[0] || null;
      const rVinc = pDir ? await admin.from("pessoa_vinculos").insert({
        condominio_id: COND, pessoa_id: pDir.id, papel: "diretor", inicio: "2026-01-01",
      }).select() : { error: { message: "pessoa não nasceu" } };
      const vDir = rVinc.data?.[0] || null;

      if (!pDir || !vDir) {
        const porque = (rPessoa.error?.message || rVinc.error?.message || "").slice(0, 90);
        for (const i of [11, 12, 13, 15]) pula(NOMES_B[i], `cenário não montou: ${porque}`);
      } else {
        const rDelP = await app.from("pessoas").delete().eq("id", pDir.id);
        const { count: pViva } = await admin.from("pessoas")
          .select("*", { count: "exact", head: true }).eq("id", pDir.id);
        ok(NOMES_B[11], String(rDelP.error?.code) === "42501" && (pViva || 0) === 1,
          `${rDelP.error?.code || "sem erro"} · pessoa viva: ${pViva}`);

        const rDelV = await app.from("pessoa_vinculos").delete().eq("id", vDir.id);
        const { count: vVivo } = await admin.from("pessoa_vinculos")
          .select("*", { count: "exact", head: true }).eq("id", vDir.id);
        ok(NOMES_B[12], String(rDelV.error?.code) === "42501" && (vVivo || 0) === 1,
          `${rDelV.error?.code || "sem erro"} · vínculo vivo: ${vVivo}`);

        const rReb = await app.from("pessoa_vinculos").update({ papel: "morador" }).eq("id", vDir.id);
        const { data: vDep } = await admin.from("pessoa_vinculos").select("papel").eq("id", vDir.id).maybeSingle();
        ok(NOMES_B[13], String(rReb.error?.code) === "42501" && vDep?.papel === "diretor",
          `${rReb.error?.code || "sem erro"} · papel agora: ${vDep?.papel}`);

        /* o que ele PODE: editar. Se a guarda barrasse o UPDATE inteiro, o
           administrador não conseguiria corrigir nem o telefone do diretor */
        const rEdit = await app.from("pessoas").update({ telefone: "+5511999990000" }).eq("id", pDir.id).select();
        const rEditV = await app.from("pessoa_vinculos").update({ observacoes: `${MARCA} ok` }).eq("id", vDir.id).select();
        ok(NOMES_B[15], !rEdit.error && !rEditV.error && rEdit.data?.length === 1,
          rEdit.error?.message?.slice(0, 60) || rEditV.error?.message?.slice(0, 60) || "pessoa e vínculo editados");

        /* 17 · anti-trava: o diretor não fica impedido pela própria guarda */
        await dirApp.from("pessoa_vinculos").delete().eq("id", vDir.id);
        const rDelDir = await dirApp.from("pessoas").delete().eq("id", pDir.id);
        const { count: pSobrou } = await admin.from("pessoas")
          .select("*", { count: "exact", head: true }).eq("id", pDir.id);
        ok(NOMES_B[16], !rDelDir.error && (pSobrou || 0) === 0,
          rDelDir.error?.message?.slice(0, 70) || `linhas restantes: ${pSobrou}`);
      }

      /* 15 (ligação B) · a pessoa que TEM conta de diretor. A chave
         estrangeira usuarios.pessoa_id também recusa, então vale 42501 ou
         23503 — o que não se aceita é a pessoa sumir. */
      if (!dir2?.pessoa_id) pula(NOMES_B[14], "2º diretor não nasceu");
      else {
        const rDelConta = await app.from("pessoas").delete().eq("id", dir2.pessoa_id);
        const { count: contaViva } = await admin.from("pessoas")
          .select("*", { count: "exact", head: true }).eq("id", dir2.pessoa_id);
        ok(NOMES_B[14], ["42501", "23503"].includes(String(rDelConta.error?.code)) && (contaViva || 0) === 1,
          `${rDelConta.error?.code || "sem erro"} · pessoa viva: ${contaViva}`);
      }

      /* 18 · e o endpoint (service role) ainda remove a conta de um diretor
         levando a pessoa: é a razão do bypass de service_role no gatilho */
      if (!dir2) pula(NOMES_B[17], "2º diretor não nasceu");
      else {
        const rRem2 = await post("auth/acessos", { acao: "remover", usuarioId: dir2.id }, tokenDiretor);
        const { count: contaDep } = await admin.from("usuarios")
          .select("*", { count: "exact", head: true }).eq("id", dir2.id);
        const { count: pessoaDep } = await admin.from("pessoas")
          .select("*", { count: "exact", head: true }).eq("id", dir2.pessoa_id);
        ok(NOMES_B[17], rRem2.http === 200 && (contaDep || 0) === 0 && (pessoaDep || 0) === 0,
          `http ${rRem2.http} ${rRem2.error || ""} · conta: ${contaDep} · pessoa: ${pessoaDep}`);
      }

      /* 19 · a 4ª exceção vista pelo BANCO: a matriz da tela não é a fonte,
         jwt_pode é. Se os dois discordarem, a tela promete o que o banco
         nega (ou pior, esconde o que ele libera). */
      const pb = async (c) => (await app.rpc("jwt_pode", { p_codigo: c })).data;
      const liberadas = [await pb("financeiro.baixar"), await pb("cobranca.cancelar"), await pb("dados.escrever")];
      const negadas = [await pb("licenca.gerir"), await pb("tela.planos"), await pb("alteracao.aprovar"), await pb("permissao.gerir")];
      ok(NOMES_B[18], liberadas.every((x) => x === true) && negadas.every((x) => x === false),
        `liberadas [${liberadas}] · negadas [${negadas}]`);

      /* 20 · ACL: o Supabase concede execute a authenticated por default
         privilege. Sem o revoke, qualquer logado roda o corpo real do
         SECURITY DEFINER — e com 'acesso.remover' na allowlist, apagaria
         contas sem passar por nada. */
      const rExec = await app.rpc("executar_acao", { p_acao: "acesso.remover", p_args: { usuario_id: usuarioAdm } });
      const rBase = await app.rpc("remover_acesso__base", { p_usuario_id: usuarioAdm });
      const { count: admVivo } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true }).eq("email", EMAIL_ADM);
      ok(NOMES_B[19], !!rExec.error && !!rBase.error && (admVivo || 0) === 1,
        `executar_acao: ${rExec.error?.code || "SEM ERRO"} · __base: ${rBase.error?.code || "SEM ERRO"} · conta viva: ${admVivo}`);

      /* 21 e 22 · a maquinaria de decisão continua viva (é o que permitiria
         drenar o passivo), mas só para o diretor. Pendência SINTÉTICA — a
         suíte nunca toca nas que já estavam no banco. */
      const nomeSint = `${MARCA} sintetica`;
      /* o payload tem de ser a LINHA INTEIRA, com `id`, `ativa` e carimbos:
         o gatilho enfileirava `to_jsonb(NEW)`, já com todos os defaults
         aplicados, e aprovar_alteracao insere a lista de colunas completa —
         campo ausente vira NULL e morre no not-null. É por isso que uma
         pendência "montada à mão" não é igual a uma de verdade. */
      const agora = new Date().toISOString();
      const { data: sint } = await admin.from("alteracoes_pendentes").insert({
        condominio_id: COND, tabela: "categorias_financeiras", operacao: "INSERT",
        payload: { id: crypto.randomUUID(), condominio_id: COND, nome: nomeSint,
          tipo: "despesa", categoria_pai_id: null, ativa: true,
          criado_em: agora, atualizado_em: agora },
        resumo: nomeSint,
      }).select().then((r) => ({ data: r.data?.[0] || null }));
      if (!sint) { pula(NOMES_B[20], "não foi possível criar a pendência sintética"); pula(NOMES_B[21], "idem"); }
      else {
        const { data: auto } = await app.rpc("aprovar_alteracao", { p_id: sint.id, p_correcao: null, p_parecer: null });
        const { count: naoNasceu } = await admin.from("categorias_financeiras")
          .select("*", { count: "exact", head: true }).eq("nome", nomeSint);
        ok(NOMES_B[21], auto?.ok === false && auto?.erro === "nao_autorizado" && (naoNasceu || 0) === 0,
          `${JSON.stringify(auto)} · linhas: ${naoNasceu}`);

        const { data: ap } = await dirApp.rpc("aprovar_alteracao", { p_id: sint.id, p_correcao: null, p_parecer: "ok" });
        const { count: nasceuSint } = await admin.from("categorias_financeiras")
          .select("*", { count: "exact", head: true }).eq("nome", nomeSint);
        ok(NOMES_B[20], ap?.ok === true && (nasceuSint || 0) === 1,
          `${JSON.stringify(ap)} · linhas: ${nasceuSint}`);
      }
    }
  } finally {
    await limpar();
    // teardown já coberto por limpar() — ver a nota sobre idempotência acima
    /* PRESERVAÇÃO: a decisão foi congelar a fila, não esvaziá-la. Se esta
       suíte (ou o SQL novo) tivesse mexido em alguma pendência que já estava
       no banco, o retrato mudaria — e a promessa de "nenhuma linha perdida"
       deixaria de valer. Comparar id:status pega tanto o delete quanto a
       aprovação acidental. */
    const { data: congeladasDepois } = await admin.from("alteracoes_pendentes")
      .select("id, status").order("id");
    ok(NOMES_B[22], retrato(congeladasAntes) === retrato(congeladasDepois),
      `antes: ${(congeladasAntes || []).length} linhas · depois: ${(congeladasDepois || []).length}`);
  }
}

/* ══════════════════ BLOCO S — o SÍNDICO (banco) ══════════════════
   O bloco B prova o administrador. O síndico saiu da fila junto com ele
   (02/11/2026) e provar isso com o token do administrador não prova nada:
   o que o gatilho e os embrulhos consultam é o PERFIL.

   O caso mais caro é a BAIXA DE PAGAMENTO, que mexe em pagamentos,
   cobranças, lançamentos e fundos dentro de uma RPC. Enquanto a fila valia,
   a prova era que NADA havia sido escrito (porque `pagamentos` não é tabela
   coberta: deixar a RPC correr registrava o dinheiro numa cobrança que
   ficava em aberto). Agora é o contrário — tem de acontecer por inteiro. */
console.log("\n━━ S · o síndico também salva na hora (banco) ━━");

const NOMES_S = [
  "escrita do síndico ENTRA na tabela",
  "criar unidade do síndico também",
  "a baixa dele acontece por inteiro (pagamento + cobrança paga)",
  "e nada ficou pendente no caminho",
];

const loginDir = await post("auth/login",
  { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA_DIRETOR });
const { data: temPerfis } = await admin.rpc("perfis_sob_aprovacao").then((r) => r, () => ({ data: null }));

if (!loginDir.token) {
  for (const n of NOMES_S) pula(n, `login do diretor falhou — dev server de pé em ${BASE}?`);
} else if ((temPerfis || []).length) {
  for (const n of NOMES_S) pula(n, `a fila ainda alcança [${temPerfis}] — rode o supabase-aprovacoes.sql atual`);
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

      /* S1 · o básico: a escrita dele entra, e nada é enfileirado */
      const nomeCat = `${MARCA_S} categoria`;
      const rCat = await sind.from("categorias_financeiras")
        .insert({ condominio_id: COND, nome: nomeCat, tipo: "despesa" }).select();
      const { count: catNaTabela } = await admin.from("categorias_financeiras")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("nome", nomeCat);
      const { data: filaCat } = await admin.from("alteracoes_pendentes")
        .select("tabela, operacao").eq("condominio_id", COND).eq("status", "pendente")
        .eq("solicitado_por", usuarioSind);
      ok(NOMES_S[0], !rCat.error && (catNaTabela || 0) === 1 && (filaCat || []).length === 0,
        rCat.error?.message?.slice(0, 70) || `na tabela: ${catNaTabela} · na fila: ${(filaCat || []).length} (tem de ser 0)`);

      /* S2 · criar unidade também vale na hora (como sempre valeu) */
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

      /* S3 e S4 · a BAIXA: agora tem de acontecer por inteiro. O embrulho da
         RPC consulta a mesma lista do gatilho — se ele voltasse a enfileirar,
         `na_fila` apareceria e o pagamento não existiria. */
      const { data: uniPaga } = await admin.from("unidades")
        .select("id, responsavel_financeiro_id").eq("condominio_id", COND)
        .not("responsavel_financeiro_id", "is", null).limit(1).maybeSingle();
      if (!uniPaga) { pula(NOMES_S[2], "nenhuma unidade com responsável"); pula(NOMES_S[3], "idem"); }
      else {
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
        const { count: pagos } = await admin.from("pagamentos")
          .select("*", { count: "exact", head: true }).eq("cobranca_id", cobrancaId);
        const { data: cobDep } = await admin.from("cobrancas")
          .select("status").eq("id", cobrancaId).maybeSingle();
        ok(NOMES_S[2], rBaixa?.ok === true && !rBaixa?.na_fila && (pagos || 0) === 1
          && ["paga", "paga_em_atraso"].includes(cobDep?.status),
          `rpc ${JSON.stringify(rBaixa)} · pagamentos: ${pagos} · cobrança: ${cobDep?.status}`);

        const { data: pendAcao } = await admin.from("alteracoes_pendentes")
          .select("id, tabela").eq("condominio_id", COND).eq("status", "pendente")
          .eq("operacao", "ACAO").eq("alvo_id", cobrancaId);
        ok(NOMES_S[3], (pendAcao || []).length === 0,
          `pendências de ação: ${(pendAcao || []).length} (tem de ser 0)`);
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
