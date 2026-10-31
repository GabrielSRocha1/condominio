/* Sondas da MATRIZ DE PERMISSÕES (src/lib/permissoes.js + supabase-permissoes.sql).

   Prova que a matriz é a autoridade nas TRÊS camadas e que as três não
   divergem — porque divergência aqui é a pior falha possível: a UI
   prometendo o que o banco nega, ou pior, o banco liberando o que a UI
   esconde (foi exatamente esse o estado anterior, com a tesouraria podendo
   escrever em `penalidades` sem nunca ter a tela).

   Bloco U (puro, sem banco e sem servidor):
     catálogo, padrão por perfil, resolução do override e PARIDADE com o
     SQL e com o NAV (lidos dos arquivos, não reescritos aqui).
   Bloco B (banco + API, exige `npm run dev`):
     semeadura, policies, gatilhos de aprovação, blindagem da própria
     matriz e a RPC de baixa.

   Sem o supabase-permissoes.sql, o bloco B é PULADO com aviso e o estado
   anterior (mais frouxo) aparece de propósito — evidência do antes/depois.
   Tudo que cria é removido no fim.

   Uso: node scripts/testar-permissoes.mjs   (bloco B exige npm run dev) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  PERMISSOES, CODIGOS, MATRIZ_PADRAO, PERMISSAO_DA_TABELA, ESCRITA_PADRAO,
  PERMISSOES_FIXAS, PERFIS_EDITAVEIS, PERMS_DO_MORADOR,
  permsPadrao, permsEfetivas, pode, podeTela, sanearPerms, mesmoConjunto,
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
const EMAIL_TES = "tesouraria.perms@teste.condomaster.dev";
const SENHA = "teste12345";                             // conta criada pela sonda
const SENHA_DIRETOR = "teste123";                       // fixture dos manuais
const COMP = "2019-04";                                 // longe das outras sondas

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
/* "negado" tem de ser negado pela POLICY, não por uma constraint quebrada:
   sem isto, um insert mal montado (enum errado, coluna faltando) passaria
   por bloqueio de permissão e a sonda viraria falso positivo — foi
   exatamente o que aconteceu na primeira rodada desta suíte. */
const ehRls = (e) => !!e && (e.code === "42501" || /row-level security/i.test(e.message || ""));
const ehGatilho = (e, trecho) => !!e && new RegExp(trecho, "i").test(e.message || "");
const post = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!r) return { http: 0 };
  return { http: r.status, ...(await r.json().catch(() => ({}))) };
};
const sql = (arquivo) => readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8");

/* ══════════════════ BLOCO U — puro ══════════════════ */
console.log("━━ U · catálogo, padrão e resolução (puro) ━━");

ok("catálogo sem código duplicado", new Set(CODIGOS).size === CODIGOS.length,
  `${CODIGOS.length} códigos`);

ok("todo código tem rótulo e grupo",
  PERMISSOES.every((p) => p.rotulo && ["tela", "acao", "base"].includes(p.grupo)));

/* paridade com o NAV do app — lido do JSX, não reescrito aqui */
{
  const jsx = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
  const bloco = jsx.slice(jsx.indexOf("const NAV = ["), jsx.indexOf("const PermsCtx"));
  const itens = [...bloco.matchAll(/\{\s*id:\s*"([a-z]+)".*?perm:\s*"([a-z.]+)"/gs)]
    .map(([, id, perm]) => ({ id, perm }));
  ok("NAV declara perm em todas as telas", itens.length === 13, `${itens.length} itens`);
  const semCatalogo = itens.filter((i) => !CODIGOS.includes(i.perm));
  ok("toda perm do NAV existe no catálogo", semCatalogo.length === 0,
    semCatalogo.map((i) => i.perm).join(", "));
  const telasCat = PERMISSOES.filter((p) => p.grupo === "tela" && p.tela).map((p) => p.tela);
  const orfas = telasCat.filter((tl) => !itens.some((i) => i.id === tl));
  ok("toda tela do catálogo existe no NAV", orfas.length === 0, orfas.join(", "));
}

/* o padrão TEM de reproduzir o que cada perfil via ANTES da matriz — esta
   é a garantia de zero regressão no dia do deploy. As listas abaixo são a
   cópia literal do NAV.roles anterior. */
{
  const ANTES = {
    sindico: ["dashboard","condominio","unidades","pessoas","financeiro","cobrancas",
              "multas","comunicados","documentos","chamados","portaria"],
    tesouraria: ["dashboard","unidades","financeiro","cobrancas","documentos"],
  };
  for (const [perfil, telas] of Object.entries(ANTES)) {
    const p = permsPadrao(perfil);
    const faltam = telas.filter((tl) => !podeTela(p, tl));
    const sobram = PERMISSOES.filter((x) => x.grupo === "tela" && x.tela && pode(p, x.codigo))
      .map((x) => x.tela).filter((tl) => !telas.includes(tl));
    ok(`padrão do ${perfil} = as telas de antes`, !faltam.length && !sobram.length,
      faltam.length ? `faltam ${faltam}` : sobram.length ? `sobram ${sobram}` : `${telas.length} telas`);
  }
  ok("padrão do síndico NÃO edita o condomínio", !pode(permsPadrao("sindico"), "condominio.editar"));
  ok("padrão do síndico NÃO cria unidade", !pode(permsPadrao("sindico"), "unidade.criar"));
  ok("padrão da tesouraria NÃO registra multa", !pode(permsPadrao("tesouraria"), "multa.registrar"));
  ok("padrão do morador = portal + chamado + informe",
    mesmoConjunto(permsPadrao("morador"), PERMS_DO_MORADOR));
}

ok("diretor tem o catálogo inteiro (anti-trava)",
  mesmoConjunto(permsEfetivas({ perfil: "diretor" }), CODIGOS));
ok("diretor ignora override", mesmoConjunto(permsEfetivas({ perfil: "diretor", override: [] }), CODIGOS));

/* override SUBSTITUI — não soma */
{
  const so = permsEfetivas({ perfil: "tesouraria", override: ["tela.financeiro"] });
  ok("override substitui o padrão", mesmoConjunto(so, ["tela.financeiro"]), so.join(","));
  ok("override vazio ZERA o perfil", permsEfetivas({ perfil: "tesouraria", override: [] }).length === 0);
  ok("sem override cai no padrão",
    mesmoConjunto(permsEfetivas({ perfil: "tesouraria", override: null }), MATRIZ_PADRAO.tesouraria));
}

/* saneamento do que vem da tela */
{
  const s = sanearPerms("sindico", ["tela.multas", "permissao.gerir", "saas.gerir", "inventado.x", "tela.multas"]);
  ok("sanear tira as fixas, o inválido e a duplicata", mesmoConjunto(s, ["tela.multas"]), s.join(","));
  const m = sanearPerms("morador", ["tela.financeiro", "chamado.abrir", "financeiro.baixar"]);
  ok("sanear fecha o conjunto do morador", mesmoConjunto(m, ["chamado.abrir"]), m.join(","));
  ok("fixas não são delegáveis", PERMISSOES_FIXAS.includes("permissao.gerir"));
}

/* ── PARIDADE com o SQL (o arquivo é a fonte do banco) ── */
{
  const s = sql("supabase-permissoes.sql");

  /* catálogo: os ('codigo', 'descricao') do insert into permissoes */
  const ins = s.slice(s.indexOf("insert into public.permissoes"), s.indexOf("on conflict (codigo)"));
  const doSql = [...ins.matchAll(/\('([a-z][a-z._]+)',/g)].map(([, c]) => c);
  const faltamNoSql = CODIGOS.filter((c) => !doSql.includes(c));
  const faltamNoJs = doSql.filter((c) => !CODIGOS.includes(c));
  ok("catálogo JS ≡ catálogo SQL", !faltamNoSql.length && !faltamNoJs.length,
    [...faltamNoSql.map((c) => `só no JS: ${c}`), ...faltamNoJs.map((c) => `só no SQL: ${c}`)].join(" · "));

  /* padrão: a view _padrao_permissoes */
  const vw = s.slice(s.indexOf("create or replace view public._padrao_permissoes"),
    s.indexOf("-- insere o que falta"));
  for (const perfil of ["sindico", "tesouraria", "morador", "administradora"]) {
    const m = vw.match(new RegExp(`'${perfil}'[^\\[]*\\[([^\\]]+)\\]`));
    const lista = m ? [...m[1].matchAll(/'([a-z][a-z._]+)'/g)].map(([, c]) => c) : [];
    ok(`padrão do ${perfil}: JS ≡ SQL`, mesmoConjunto(lista, MATRIZ_PADRAO[perfil] || []),
      `${lista.length} no SQL vs ${(MATRIZ_PADRAO[perfil] || []).length} no JS`);
  }

  /* mapa tabela → permissão */
  const fn = s.slice(s.indexOf("create or replace function public.permissao_da_tabela"),
    s.indexOf("-- ─────────────────────────────────────────────────────────────────\n-- E)"));
  const pares = Object.fromEntries([...fn.matchAll(/when '(\w+)'\s+then '([a-z.]+)'/g)].map(([, t2, c]) => [t2, c]));
  ok("mapa tabela→permissão: JS ≡ SQL",
    mesmoConjunto(Object.keys(pares), Object.keys(PERMISSAO_DA_TABELA))
      && Object.entries(pares).every(([t2, c]) => PERMISSAO_DA_TABELA[t2] === c),
    JSON.stringify(pares));
  ok("coringa de escrita é dados.escrever",
    fn.includes(`else '${ESCRITA_PADRAO}'`) && ESCRITA_PADRAO === "dados.escrever");

  /* a matriz não pode entrar no loop de escrita por tabela */
  const loop = s.slice(s.indexOf("-- F) Escrita por PERMISSÃO"), s.indexOf("-- G) Aprovação"));
  ok("perfil_overrides fora do loop de escrita", loop.includes("'perfil_overrides'"));
  ok("perfil_permissoes fora do loop de escrita", loop.includes("'perfil_permissoes'"));

  /* nenhuma policy de ESCRITA pode ter sobrado olhando perfil em vez de
     permissão — era por aí que a tesouraria escrevia no que não via */
  const porPerfil = [...s.matchAll(/jwt_perfil\(\)\s*(?:not )?in \(/g)].length;
  ok("nenhuma policy nova decide por nome de perfil", porPerfil === 0,
    porPerfil ? `${porPerfil} ocorrência(s) de jwt_perfil() in (...)` : "só jwt_pode()");

  /* as duas exceções que ficam FORA do loop por não terem condominio_id /
     por viverem no storage — fáceis de esquecer numa mudança futura */
  ok("penalidade_provas pede multa.registrar",
    /create policy provas_tenant[\s\S]*?jwt_pode\('multa\.registrar'\)/.test(s));
  for (const [pol, cod] of [["documentos_upload", "documento.emitir"],
                            ["documentos_delete", "documento.emitir"],
                            ["documentos_upload_morador", "chamado.abrir"]]) {
    ok(`storage ${pol} pede ${cod}`,
      new RegExp(`create policy ${pol} on storage\\.objects[\\s\\S]*?jwt_pode\\('${cod.replace(".", "\\.")}'\\)`).test(s));
  }
}

/* ══════════════════ BLOCO B — banco + API ══════════════════ */
console.log("\n━━ B · semeadura, policies, gatilhos e RPC (banco) ━━");

const NOMES_B = [
  "padrão semeado no banco", "diretor passa em tudo", "tesouraria escreve lançamento",
  "tesouraria NÃO escreve comunicado", "sem financeiro.aprovar o gatilho barra",
  "override zerado tranca a escrita", "tesouraria não mexe na própria matriz",
  "RPC de baixa nega sem financeiro.baixar", "o corpo __base é inalcançável",
  "restaurar volta ao padrão",
];

const temMatriz = await admin.from("perfil_overrides").select("id").limit(1);
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: SENHA_DIRETOR });

if (temMatriz.error) {
  for (const n of NOMES_B) pula(n, "supabase-permissoes.sql não rodou (perfil_overrides ausente)");
  /* evidência do estado ANTERIOR, de propósito */
  console.log("   ℹ️  estado atual (vulnerável ao que a tela promete): escrita liberada a");
  console.log("      diretor/sindico/tesouraria em TODA tabela do condomínio, sem olhar a matriz.");
} else if (!login.token) {
  for (const n of NOMES_B) pula(n, `login do diretor falhou — dev server de pé em ${BASE}? (npm run dev)`);
} else {
  const tokenDiretor = login.token;
  let usuarioTes = null, lancId = null;

  try {
    /* conta de tesouraria só para esta sonda */
    await post("auth/acessos", { acao: "criar", perfil: "tesouraria", email: EMAIL_TES, senha: SENHA }, tokenDiretor);
    const lg = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TES, senha: SENHA });
    const app = lg.token ? clienteApp(lg.token) : null;
    const { data: cadastrados } = await admin.from("usuarios").select("id").eq("email", EMAIL_TES).maybeSingle();
    usuarioTes = cadastrados?.id || null;

    /* 1 · padrão semeado com as contagens do arquivo */
    const { data: sem } = await admin.from("perfil_permissoes")
      .select("perfis!inner(nome), permissoes!inner(codigo)").is("condominio_id", null);
    const porPerfil = {};
    for (const r of sem || []) (porPerfil[r.perfis.nome] ||= []).push(r.permissoes.codigo);
    const divergentes = Object.entries(MATRIZ_PADRAO)
      .filter(([p, lista]) => !mesmoConjunto(porPerfil[p] || [], lista));
    ok(NOMES_B[0], divergentes.length === 0,
      divergentes.length ? divergentes.map(([p]) => p).join(", ") : Object.keys(porPerfil).sort().join("/"));

    if (!app) {
      for (const n of NOMES_B.slice(1)) pula(n, "login da tesouraria de teste falhou");
    } else {
      /* o comunicado tem 3 colunas obrigatórias além do texto — montá-lo
         errado faria o teste de BLOQUEIO passar por constraint, não por
         policy (ver ehRls) */
      const { data: uDir } = await admin.from("usuarios")
        .select("id").eq("email", "diretor.manuais@teste.condomaster.dev").maybeSingle();
      const comunicado = (titulo, autor) => ({
        condominio_id: COND, tipo: "comunicado", titulo, corpo: "sonda de permissões",
        segmento: { tipo: "todas" }, canais: ["portal"], publicado_por: autor,
      });

      /* 2 · diretor passa em tudo (anti-trava), inclusive onde não há linha */
      const dirApp = clienteApp(tokenDiretor);
      const r2 = await dirApp.from("comunicados")
        .insert(comunicado("sonda perms diretor", uDir?.id)).select("id").maybeSingle();
      ok(NOMES_B[1], !r2.error, r2.error?.message || "insert em comunicados liberado");
      await admin.from("comunicados").delete().eq("titulo", "sonda perms diretor");

      /* 3 · tesouraria escreve onde tem permissão (financeiro.lancar).
         A categoria vem do próprio condomínio (o de teste só tem receita),
         e o tipo do lançamento acompanha o da categoria. */
      const { data: cat } = await admin.from("categorias_financeiras")
        .select("id, tipo").eq("condominio_id", COND).limit(1).maybeSingle();
      const novo = {
        condominio_id: COND, tipo: cat?.tipo || "receita", categoria_id: cat?.id,
        descricao: "sonda permissoes", valor: 10, data: `${COMP}-10`, competencia: COMP,
      };
      const r3 = await app.from("lancamentos").insert(novo).select("id").maybeSingle();
      lancId = r3.data?.id || null;
      ok(NOMES_B[2], !r3.error && !!lancId, r3.error?.message || `categoria ${cat?.tipo}`);

      /* 4 · e NÃO escreve onde a tela nunca existiu (aperto deliberado) */
      const r4 = await app.from("comunicados")
        .insert(comunicado("sonda perms tesouraria", usuarioTes)).select("id").maybeSingle();
      ok(NOMES_B[3], ehRls(r4.error),
        r4.error ? (ehRls(r4.error) ? "negado pela policy (42501)" : `erro de OUTRA natureza: ${r4.error.message}`)
                 : "ESCREVEU — policy frouxa");
      await admin.from("comunicados").delete().eq("titulo", "sonda perms tesouraria");

      /* 5 · override tirando financeiro.aprovar → o gatilho barra a aprovação */
      const semAprovar = MATRIZ_PADRAO.tesouraria.filter((c) => c !== "financeiro.aprovar");
      const sv = await post("auth/permissoes", { acao: "salvar", perfil: "tesouraria", perms: semAprovar }, tokenDiretor);
      const lgB = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TES, senha: SENHA });
      const appB = lgB.token ? clienteApp(lgB.token) : app;
      const r5 = lancId
        ? await appB.from("lancamentos").update({ status: "aprovado" }).eq("id", lancId).select("id")
        : { error: null };
      /* a mensagem tem de ser a DO GATILHO: se o update fosse barrado pela
         policy de escrita, provaria outra coisa (a tesouraria mantém
         financeiro.lancar neste override, então a escrita segue liberada) */
      ok(NOMES_B[4], sv.ok === true && !!lancId && ehGatilho(r5.error, "não pode aprovar"),
        !lancId ? "sem lançamento para testar"
          : r5.error ? r5.error.message : "APROVOU sem a permissão");
      ok("a sessão nova já reflete o override",
        Array.isArray(lgB.conta?.perms) && !lgB.conta.perms.includes("financeiro.aprovar"),
        (lgB.conta?.perms || []).length + " códigos");

      /* 6 · override vazio zera o perfil (e não cai no padrão) */
      await post("auth/permissoes", { acao: "salvar", perfil: "tesouraria", perms: [] }, tokenDiretor);
      const lgC = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TES, senha: SENHA });
      const appC = lgC.token ? clienteApp(lgC.token) : appB;
      const r6 = await appC.from("lancamentos").insert({ ...novo, descricao: "sonda perms zerada" })
        .select("id").maybeSingle();
      ok(NOMES_B[5], ehRls(r6.error) && (lgC.conta?.perms || []).length === 0,
        r6.error ? (ehRls(r6.error) ? "escrita negada com o perfil zerado" : `erro de OUTRA natureza: ${r6.error.message}`)
                 : "ESCREVEU com o perfil zerado");
      await admin.from("lancamentos").delete().eq("descricao", "sonda perms zerada");

      /* 7 · a própria matriz é inalcançável pelo navegador */
      const { data: pfTes } = await admin.from("perfis").select("id").eq("nome", "tesouraria").maybeSingle();
      const { data: pmAlg } = await admin.from("permissoes").select("id").eq("codigo", "tela.acessos").maybeSingle();
      const r7a = await appC.from("perfil_overrides").delete().eq("condominio_id", COND);
      const r7b = await appC.from("perfil_permissoes").insert({
        condominio_id: COND, perfil_id: pfTes?.id, permissao_id: pmAlg?.id }).select("id");
      const { data: aindaTem } = await admin.from("perfil_overrides").select("id").eq("condominio_id", COND);
      ok(NOMES_B[6], ehRls(r7b.error) && (aindaTem?.length || 0) > 0,
        !ehRls(r7b.error) ? (r7b.error ? `erro de OUTRA natureza: ${r7b.error.message}` : "CONSEGUIU se promover")
          : (aindaTem?.length || 0) > 0 ? "insert negado e override intacto" : "APAGOU o próprio override");

      /* 8 · a RPC de baixa confere financeiro.baixar (embrulho) */
      const { data: cobr } = await admin.from("cobrancas")
        .select("id").eq("condominio_id", COND).eq("status", "emitida").limit(1).maybeSingle();
      if (!cobr) pula(NOMES_B[7], "nenhuma cobrança emitida no condomínio de teste");
      else {
        const { data: rpc } = await appC.rpc("registrar_pagamento_manual", {
          p_cobranca_id: cobr.id, p_forma: "dinheiro", p_valor: 1,
          p_pago_em: new Date().toISOString(), p_justificativa: "sonda permissoes",
        });
        ok(NOMES_B[7], rpc?.ok === false && rpc?.erro === "nao_autorizado", JSON.stringify(rpc));
      }

      /* 9 · o EMBRULHO só vale se o corpo real estiver fora de alcance:
         senão bastava chamar registrar_pagamento_manual__base e pular a
         guarda. É a premissa de segurança da abordagem — sem cópia de
         corpo, mas com o original revogado de anon/authenticated. */
      if (!cobr) pula(NOMES_B[8], "nenhuma cobrança emitida no condomínio de teste");
      else {
        const { error: eBase } = await appC.rpc("registrar_pagamento_manual__base", {
          p_cobranca_id: cobr.id, p_forma: "dinheiro", p_valor: 1,
          p_pago_em: new Date().toISOString(), p_justificativa: "sonda base",
        });
        ok(NOMES_B[8], !!eBase && /permission denied|not find|does not exist|schema cache/i.test(eBase.message || ""),
          eBase ? eBase.message.slice(0, 70) : "EXECUTOU o corpo real sem passar pela guarda");
      }

      /* 10 · restaurar devolve o padrão */
      const rs = await post("auth/permissoes", { acao: "restaurar", perfil: "tesouraria" }, tokenDiretor);
      const lgD = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TES, senha: SENHA });
      ok(NOMES_B[9], rs.ok === true && mesmoConjunto(lgD.conta?.perms || [], MATRIZ_PADRAO.tesouraria),
        `${(lgD.conta?.perms || []).length} códigos`);
    }
  } finally {
    /* limpeza: lançamento, override e a conta da sonda */
    if (lancId) await admin.from("lancamentos").delete().eq("id", lancId);
    await admin.from("lancamentos").delete().eq("descricao", "sonda permissoes");
    const { data: pf } = await admin.from("perfis").select("id").eq("nome", "tesouraria").maybeSingle();
    if (pf) {
      await admin.from("perfil_permissoes").delete().eq("condominio_id", COND).eq("perfil_id", pf.id);
      await admin.from("perfil_overrides").delete().eq("condominio_id", COND).eq("perfil_id", pf.id);
    }
    if (usuarioTes) await post("auth/acessos", { acao: "remover", usuarioId: usuarioTes }, login.token);
  }
}

console.log(`\n${falhas ? "❌" : "✅"} permissões: ${falhas} falha(s)${puladas ? `, ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
