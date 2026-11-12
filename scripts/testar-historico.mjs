/* Sondas da aba HISTÓRICO DE ALTERAÇÕES (motor puro + paridade de fonte).

   Prova src/lib/historico.js: categorias e verbos, diff que ignora os
   campos de infraestrutura, descrição legível dos 5 tipos de linha, busca
   sem acento e as regras do desfazer. E prova, por leitura dos ARQUIVOS
   fonte, as paridades que não podem derivar: as tabelas do gatilho do
   supabase-historico.sql têm categoria no JS, o bloqueio de dinheiro da
   RPC espelha ENTIDADES_SEM_DESFAZER, `auditoria` está nas DUAS listas de
   exclusão dos loops genéricos (senão um re-run reabre a trilha para todo
   perfil), as policies decidem por jwt_pode e o NAV/SCREENS têm a aba.

   Uso: node scripts/testar-historico.mjs */
import { readFileSync } from "node:fs";
import {
  CATEGORIAS, ENTIDADES, EVENTOS, categoriaDe, rotuloEntidade, fraseEvento,
  entidadesDaCategoria, TABELAS_FILHAS, verboAcao, diffLinha, descrever,
  resumoLinha, rotuloAutor, filtrarBusca, ENTIDADES_SEM_DESFAZER, podeDesfazer,
  detalheCurto,
} from "../src/lib/historico.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const arq = (nome) => readFileSync(new URL(`../${nome}`, import.meta.url), "utf8");

console.log("━━ H · motor puro (categorias, verbos, diff, desfazer) ━━");

/* H1 · toda entidade mapeada cai numa categoria que existe como chip */
{
  const ids = new Set(CATEGORIAS.map((c) => c.id));
  const fora = Object.values(ENTIDADES).filter((c) => !ids.has(c));
  ok("H1 toda entidade aponta para um chip existente", fora.length === 0, fora.join(","));
  ok("H1b evento desconhecido cai em 'outros' sem quebrar",
    categoriaDe("evento_que_nao_existe") === "outros");
  ok("H1c prefixos: recuperacao_* → seguranca, informe_* → cobrancas",
    categoriaDe("recuperacao_email_falha_envio") === "seguranca"
    && categoriaDe("informe_divergente") === "cobrancas");
}

/* H2 · verbos: criou/editou/excluiu/ADICIONOU (filha)/desfez/evento */
ok("H2 verbos com tom", ["Criou", "Editou", "Excluiu", "Desfez", "Evento"].every((r, i) =>
  verboAcao({ acao: ["INSERT", "UPDATE", "DELETE", "DESFAZ", "EVENTO"][i], entidade: "pessoas" }).rotulo === r));
ok("H2b INSERT em tabela-filha vira Adicionou",
  [...TABELAS_FILHAS].every((e) => verboAcao({ acao: "INSERT", entidade: e }).rotulo === "Adicionou"));

/* H3 · diff ignora id/condominio_id/carimbos e só mostra o que mudou */
{
  const d = diffLinha({ acao: "UPDATE",
    antes:  { id: "x", condominio_id: "c", atualizado_em: "1", criado_em: "1", nome: "Ana", valor: 100 },
    depois: { id: "x", condominio_id: "c", atualizado_em: "2", criado_em: "1", nome: "Ana", valor: 150 } });
  ok("H3 UPDATE: só o campo que mudou", d.length === 1 && d[0].campo === "valor"
    && d[0].de === 100 && d[0].para === 150, JSON.stringify(d));
}

/* H4 · descrição: UPDATE "campo: de → para (+N)", INSERT/DELETE resumo, EVENTO frase */
{
  const upd = { acao: "UPDATE",
    antes: { valor_original: 100, vencimento: "2026-01-10", descricao: "a", observacao: "b", titulo: "t" },
    depois: { valor_original: 150, vencimento: "2026-02-10", descricao: "c", observacao: "d", titulo: "t2" } };
  const frase = descrever(upd, 2);
  ok("H4 UPDATE descreve 'de → para' com teto de campos",
    frase.includes("→") && frase.includes("(+3)"), frase);
  ok("H4b INSERT/DELETE usam o resumo humano",
    descrever({ acao: "INSERT", depois: { nome: "Apto 10-A" } }) === "Apto 10-A"
    && descrever({ acao: "DELETE", antes: { titulo: "Ata 12" } }) === "Ata 12");
  ok("H4c EVENTO vira a frase do mapa",
    descrever({ acao: "EVENTO", entidade: "login_sucesso" }) === EVENTOS.login_sucesso
    && fraseEvento("evento_estranho") === "evento_estranho");
  /* a correção de 09/11/2026: "Acesso removido" sem quem foi removido não
     serve — o detalhe legível entra na linha; uuid fica só no modal */
  {
    const ev = { acao: "EVENTO", entidade: "acesso_removido",
      detalhe: { usuario_alvo: "1e0ec5ba-efeb-4788-b1bc-7ea3a9488b52", nome: "verumcripto",
        email: "sindico@x.com", perfil: "sindico" } };
    ok("H4e detalhe do evento aparece na linha (sem o uuid)",
      descrever(ev) === "Acesso removido · verumcripto · sindico@x.com · sindico"
      && !detalheCurto(ev).includes("1e0ec5ba"), descrever(ev));
  }
  ok("H4f vínculo excluído mostra o papel (não '—')",
    descrever({ acao: "DELETE", antes: { papel: "sindico", pessoa_id: "x" } }) === "sindico"
    && resumoLinha({ acao: "DELETE", antes: { papel: "sindico" } }) === "sindico");
  ok("H4d autor: nome > e-mail > Sistema",
    rotuloAutor({ autor_nome: "Ana", autor_email: "a@b.c" }) === "Ana"
    && rotuloAutor({ autor_email: "a@b.c" }) === "a@b.c"
    && rotuloAutor({ perfil: "sistema" }) === "Sistema");
}

/* H5 · busca sem acento e sem caixa, sobre descrição + autor + entidade */
{
  const linhas = [{ fonte: "dados", acao: "UPDATE", entidade: "pessoas",
    antes: { nome: "José" }, depois: { nome: "João" }, autor_nome: "María", perfil: "diretor" }];
  ok("H5 'maria' e 'jose' acham a linha; 'xyz' não",
    filtrarBusca(linhas, "maria").length === 1 && filtrarBusca(linhas, "jose").length === 1
    && filtrarBusca(linhas, "xyz").length === 0);
}

/* H6 · desfazer: só CRUD de dados, nunca dinheiro, nunca _grande */
{
  ok("H6 UPDATE de pessoas é desfazível",
    podeDesfazer({ fonte: "dados", acao: "UPDATE", entidade: "pessoas" }));
  ok("H6b evento, DESFAZ e _grande não têm botão",
    !podeDesfazer({ fonte: "eventos", acao: "EVENTO", entidade: "login_sucesso" })
    && !podeDesfazer({ fonte: "dados", acao: "DESFAZ", entidade: "pessoas" })
    && !podeDesfazer({ fonte: "dados", acao: "UPDATE", entidade: "pessoas", depois: { _grande: true } }));
  ok("H6c dinheiro fica fora",
    [...ENTIDADES_SEM_DESFAZER].every((e) =>
      !podeDesfazer({ fonte: "dados", acao: "DELETE", entidade: e })));
}

/* H7 · filtro de chip devolve entidades para o .in() do servidor */
{
  const seg = entidadesDaCategoria("seguranca");
  ok("H7 chip seguranca filtra por eventos (login_sucesso incluso)",
    Array.isArray(seg) && seg.includes("login_sucesso") && !seg.includes("pessoas"));
  ok("H7b 'todas' = sem filtro", entidadesDaCategoria("todas") === null);
}

console.log("\n━━ F · paridade com os arquivos fonte ━━");

const sHist = arq("supabase-historico.sql");
const sRls = arq("supabase-rls.sql");
const sPerm = arq("supabase-permissoes.sql");
const sAprov = arq("supabase-aprovacoes.sql");
const jsx = arq("CondoMasterPro.jsx");

/* F1 · toda tabela com gatilho no SQL tem categoria no JS (e vice-versa).
   Os três blocos: array principal + planilhas_cobranca + acessos_portaria. */
{
  const mArr = sHist.match(/foreach t in array array\[([^\]]+)\]/s);
  const principais = mArr ? [...mArr[1].matchAll(/'(\w+)'/g)].map(([, x]) => x) : [];
  const doSql = [...principais, "planilhas_cobranca", "acessos_portaria"];
  const tabelasJs = Object.keys(ENTIDADES).filter((e) => !EVENTOS[e]);
  const semJs = doSql.filter((e) => !tabelasJs.includes(e));
  const semSql = tabelasJs.filter((e) => !doSql.includes(e));
  /* 23 desde 09/11/2026: +areas_comuns/reservas/assembleias/atas (telas novas) */
  ok("F1 tabelas do gatilho ≡ tabelas do JS (23)",
    doSql.length === 23 && semJs.length === 0 && semSql.length === 0,
    [...semJs.map((x) => `só no SQL: ${x}`), ...semSql.map((x) => `só no JS: ${x}`)].join(" · ") || `${doSql.length} tabelas`);
}

/* F2 · bloqueio de dinheiro da RPC ≡ ENTIDADES_SEM_DESFAZER */
{
  const m = sHist.match(/'entidade_bloqueada'[\s\S]{0,400}?if a\.entidade in \(([^)]+)\)/)
    || sHist.match(/if a\.entidade in \(([^)]+)\)[\s\S]{0,200}?'entidade_bloqueada'/);
  const doSql = m ? [...m[1].matchAll(/'(\w+)'/g)].map(([, x]) => x) : [];
  const js = [...ENTIDADES_SEM_DESFAZER];
  ok("F2 RPC bloqueia o mesmo conjunto do JS",
    doSql.length === js.length && js.every((e) => doSql.includes(e)), doSql.join(","));
  /* `reservas` saiu do bloqueio em 12/11/2026 e passou a ter guarda pelo PAR
     antes/depois: desfazer a confirmação cancela a taxa na mesma transação,
     taxa paga recusa. O espelho JS é podeDesfazerReserva (testar-reservas). */
  ok("F2b reservas fora do bloqueio, com a guarda da taxa no lugar",
    !doSql.includes("reservas") && !ENTIDADES_SEM_DESFAZER.has("reservas")
    && /if a\.entidade = 'reservas' then/.test(sHist)
    && ["taxa_paga", "taxa_informe_pendente", "taxa_cancelada"].every((e) => sHist.includes(`'${e}'`)));
  ok("F2c o cancelamento da taxa roda DENTRO do bloco transacional do desfazer",
    /begin[\s\S]{0,3000}cancelar_cobranca__base[\s\S]{0,400}raise exception[\s\S]{0,600}exception\s+when foreign_key_violation/.test(sHist));
}

/* F3 · `auditoria` nas DUAS listas de exclusão dos loops genéricos —
   sem isso, re-rodar rls/permissoes reabre a trilha para todo perfil */
ok("F3 rls.sql exclui auditoria do loop", /not in \([^)]*'auditoria'[^)]*\)/s.test(sRls));
ok("F3b permissoes.sql exclui auditoria do loop", /not in \([^)]*'auditoria'[^)]*\)/s.test(sPerm));

/* F4 · policies decidem pela MATRIZ, nunca por nome de perfil */
ok("F4 historico_select usa jwt_pode('tela.historico')",
  /create policy historico_select[\s\S]{0,200}jwt_pode\('tela\.historico'\)/.test(sHist));
ok("F4b auditoria_eventos re-policiada por jwt_pode",
  /auditoria_select on public\.auditoria_eventos[\s\S]{0,200}jwt_pode\('tela\.historico'\)/.test(sHist));
ok("F4c RPC exige historico.desfazer", sHist.includes("jwt_pode('historico.desfazer')"));
ok("F4d view com security_invoker", sHist.includes("security_invoker = true"));

/* F5 · gatilho nunca derruba a escrita e pula consequência/cosmético/desfazer */
{
  const fn = sHist.slice(sHist.indexOf("function public.historico_registrar"),
    sHist.indexOf("revoke all on function public.historico_registrar"));
  ok("F5 guardas do gatilho (desfazendo, depth, cosmético, exception)",
    fn.includes("app.desfazendo") && fn.includes("pg_trigger_depth() > 1")
    && fn.includes("- 'atualizado_em'") && /exception when others then/.test(fn));
}

/* F6 · as permissões novas existem, são vedadas ao admin e fora dos padrões */
{
  const { PERMS_VEDADAS_AO_ADMIN, CODIGOS, MATRIZ_PADRAO } =
    await import("../src/lib/permissoes.js");
  ok("F6 tela.historico e historico.desfazer no catálogo",
    CODIGOS.includes("tela.historico") && CODIGOS.includes("historico.desfazer"));
  ok("F6b vedadas ao administrador",
    PERMS_VEDADAS_AO_ADMIN.includes("tela.historico") && PERMS_VEDADAS_AO_ADMIN.includes("historico.desfazer"));
  ok("F6c fora da MATRIZ_PADRAO de todos os perfis (padrão: só o diretor)",
    Object.values(MATRIZ_PADRAO).every((lista) =>
      !lista.includes("tela.historico") && !lista.includes("historico.desfazer")));
  ok("F6d _padrao_administrador (SQL) não os contém",
    !sAprov.slice(sAprov.indexOf("_padrao_administrador"), sAprov.indexOf("revoke all on public._padrao_administrador"))
      .match(/tela\.historico|historico\.desfazer/));
}

/* F7 · a aba existe no app: NAV + SCREENS + consulta fora do loadAll */
ok("F7 NAV tem a aba com tela.historico",
  /id: "historico"[\s\S]{0,120}perm: "tela\.historico"/.test(jsx));
ok("F7b SCREENS renderiza <Historico>", /historico: <Historico /.test(jsx));
{
  const api = arq("src/lib/api.js");
  ok("F7c listarHistorico pagina a view historico_unificado",
    api.includes('from("historico_unificado")') && api.includes(".range("));
  ok("F7d desfazerAlteracao chama a RPC", api.includes('rpc("desfazer_alteracao"'));
}

console.log(`\n${falhas ? "❌" : "✅"} histórico: ${falhas} falha(s)`);
process.exitCode = falhas ? 1 : 0;
