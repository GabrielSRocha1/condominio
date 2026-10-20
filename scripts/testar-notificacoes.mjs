/* Sondas do FEED DE MOVIMENTAÇÕES do sino (motor puro, sem banco).

   Prova src/lib/notificacoes.js: os 3 eventos conhecidos viram item com
   chave/cor/tela certos, evento desconhecido cai no titulo persistido (o
   sino nunca quebra com evento novo), payload nulo/corrompido não explode,
   contagem de não-vistas compara instantes absolutos (tolera "+00:00" vs
   "Z" e frações diferentes), horaCurta converte UTC→fuso local e a chave
   do "visto até" separa condomínio × perfil.

   Uso: node scripts/testar-notificacoes.mjs */
import {
  EVENTOS_FEED, formatarNotificacao, contarNaoVistas, ehNova, horaCurta, chaveVisto, maisRecente,
} from "../src/lib/notificacoes.js";

let falhas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};

console.log("━━ N · feed de movimentações do sino (puro) ━━");

/* N1 · entrada recebida: unidade · MM/AAAA, cor ok, vai para Cobranças */
const ent = formatarNotificacao({
  id: "n1", evento: "pagamento.confirmado", titulo: "fallback não usado",
  payload: { valor: 350.5, unidade: "101-A", competencia: "2026-05", origem: "baixa_manual" },
  criado_em: "2026-10-19T12:00:00+00:00",
});
ok("N1 pagamento.confirmado → Entrada recebida · 101-A · 05/2026 · ok · cobrancas",
  ent.chave === "Entrada recebida" && ent.detalhe === "101-A · 05/2026"
  && ent.valor === 350.5 && ent.cor === "ok" && ent.tela === "cobrancas"
  && ent.quando === "2026-10-19T12:00:00+00:00",
  JSON.stringify({ detalhe: ent.detalhe }));

/* N2 · conta paga e receita avulsa: descrição como detalhe, telas certas */
const paga = formatarNotificacao({ id: "n2", evento: "conta.paga", titulo: "t",
  payload: { valor: 1200, descricao: "Energia elétrica" } });
const rec = formatarNotificacao({ id: "n3", evento: "receita.recebida", titulo: "t",
  payload: { valor: 90, descricao: "Aluguel do salão" } });
ok("N2 conta.paga (warn) e receita.recebida (ok) → financeiro, detalhe = descrição",
  paga.chave === "Conta paga" && paga.cor === "warn" && paga.tela === "financeiro"
  && paga.detalhe === "Energia elétrica" && paga.valor === 1200
  && rec.chave === "Receita recebida" && rec.cor === "ok" && rec.tela === "financeiro"
  && rec.detalhe === "Aluguel do salão");

/* N3 · evento desconhecido (futuro) cai no titulo gravado pelo trigger */
const fut = formatarNotificacao({ id: "n4", evento: "multa.emitida",
  titulo: "Multa emitida — unidade 302", payload: { valor: "77.9" } });
ok("N3 evento desconhecido: chave null, detalhe = titulo persistido, info/financeiro",
  fut.chave === null && fut.detalhe === "Multa emitida — unidade 302"
  && fut.cor === "info" && fut.tela === "financeiro" && fut.valor === 77.9);

/* N4 · payload nulo/corrompido e campos faltando não explodem */
const nu = formatarNotificacao({ id: "n5", evento: "pagamento.confirmado", titulo: "t", payload: null });
const corr = formatarNotificacao({ id: "n6", evento: "conta.paga", titulo: "t", payload: "lixo" });
const semComp = formatarNotificacao({ id: "n7", evento: "pagamento.confirmado", titulo: "t",
  payload: { valor: 10, unidade: "12-B", competencia: "???" } });
ok("N4 payload nulo/corrompido: valor null, detalhe vazio/sem competência, nada lança",
  nu.detalhe === "" && nu.valor === null && corr.detalhe === "" && corr.valor === null
  && semComp.detalhe === "12-B" && formatarNotificacao(null).valor === null);

/* N5 · não-vistas: nunca visto → todas; igual não conta; "+00:00" vs "Z" e
   frações diferentes comparam como instante, não como string */
const feed = [
  { criado_em: "2026-10-19T12:00:00.5+00:00" },
  { criado_em: "2026-10-19T12:00:00Z" },
  { criado_em: "2026-10-19T11:59:59+00:00" },
];
ok("N5 contarNaoVistas: sem visto, visto no meio, igual não conta, futuro zera",
  contarNaoVistas(feed, null) === 3
  && contarNaoVistas(feed, "2026-10-19T12:00:00.000Z") === 1 // só a .5 é nova
  && contarNaoVistas(feed, "2026-10-19T12:30:00Z") === 0
  && contarNaoVistas(feed, "lixo") === 3, // visto ilegível = nunca visto
  `meio=${contarNaoVistas(feed, "2026-10-19T12:00:00.000Z")}`);

/* N6 · feed indisponível (SQL não rodado → null) e itens sem data */
ok("N6 contarNaoVistas degrada: feed null/undefined → 0, item sem criado_em não conta",
  contarNaoVistas(null, null) === 0 && contarNaoVistas(undefined, "x") === 0
  && contarNaoVistas([{ criado_em: null }], null) === 1 // sem visto, length conta
  && contarNaoVistas([{ criado_em: null }], "2026-01-01T00:00:00Z") === 0);

/* N6b · ehNova (destaque do dropdown): instante, não string; sem visto tudo
   é novo; igual não é novo; item sem data nunca destaca */
ok("N6b ehNova: '+00:00' > 'Z' compara como instante; null visto → novo; sem data → não",
  ehNova("2026-10-19T12:00:00.5+00:00", "2026-10-19T12:00:00.000Z") === true
  && ehNova("2026-10-19T12:00:00+00:00", "2026-10-19T12:00:00.000Z") === false
  && ehNova("2026-10-19T12:00:00Z", null) === true
  && ehNova(null, null) === false && ehNova("lixo", "2026-01-01T00:00:00Z") === false);

/* N7 · horaCurta exibe no fuso LOCAL (constrói local → ISO UTC → volta) */
const local = new Date(2026, 9, 19, 14, 5); // 19/10/2026 14:05 no fuso da máquina
ok("N7 horaCurta: UTC do banco vira dd/mm hh:mm local; lixo vira vazio",
  horaCurta(local.toISOString()) === "19/10 14:05"
  && horaCurta(null) === "" && horaCurta("lixo") === "",
  horaCurta(local.toISOString()));

/* N8b · maisRecente (gatilho do reload entre janelas): acha o topo sem
   confiar na ordem, ignora datas ilegíveis, degrada para null */
ok("N8b maisRecente: máximo fora de ordem, formatos mistos, vazio/null → null",
  maisRecente([
    { criado_em: "2026-10-19T11:00:00Z" },
    { criado_em: "2026-10-19T12:00:00.5+00:00" }, // o mais novo, no meio
    { criado_em: "lixo" },
    { criado_em: "2026-10-19T12:00:00Z" },
  ]) === "2026-10-19T12:00:00.5+00:00"
  && maisRecente([]) === null && maisRecente(null) === null
  && maisRecente([{ criado_em: null }]) === null
  /* contrato com ehNova: topo novo dispara, repetido não */
  && ehNova("2026-10-19T12:00:00.5+00:00", "2026-10-19T12:00:00Z") === true
  && ehNova("2026-10-19T12:00:00.5+00:00", "2026-10-19T12:00:00.5+00:00") === false);

/* N8 · chave do visto separa condomínio × perfil; mapa cobre os 3 eventos */
ok("N8 chaveVisto por condomínio e perfil; EVENTOS_FEED cobre os 3 eventos",
  chaveVisto("c1", "diretor") === "c1:diretor"
  && chaveVisto("c1", "diretor") !== chaveVisto("c1", "tesouraria")
  && chaveVisto("c1", "diretor") !== chaveVisto("c2", "diretor")
  && chaveVisto(null, null) === "?:?"
  && Object.keys(EVENTOS_FEED).length === 3);

console.log(falhas ? `\n❌ ${falhas} sonda(s) falharam` : "\n🔔 FEED DE MOVIMENTAÇÕES OK");
process.exitCode = falhas ? 1 : 0;
