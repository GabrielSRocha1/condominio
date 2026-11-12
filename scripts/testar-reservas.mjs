/* Sondas de RESERVAS E ASSEMBLEIAS (motor puro + paridade de fonte).

   Prova src/lib/reservas.js: janela/conflito advisory (a autoridade é a
   constraint GiST), antecedência mínima, pauta texto⇄jsonb, presenças e
   quórum, transições de status. E prova, por leitura dos ARQUIVOS fonte,
   as costuras que não podem divergir: a policy do morador força status
   'solicitada' e decide por jwt_pode, a RPC confirmar_reserva exige
   reserva.decidir e cria cobrança 'extra', o sync da planilha PULA 'extra',
   o historico cobre as 4 tabelas novas, o sino conhece reserva.solicitada e
   o NAV/SCREENS têm as abas.

   E prova o CANCELAMENTO (12/11/2026): cancelar a reserva cancela a cobrança
   da taxa na mesma transação (RPC cancelar_reserva), taxa paga ou com informe
   pendente recusa, e `reservas` saiu do bloqueio cego do desfazer para uma
   guarda pelo par antes/depois.

   Uso: node scripts/testar-reservas.mjs */
import { readFileSync } from "node:fs";
import {
  agoraLocal, fimPadrao, conflita, antecedenciaOk, pautaParaJson, pautaParaTexto,
  togglePresenca, quorum, RESERVA_TRANSICOES, podeTransicionar,
  efeitoCancelamento, podeDesfazerReserva, faseReserva, proximaReserva,
} from "../src/lib/reservas.js";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
/* bloco B degrada aberto: sem .env ou sem o SQL novo, pula em vez de falhar */
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
const arq = (nome) => readFileSync(new URL(`../${nome}`, import.meta.url), "utf8");

console.log("━━ R · motor puro (janela, conflito, antecedência, quórum) ━━");

/* R1 · conflito: sobreposição na MESMA área, só solicitada/confirmada */
{
  const base = [
    { id: "a", areaId: "salao", status: "confirmada", inicio: "2026-12-01T18:00:00Z", fim: "2026-12-01T23:00:00Z" },
    { id: "b", areaId: "salao", status: "cancelada",  inicio: "2026-12-02T18:00:00Z", fim: "2026-12-02T23:00:00Z" },
    { id: "c", areaId: "quadra", status: "confirmada", inicio: "2026-12-01T18:00:00Z", fim: "2026-12-01T23:00:00Z" },
  ];
  ok("R1 sobreposição na mesma área acusa a reserva que colide",
    conflita(base, "salao", "2026-12-01T20:00:00Z", "2026-12-02T01:00:00Z")?.id === "a");
  ok("R1b cancelada não bloqueia; outra área não bloqueia; encostar não colide",
    conflita(base, "salao", "2026-12-02T19:00:00Z", "2026-12-02T20:00:00Z") === null
    && conflita(base, "quadra", "2026-12-01T10:00:00Z", "2026-12-01T12:00:00Z") === null
    && conflita(base, "salao", "2026-12-01T23:00:00Z", "2026-12-02T01:00:00Z") === null);
  ok("R1c ignorarId permite reeditar a própria reserva",
    conflita(base, "salao", "2026-12-01T20:00:00Z", "2026-12-01T21:00:00Z", "a") === null);
}

/* R2 · antecedência mínima da área */
{
  const agora = "2026-12-01T00:00:00Z";
  ok("R2 48h exigidas: 72h passa, 24h não, sem regra passa sempre",
    antecedenciaOk({ antecedencia_horas: 48 }, "2026-12-04T00:00:00Z", agora).ok === true
    && antecedenciaOk({ antecedencia_horas: 48 }, "2026-12-02T00:00:00Z", agora).ok === false
    && antecedenciaOk({}, "2026-12-01T01:00:00Z", agora).ok === true
    && antecedenciaOk(null, "2026-12-01T01:00:00Z", agora).ok === true);
}

/* R3 · datas do formulário */
{
  const fim = fimPadrao("2026-12-01T18:00", 4);
  ok("R3 fimPadrao soma horas no formato do input", /^2026-12-01T22:00/.test(fim), fim);
  ok("R3b agoraLocal tem o formato do datetime-local",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(agoraLocal()));
}

/* R4 · pauta texto ⇄ jsonb */
ok("R4 pauta: linhas viram itens (vazias fora) e voltam a texto",
  JSON.stringify(pautaParaJson(" Contas \n\n Obras do telhado \r\n")) === JSON.stringify(["Contas", "Obras do telhado"])
  && pautaParaTexto(["a", "b"]) === "a\nb" && pautaParaTexto(null) === "");

/* R5 · presenças e quórum */
{
  let p = togglePresenca([], "10-A");
  p = togglePresenca(p, "11-B");
  p = togglePresenca(p, "10-A");
  ok("R5 toggle entra e sai", JSON.stringify(p) === JSON.stringify(["11-B"]));
  const qr = quorum(["1-A", "2-A", "3-A"], 10, 25);
  ok("R5b quórum: 3/10 = 30% atinge mínimo de 25; sem mínimo → atingido null",
    qr.presentes === 3 && qr.pct === 30 && qr.atingido === true
    && quorum(["1-A"], 10).atingido === null
    && quorum([], 0, 50).pct === 0);
}

/* R6 · transições */
ok("R6 solicitada→confirmada/cancelada; confirmada→concluida/cancelada; terminais não saem",
  podeTransicionar("solicitada", "confirmada") && podeTransicionar("solicitada", "cancelada")
  && podeTransicionar("confirmada", "concluida") && podeTransicionar("confirmada", "cancelada")
  && !podeTransicionar("cancelada", "confirmada") && !podeTransicionar("concluida", "cancelada")
  && !podeTransicionar("solicitada", "concluida")
  && Object.keys(RESERVA_TRANSICOES).length === 4);

/* R7 · cancelar: o que acontece com a TAXA */
{
  const res = (extra) => ({ status: "confirmada", taxa: 150, ...extra });
  const semTaxa = efeitoCancelamento(res({ cobrancaId: null, cobrancaStatus: null }));
  ok("R7 área sem taxa: cancela a reserva e nada de dinheiro",
    semTaxa.podeCancelar && !semTaxa.cancelaTaxa && semTaxa.valor === 0);
  const emitida = efeitoCancelamento(res({ cobrancaId: "c1", cobrancaStatus: "emitida" }));
  ok("R7b taxa emitida: cancela a cobrança junto, com o valor à vista",
    emitida.podeCancelar && emitida.cancelaTaxa && emitida.valor === 150);
  const vencida = efeitoCancelamento(res({ cobrancaId: "c1", cobrancaStatus: "vencida" }));
  ok("R7c taxa vencida também é cancelável", vencida.podeCancelar && vencida.cancelaTaxa);
  const paga = efeitoCancelamento(res({ cobrancaId: "c1", cobrancaStatus: "pago" }));
  ok("R7d taxa PAGA recusa o cancelamento (devolução é ato da tela Cobranças)",
    !paga.podeCancelar && paga.motivo === "taxa_paga");
  for (const s of ["informado", "divergente"]) {
    const inf = efeitoCancelamento(res({ cobrancaId: "c1", cobrancaStatus: s }));
    ok(`R7e informe pendente (${s}) recusa`, !inf.podeCancelar && inf.motivo === "taxa_informe_pendente");
  }
  const jaCanc = efeitoCancelamento(res({ cobrancaId: "c1", cobrancaStatus: "cancelada" }));
  ok("R7f taxa já cancelada: segue cancelável, sem mexer em dinheiro de novo",
    jaCanc.podeCancelar && !jaCanc.cancelaTaxa);
  ok("R7g solicitada é cancelável (recusa); concluída e cancelada não",
    efeitoCancelamento({ status: "solicitada", taxa: 0 }).podeCancelar
    && !efeitoCancelamento({ status: "concluida", taxa: 0 }).podeCancelar
    && !efeitoCancelamento({ status: "cancelada", taxa: 0 }).podeCancelar
    && !efeitoCancelamento(null).podeCancelar);
}

/* R8 · desfazer pelo histórico: a guarda pelo par antes/depois */
{
  const confirmacao = { acao: "UPDATE", antes: { status: "solicitada", cobranca_id: null }, depois: { status: "confirmada", cobranca_id: "c1" } };
  ok("R8 desfazer a confirmação passa quando a taxa ainda é cancelável",
    podeDesfazerReserva(confirmacao, { cobrancaStatus: "emitida" }).ok);
  ok("R8b desfazer a confirmação recusa com a taxa paga",
    podeDesfazerReserva(confirmacao, { cobrancaStatus: "pago" }).motivo === "taxa_paga");
  ok("R8c desfazer a confirmação recusa com informe pendente",
    podeDesfazerReserva(confirmacao, { cobrancaStatus: "divergente" }).motivo === "taxa_informe_pendente");
  const cancelamento = { acao: "UPDATE", antes: { status: "confirmada", cobranca_id: "c1" }, depois: { status: "cancelada", cobranca_id: "c1" } };
  ok("R8d desfazer um CANCELAMENTO recusa (re-emitir é pela tela Reservas)",
    podeDesfazerReserva(cancelamento, { cobrancaStatus: "cancelada" }).motivo === "taxa_cancelada");
  const pedido = { acao: "INSERT", antes: null, depois: { status: "solicitada", cobranca_id: null } };
  ok("R8e desfazer o PEDIDO passa: nunca houve dinheiro",
    podeDesfazerReserva(pedido, { cobrancaStatus: null }).ok);
  const recusa = { acao: "UPDATE", antes: { status: "solicitada", cobranca_id: null }, depois: { status: "cancelada", cobranca_id: null } };
  ok("R8f desfazer uma RECUSA passa: área sem taxa não gerou cobrança",
    podeDesfazerReserva(recusa, { cobrancaStatus: null }).ok);
}

/* R9 · lembrete de reserva próxima (fase por dia de calendário) */
{
  /* instante FIXO, no fuso local, para a sonda não depender do relógio:
     uma terça-feira às 10:00 */
  const base = new Date(2031, 2, 11, 10, 0, 0).getTime();
  const h = (n) => base + n * 3600000;
  /* reserva confirmada começando em `n` horas, durando 4 */
  const res = (n, extra) => ({ status: "confirmada", inicio: h(n), fim: h(n + 4), ...extra });
  const fase = (n, extra) => faseReserva(res(n, extra), base).fase;

  ok("R9 hoje: começa em 3h (mesmo dia do calendário)", fase(3) === "hoje");
  ok("R9b hoje à noite: 23h do mesmo dia ainda é 'hoje'", fase(13) === "hoje");
  /* o caso que a aritmética de horas erraria: 23h de distância, mas é amanhã */
  ok("R9c amanhã às 9h: 23h de distância, e ainda assim 'amanhã'", fase(23) === "amanha");
  ok("R9d amanhã de noite também é 'amanhã'", fase(35) === "amanha");
  /* 47h adiante caem em DOIS dias de calendário → 'proxima' */
  ok("R9e depois de amanhã, dentro das 48h, é 'proxima'", fase(47) === "proxima");
  ok("R9f fora da janela de 48h sai do sino (null)", fase(72) === null && fase(24 * 10) === null);
  ok("R9g janela configurável: com 72h, o que era null entra como 'proxima'",
    faseReserva(res(60), base).fase === null
    && faseReserva(res(60), base, 72).fase === "proxima");

  /* em curso e passada */
  ok("R9h em curso: começou há 1h e termina em 3h", fase(-1) === "em_curso");
  ok("R9i já terminada não é lembrete", fase(-10) === null);
  ok("R9j fim ausente numa reserva passada não vira 'em_curso'",
    faseReserva({ status: "confirmada", inicio: h(-1) }, base).fase === null);

  /* só reserva confirmada é lembrete */
  ok("R9k solicitada/cancelada/concluída não geram lembrete",
    ["solicitada", "cancelada", "concluida"].every((s) => fase(3, { status: s }) === null));
  ok("R9l entrada inválida não quebra",
    faseReserva(null, base).fase === null
    && faseReserva({ status: "confirmada", inicio: "lixo" }, base).fase === null);

  ok("R9m horasAte é informado para ordenar o sino",
    Math.round(faseReserva(res(3), base).horasAte) === 3);
  ok("R9n agora aceita ISO, não só epoch",
    faseReserva(res(3), new Date(base).toISOString()).fase === "hoje");

  /* proximaReserva: db.reservas chega DESCENDENTE, então ordenar importa */
  const lista = [res(100), res(3), res(40)];        // como o banco entrega: distante primeiro
  ok("R9o proximaReserva pega a mais próxima, não a primeira da lista",
    proximaReserva(lista, base)?.inicio === h(3));
  ok("R9p a que está em curso tem precedência (fim ainda no futuro)",
    proximaReserva([res(10), res(-1)], base)?.inicio === h(-1));
  ok("R9q ignora não confirmadas, passadas e lista vazia",
    proximaReserva([res(3, { status: "solicitada" }), res(-10)], base) === null
    && proximaReserva([], base) === null && proximaReserva(null, base) === null);
}

console.log("\n━━ F · paridade com os arquivos fonte ━━");

const sRes = arq("supabase-reservas-assembleias.sql");
const sHist = arq("supabase-historico.sql");
const sSync = arq("supabase-planilha-sync.sql");
const jsx = arq("CondoMasterPro.jsx");
const api = arq("src/lib/api.js");
const notif = arq("src/lib/notificacoes.js");

/* F1 · a policy do morador decide pela matriz e FORÇA status 'solicitada' */
ok("F1 morador_solicita_reserva: jwt_pode('reserva.solicitar') + status forçado",
  /morador_solicita_reserva[\s\S]{0,300}jwt_pode\('reserva\.solicitar'\)[\s\S]{0,100}status = 'solicitada'/.test(sRes));

/* F2 · a RPC exige reserva.decidir e cria a cobrança 'extra' */
ok("F2 confirmar_reserva checa reserva.decidir", sRes.includes("jwt_pode('reserva.decidir')"));
ok("F2b cobrança nasce 'extra' com a taxa da área",
  /insert into public\.cobrancas[\s\S]{0,400}'extra'/.test(sRes));

/* F3 · o sync da planilha pula 'extra' (taxa de reserva não é mora) */
ok("F3 planilha-sync pula tipo extra", /elsif new\.tipo <> 'extra' then/.test(sSync));

/* F4 · histórico cobre as 4 tabelas novas; reservas no bloqueio do desfazer */
{
  const m = sHist.match(/foreach t in array array\[([^\]]+)\]/s);
  const tabelas = m ? [...m[1].matchAll(/'(\w+)'/g)].map(([, x]) => x) : [];
  ok("F4 trg_historico cobre areas_comuns/reservas/assembleias/atas",
    ["areas_comuns", "reservas", "assembleias", "atas"].every((x) => tabelas.includes(x)));
  /* 12/11/2026: reservas SAIU do bloqueio cego e entrou na allowlist — quem
     decide agora é a guarda pelo par antes/depois (R8 prova o espelho JS) */
  const bloqueio = sHist.match(/if a\.entidade in \(([^)]+)\)[\s\S]{0,200}?'entidade_bloqueada'/);
  ok("F4b reservas NÃO está mais no bloqueio cego de dinheiro",
    !!bloqueio && !/'reservas'/.test(bloqueio[1]), bloqueio ? bloqueio[1].replace(/\s+/g, "") : "bloqueio não encontrado");
  ok("F4c areas/reservas/assembleias/atas são desfazíveis (allowlist da RPC)",
    /'nao_desfazivel'/.test(sHist)
    && /a\.entidade not in \([^)]*'areas_comuns'[^)]*'reservas'[^)]*'assembleias'[^)]*'atas'[^)]*\)/s.test(sHist));
  ok("F4d a guarda de reservas recusa taxa paga, informe pendente e taxa cancelada",
    /if a\.entidade = 'reservas' then/.test(sHist)
    && ["taxa_paga", "taxa_informe_pendente", "taxa_cancelada"].every((e) => sHist.includes(`'${e}'`)));
  ok("F4e desfazer a confirmação cancela a cobrança DENTRO do bloco transacional",
    /cancelar_cobranca__base[\s\S]{0,400}raise exception/.test(sHist));
}

/* F4f · a RPC de cancelamento e o que ela garante */
ok("F4f cancelar_reserva existe com justificativa opcional",
  /create or replace function public\.cancelar_reserva\(\s*p_id\s+uuid,\s*p_justificativa text default null/.test(sRes));
ok("F4g cancelar_reserva delega ao corpo real de cancelar_cobranca e propaga as recusas",
  /cancelar_cobranca__base/.test(sRes)
  && /when 'ja_paga'\s+then 'taxa_paga'/.test(sRes)
  && /when 'informe_pendente' then 'taxa_informe_pendente'/.test(sRes)
  && /when 'nao_autorizado'\s+then 'taxa_sem_permissao'/.test(sRes));
/* o corpo de cancelar_cobranca exige cobranca.cancelar (e deve exigir): as
   duas pontas dizem QUAL permissão falta, em vez de um erro opaco */
ok("F4g2 falta de cobranca.cancelar tem recusa própria nas duas pontas",
  /taxa_sem_permissao/.test(sRes)
  && /not public\.jwt_pode\('cobranca\.cancelar'\)[\s\S]{0,120}'taxa_sem_permissao'/.test(sHist)
  && ["taxa_sem_permissao"].every((e) => api.includes(e)));
ok("F4h a taxa é conferida ANTES do update da reserva (return não desfaz escrita)",
  sRes.indexOf("cancelar_cobranca__base") < sRes.indexOf("update public.reservas set status = 'cancelada'"));
ok("F4i o morador cancela só o PRÓPRIO pedido ainda não confirmado",
  /jwt_pode\('reserva\.solicitar'\)[\s\S]{0,200}solicitante_id is distinct from v_dono[\s\S]{0,120}r\.status <> 'solicitada'/.test(sRes));
ok("F4j a tela e o portal cancelam pela RPC (não por UPDATE cru)",
  /cancelarReserva\(r\.id\)/.test(jsx) && /rpc\("cancelar_reserva"/.test(api));
ok("F4k cancelar reserva confirmada exige reserva.decidir na tela",
  /sel\.status === "confirmada" && podeDecidir/.test(jsx));

/* F5 · sino: trigger no SQL, whitelist no api.js, apresentação no módulo */
ok("F5 trigger notifica reserva.solicitada e nunca derruba a escrita",
  /trg_notificar_reservas/.test(sRes)
  && /notificar_reserva_solicitada[\s\S]{0,900}exception when others then[\s\S]{0,40}return new/.test(sRes));
ok("F5b whitelist do feed inclui reserva.solicitada",
  /\.in\("evento", \[[^\]]*"reserva\.solicitada"[^\]]*\]\)/.test(api));
ok("F5c EVENTOS_FEED aponta para a tela reservas",
  /"reserva\.solicitada":\s*\{[^}]*tela:\s*"reservas"/.test(notif));

/* F6 · as abas existem e o portal usa os ids reais da sessão */
ok("F6 NAV tem reservas e assembleias",
  /id: "reservas"[\s\S]{0,120}perm: "tela\.reservas"/.test(jsx)
  && /id: "assembleias"[\s\S]{0,120}perm: "tela\.assembleias"/.test(jsx));
ok("F6b SCREENS renderiza as duas telas",
  /reservas: <Reservas /.test(jsx) && /assembleias: <Assembleias /.test(jsx));
ok("F6c portal solicita com pessoaId/unidadeId da sessão (com fallback)",
  /morador\?\.pessoaId/.test(jsx) && /morador\?\.unidadeId/.test(jsx)
  && /solicitarReserva\(db\.ctx, \{ areaId: f\.area, unidadeId: meuUnidadeId, pessoaId: meuPessoaId/.test(jsx));
ok("F6d erro 23P01 tem tradução amigável no api.js",
  /23P01\|exclusion constraint/.test(api));

/* F8 · lembrete de reserva próxima (12/11/2026) */
ok("F8 o sino do morador usa faseReserva, não mais o filtro cru de toda futura",
  /faseReserva\(r\)/.test(jsx)
  && !/status === "confirmada" && new Date\(r\.inicio\) >= new Date\(\)/.test(jsx));
ok("F8b as quatro fases têm frase de tela",
  ["em_curso", "hoje", "amanha", "proxima"].every((f) => new RegExp(`${f}:`).test(jsx))
  && /LEMBRETE_RESERVA/.test(jsx));
ok("F8c o lembrete é ordenado pela mais próxima e entra antes dos comunicados",
  /sort\(\(a, b\) => a\.horasAte - b\.horasAte\)/.test(jsx)
  && jsx.indexOf("LEMBRETE_RESERVA[fase]") < jsx.indexOf('db.comunic.slice(0, 2).map'));
ok("F8d existe o tique do relógio e ele é dep dos dois sinos",
  /const useTique = \(ms = 600000\)/.test(jsx)
  && /minhasReservas, proxAssembleia, tique, lang\]/.test(jsx)
  && /db, role, perms, tique, lang\]/.test(jsx));
ok("F8e card da próxima reserva no Início do morador",
  /proximaReserva\(minhasReservas\)/.test(jsx) && /L\("Próxima reserva"\)/.test(jsx));
ok("F8f sino da gestão avisa as reservas das próximas 24h",
  /faseReserva\(r, Date\.now\(\), 24\)/.test(jsx)
  && /reserva\(s\) de área nas próximas 24h/.test(jsx));

/* F7 · login devolve pessoaId/unidadeId para o portal */
{
  const login = arq("api/auth/login.js");
  ok("F7 login do morador expõe pessoaId e unidadeId",
    /pessoaId: conta\.pessoas\?\.id/.test(login) && /unidadeId: vincUnidade\?\.unidade_id/.test(login));
}

/* ═══════════════════════════════════════════════════════════════
   Bloco B · BANCO REAL (service role, condomínio TESTE Manuais)

   Prova contra o SQL instalado o que o bloco F só lê como texto: a RPC
   cancelar_reserva está viva, cancelar cancela a TAXA junto, desfazer a
   confirmação pelo Histórico cancela a taxa também, e taxa paga recusa.
   Pula com ⏭️ (não falha) se não houver .env ou se o passo 13 novo ainda
   não tiver rodado — degrade aberto, igual ao resto do app.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n━━ B · banco real (cancelamento e desfazer da taxa) ━━");

const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";   // condomínio TESTE Manuais
const TAXA = 123.45;
const NOME_AREA = "SONDA Cancelamento (apagar)";
/* 2031: longe de qualquer janela das outras sondas e do uso real */
const INICIO = (n) => `2031-0${n}-10T14:00:00Z`;
const FIM = (n) => `2031-0${n}-10T18:00:00Z`;

let admin = null;
try {
  const { createClient } = await import("@supabase/supabase-js");
  const env = Object.fromEntries(
    readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (url && env.SUPABASE_SERVICE_ROLE_KEY) admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);
} catch { /* sem .env ou sem o pacote: o bloco inteiro pula */ }

const criados = { reservas: [], cobrancas: [], areas: [] };
if (!admin) {
  pula("B · banco", "sem .env ou sem SUPABASE_SERVICE_ROLE_KEY");
} else {
  /* B1 · a RPC existe (uuid inexistente → recusa de negócio, não erro de RPC) */
  const sonda = await admin.rpc("cancelar_reserva",
    { p_id: "00000000-0000-0000-0000-000000000000", p_justificativa: "sonda" });
  const ausente = /does not exist|schema cache/i.test(sonda.error?.message || "");
  ok("B1 cancelar_reserva instalada e respondendo",
    !ausente && sonda.data?.erro === "inexistente",
    ausente ? "rode o supabase-reservas-assembleias.sql" : JSON.stringify(sonda.data ?? sonda.error?.message));

  if (ausente) {
    pula("B2…B6", "passo 13 novo não rodou");
  } else {
    /* cenário: uma área COM taxa + unidade e pessoa que já existem no condomínio */
    const { data: uni } = await admin.from("unidades").select("id")
      .eq("condominio_id", COND).is("deletado_em", null).limit(1);
    const { data: pes } = await admin.from("pessoas").select("id").eq("condominio_id", COND).limit(1);
    const { data: area } = await admin.from("areas_comuns")
      .insert({ condominio_id: COND, nome: NOME_AREA, taxa: TAXA, ativa: true }).select().single();
    if (area) criados.areas.push(area.id);

    if (!uni?.length || !pes?.length || !area) {
      pula("B2…B6", "condomínio TESTE Manuais sem unidade/pessoa, ou área não criou");
    } else {
      const novaReserva = async (n) => {
        const { data } = await admin.from("reservas").insert({
          condominio_id: COND, area_id: area.id, unidade_id: uni[0].id,
          solicitante_id: pes[0].id, inicio: INICIO(n), fim: FIM(n),
        }).select().single();
        if (data) criados.reservas.push(data.id);
        return data;
      };
      const statusCobranca = async (id) => (await admin.from("cobrancas")
        .select("status").eq("id", id).single()).data?.status;
      const statusReserva = async (id) => (await admin.from("reservas")
        .select("status, cobranca_id").eq("id", id).single()).data;

      /* B2 · confirmar gera a cobrança da taxa (pré-condição dos outros) */
      const r1 = await novaReserva(1);
      const c1 = await admin.rpc("confirmar_reserva", { p_id: r1.id });
      if (c1.data?.cobranca_id) criados.cobrancas.push(c1.data.cobranca_id);
      ok("B2 confirmar gera a cobrança 'extra' da taxa",
        c1.data?.ok === true && !!c1.data?.cobranca_id && Number(c1.data?.valor) === TAXA,
        JSON.stringify(c1.data ?? c1.error?.message));

      /* B3 · cancelar a reserva cancela a cobrança JUNTO — o furo de 09/11 */
      const x1 = await admin.rpc("cancelar_reserva", { p_id: r1.id, p_justificativa: null });
      const depois1 = await statusReserva(r1.id);
      ok("B3 cancelar a reserva cancela a cobrança da taxa na mesma transação",
        x1.data?.ok === true && x1.data?.taxa_cancelada === true
        && depois1?.status === "cancelada"
        && await statusCobranca(c1.data.cobranca_id) === "cancelada",
        `reserva=${depois1?.status} cobranca=${await statusCobranca(c1.data.cobranca_id)} ${JSON.stringify(x1.data ?? x1.error?.message)}`);

      /* B4 · DESFAZER a confirmação pelo Histórico cancela a taxa também */
      const r2 = await novaReserva(2);
      const c2 = await admin.rpc("confirmar_reserva", { p_id: r2.id });
      if (c2.data?.cobranca_id) criados.cobrancas.push(c2.data.cobranca_id);
      const { data: trilha } = await admin.from("auditoria").select("id")
        .eq("entidade", "reservas").eq("entidade_id", r2.id).eq("acao", "UPDATE")
        .order("id", { ascending: false }).limit(1);
      if (!trilha?.length) {
        pula("B4", "trg_historico não gravou a confirmação (supabase-historico.sql?)");
      } else {
        const d = await admin.rpc("desfazer_alteracao", { p_id: trilha[0].id });
        const volta = await statusReserva(r2.id);
        ok("B4 desfazer a confirmação devolve 'solicitada' E cancela a taxa",
          d.data?.ok === true && volta?.status === "solicitada" && volta?.cobranca_id === null
          && await statusCobranca(c2.data.cobranca_id) === "cancelada",
          `reserva=${volta?.status} cobranca_id=${volta?.cobranca_id} taxa=${await statusCobranca(c2.data.cobranca_id)} ${JSON.stringify(d.data ?? d.error?.message)}`);
      }

      /* B5 · taxa PAGA recusa o cancelamento inteiro (nada de estorno automático) */
      const r3 = await novaReserva(3);
      const c3 = await admin.rpc("confirmar_reserva", { p_id: r3.id });
      if (c3.data?.cobranca_id) criados.cobrancas.push(c3.data.cobranca_id);
      await admin.from("cobrancas").update({ status: "paga" }).eq("id", c3.data.cobranca_id);
      const x3 = await admin.rpc("cancelar_reserva", { p_id: r3.id, p_justificativa: null });
      const firme = await statusReserva(r3.id);
      ok("B5 taxa paga recusa, e a reserva fica como estava",
        x3.data?.ok === false && x3.data?.erro === "taxa_paga" && firme?.status === "confirmada",
        `${JSON.stringify(x3.data ?? x3.error?.message)} reserva=${firme?.status}`);

      /* B6 · pedido do morador cancelado não deixa cobrança nenhuma */
      const r4 = await novaReserva(4);
      const x4 = await admin.rpc("cancelar_reserva", { p_id: r4.id, p_justificativa: null });
      const semTaxa = await statusReserva(r4.id);
      ok("B6 recusar/desistir de um pedido não envolve dinheiro",
        x4.data?.ok === true && x4.data?.taxa_cancelada === false
        && semTaxa?.status === "cancelada" && semTaxa?.cobranca_id === null,
        JSON.stringify(x4.data ?? x4.error?.message));
    }
  }

  /* limpeza: reservas antes das cobranças (FK NO ACTION) e a área no fim.
     A trilha em auditoria FICA — é append-only, e é o comportamento certo. */
  for (const id of criados.reservas) await admin.from("reservas").delete().eq("id", id);
  for (const id of criados.cobrancas) await admin.from("cobrancas").delete().eq("id", id);
  for (const id of criados.areas) await admin.from("areas_comuns").delete().eq("id", id);
  const sobrou = (await admin.from("areas_comuns").select("id").eq("nome", NOME_AREA)).data?.length || 0;
  ok("B7 limpeza: o cenário da sonda não fica no condomínio", sobrou === 0, `${sobrou} área(s)`);
}

console.log(`\n${falhas ? "❌" : "✅"} reservas: ${falhas} falha(s)${puladas ? ` · ${puladas} pulada(s)` : ""}`);
process.exitCode = falhas ? 1 : 0;
