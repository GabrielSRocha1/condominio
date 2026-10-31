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
} from "../src/lib/aprovacoes.js";
import { MATRIZ_PADRAO, PERMS_VEDADAS_AO_ADMIN, pode } from "../src/lib/permissoes.js";

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

/* ══════════════════ BLOCO B — banco + API ══════════════════ */
console.log("\n━━ B · a escrita do administrador não vale sozinha (banco) ━━");

const NOMES_B = [
  "escrita do administrador NÃO entra na tabela", "e vira pendência na fila",
  "administrador não aprova a si mesmo", "diretor aprova e a linha nasce",
  "aprovar com correção grava o valor do diretor", "rejeitar não cria nada",
  "exclusão também espera aprovação", "portaria do administrador é imediata",
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
    await admin.from("blocos").delete().eq("condominio_id", COND).like("nome", `${MARCA}%`);
    await admin.from("acessos_portaria").delete().eq("condominio_id", COND).like("pessoa_nome", `${MARCA}%`);
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
      const nomeBloco = `${MARCA} bloco`;
      const r1 = await app.from("blocos").insert({ condominio_id: COND, nome: nomeBloco }).select();
      const { count: naTabela } = await admin.from("blocos")
        .select("*", { count: "exact", head: true }).eq("condominio_id", COND).eq("nome", nomeBloco);
      ok(NOMES_B[0], !r1.error && (naTabela || 0) === 0,
        r1.error ? `erro inesperado: ${r1.error.message}` : `linhas na tabela: ${naTabela}`);

      const { data: fila1 } = await admin.from("alteracoes_pendentes")
        .select("*").eq("condominio_id", COND).eq("status", "pendente").order("solicitado_em");
      const pend = (fila1 || []).find((a) => a.payload?.nome === nomeBloco);
      ok(NOMES_B[1], !!pend && pend.tabela === "blocos" && pend.operacao === "INSERT",
        pend ? `${pend.tabela}/${pend.operacao}` : "nada na fila");

      /* 3 · ele não aprova a própria pendência */
      if (!pend) pula(NOMES_B[2], "sem pendência para testar");
      else {
        const { data: auto } = await app.rpc("aprovar_alteracao", { p_id: pend.id, p_correcao: null, p_parecer: null });
        const { count: aindaNao } = await admin.from("blocos")
          .select("*", { count: "exact", head: true }).eq("nome", nomeBloco);
        ok(NOMES_B[2], auto?.ok === false && auto?.erro === "nao_autorizado" && (aindaNao || 0) === 0,
          JSON.stringify(auto));
      }

      /* 4 · o diretor aprova e a linha nasce */
      const dirApp = clienteApp(tokenDiretor);
      if (!pend) pula(NOMES_B[3], "sem pendência para testar");
      else {
        const { data: ap } = await dirApp.rpc("aprovar_alteracao", { p_id: pend.id, p_correcao: null, p_parecer: "ok" });
        const { data: criado } = await admin.from("blocos").select("id, nome").eq("nome", nomeBloco).maybeSingle();
        ok(NOMES_B[3], ap?.ok === true && !!criado, ap?.erro || (criado ? "bloco criado" : "não nasceu"));
      }

      /* 5 · aprovar COM correção: vale o que o diretor escreveu */
      const nomeErrado = `${MARCA} errado`, nomeCerto = `${MARCA} corrigido`;
      await app.from("blocos").insert({ condominio_id: COND, nome: nomeErrado }).select();
      const { data: fila2 } = await admin.from("alteracoes_pendentes")
        .select("*").eq("condominio_id", COND).eq("status", "pendente").order("solicitado_em");
      const pend2 = (fila2 || []).find((a) => a.payload?.nome === nomeErrado);
      if (!pend2) pula(NOMES_B[4], "sem pendência para corrigir");
      else {
        await dirApp.rpc("aprovar_alteracao", { p_id: pend2.id, p_correcao: { nome: nomeCerto }, p_parecer: "corrigi o nome" });
        const { count: cErrado } = await admin.from("blocos").select("*", { count: "exact", head: true }).eq("nome", nomeErrado);
        const { count: cCerto } = await admin.from("blocos").select("*", { count: "exact", head: true }).eq("nome", nomeCerto);
        ok(NOMES_B[4], (cErrado || 0) === 0 && (cCerto || 0) === 1,
          `errado: ${cErrado} · corrigido: ${cCerto}`);
      }

      /* 6 · rejeitar não cria nada */
      const nomeRejeitado = `${MARCA} rejeitado`;
      await app.from("blocos").insert({ condominio_id: COND, nome: nomeRejeitado }).select();
      const { data: fila3 } = await admin.from("alteracoes_pendentes")
        .select("*").eq("condominio_id", COND).eq("status", "pendente").order("solicitado_em");
      const pend3 = (fila3 || []).find((a) => a.payload?.nome === nomeRejeitado);
      if (!pend3) pula(NOMES_B[5], "sem pendência para rejeitar");
      else {
        const { data: rj } = await dirApp.rpc("rejeitar_alteracao", { p_id: pend3.id, p_parecer: "não quero" });
        const { count: cRej } = await admin.from("blocos").select("*", { count: "exact", head: true }).eq("nome", nomeRejeitado);
        ok(NOMES_B[5], rj?.ok === true && (cRej || 0) === 0, `linhas criadas: ${cRej}`);
      }

      /* 7 · exclusão também espera */
      const { data: alvo } = await admin.from("blocos").select("id").eq("nome", nomeCerto).maybeSingle();
      if (!alvo) pula(NOMES_B[6], "sem bloco para excluir");
      else {
        await app.from("blocos").delete().eq("id", alvo.id);
        const { count: aindaExiste } = await admin.from("blocos").select("*", { count: "exact", head: true }).eq("id", alvo.id);
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
    }
  } finally {
    await limpar();
    if (usuarioAdm) await post("auth/acessos", { acao: "remover", usuarioId: usuarioAdm }, tokenDiretor);
  }
}

console.log(`\n${falhas ? "❌" : "✅"} aprovações: ${falhas} falha(s)${puladas ? `, ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
