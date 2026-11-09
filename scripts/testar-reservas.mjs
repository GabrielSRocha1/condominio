/* Sondas de RESERVAS E ASSEMBLEIAS (motor puro + paridade de fonte).

   Prova src/lib/reservas.js: janela/conflito advisory (a autoridade é a
   constraint GiST), antecedência mínima, pauta texto⇄jsonb, presenças e
   quórum, transições de status. E prova, por leitura dos ARQUIVOS fonte,
   as costuras que não podem divergir: a policy do morador força status
   'solicitada' e decide por jwt_pode, a RPC confirmar_reserva exige
   reserva.decidir e cria cobrança 'extra', o sync da planilha PULA 'extra',
   o historico cobre as 4 tabelas novas (com reservas no bloqueio do
   desfazer), o sino conhece reserva.solicitada e o NAV/SCREENS têm as abas.

   Uso: node scripts/testar-reservas.mjs */
import { readFileSync } from "node:fs";
import {
  agoraLocal, fimPadrao, conflita, antecedenciaOk, pautaParaJson, pautaParaTexto,
  togglePresenca, quorum, RESERVA_TRANSICOES, podeTransicionar,
} from "../src/lib/reservas.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
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
  ok("F4b reservas está no bloqueio de dinheiro do desfazer",
    /'entidade_bloqueada'[\s\S]{0,600}/.test(sHist)
    && /if a\.entidade in \([^)]*'reservas'[^)]*\)[\s\S]{0,120}'entidade_bloqueada'/.test(sHist));
  ok("F4c areas/assembleias/atas são desfazíveis (allowlist da RPC)",
    /'nao_desfazivel'/.test(sHist)
    && /a\.entidade not in \([^)]*'areas_comuns'[^)]*'assembleias'[^)]*'atas'[^)]*\)/s.test(sHist));
}

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

/* F7 · login devolve pessoaId/unidadeId para o portal */
{
  const login = arq("api/auth/login.js");
  ok("F7 login do morador expõe pessoaId e unidadeId",
    /pessoaId: conta\.pessoas\?\.id/.test(login) && /unidadeId: vincUnidade\?\.unidade_id/.test(login));
}

console.log(`\n${falhas ? "❌" : "✅"} reservas: ${falhas} falha(s)`);
process.exitCode = falhas ? 1 : 0;
