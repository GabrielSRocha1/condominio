/* Sondas dos ENCARGOS DE ATRASO (multa + juros) e do caixa.

   Bloco U (sem banco): o motor puro src/lib/encargos.js — desligado por
   padrão (inclusive para o default histórico da coluna!), carência, multa
   única no mês corrente, juros por mês virado (estilo planilla), regimes
   simples/composto, status pagos fora.

   Bloco E (banco + dev server): liga a cfg no condomínio TESTE Manuais
   (pelo cliente do DIRETOR, provando o RLS), cria uma cobrança vencida e
   prova que o SERVIDOR cobra o devido: informe com o total → sem
   divergência; informe só do principal → divergente; baixa manual com o
   devido → o CAIXA recebe o valor com encargos (exige o
   supabase-encargos.sql — sem ele, pula com aviso: degrada aberto).
   Restaura a cfg e remove tudo que criou.

   Uso: node scripts/testar-encargos.mjs   (bloco E exige npm run dev) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { calcularEncargos, mesesDeAtraso, emAtraso, normalizarEncargosCfg } from "../src/lib/encargos.js";

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
const COMP_SONDA = "2019-06";                           // longe do cenário vivo

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
const perto = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/* ══ U · motor puro (sem banco) ══ */
console.log("━━ U · motor de encargos (puro) ━━");
const HOJE = new Date(2026, 9, 14); // 14/10/2026 — determinístico
const CFG = { ativo: true, multa_pct: 2, juros_am_pct: 2.3, regime: "simples", carencia_dias: 0 };
const cob = (vencimento, status = "vencida", valor = 100000) => ({ valor_original: valor, vencimento, status });

ok("U1 desligado = zero (e o DEFAULT histórico da coluna não liga nada)",
  calcularEncargos(cob("2025-01-10"), { multa_pct: 2, juros_am_pct: 1 }, HOJE).encargos === 0
  && normalizarEncargosCfg({ multa_pct: 2, juros_am_pct: 1 }).ativo === false
  && calcularEncargos(cob("2025-01-10"), null, HOJE).encargos === 0);
ok("U2 no prazo = zero", calcularEncargos(cob("2026-10-20", "emitida"), CFG, HOJE).encargos === 0);
ok("U3 carência segura o começo (5 dias cobre; 3 não)",
  calcularEncargos(cob("2026-10-10"), { ...CFG, carencia_dias: 5 }, HOJE).encargos === 0
  && calcularEncargos(cob("2026-10-10"), { ...CFG, carencia_dias: 3 }, HOJE).multa === 2000);
const mesmoMes = calcularEncargos(cob("2026-10-01"), CFG, HOJE);
ok("U4 atraso no mesmo mês: multa única, juros ainda zero",
  mesmoMes.meses === 0 && mesmoMes.multa === 2000 && mesmoMes.juros === 0 && mesmoMes.total === 102000,
  JSON.stringify(mesmoMes));
const treze = calcularEncargos(cob("2025-09-28"), CFG, HOJE);
ok("U5 13 meses de mora (estilo planilla): juros simples 2,3% × 13",
  treze.meses === 13 && perto(treze.multa, 2000) && perto(treze.juros, 100000 * 0.023 * 13)
  && perto(treze.total, 100000 + 2000 + 29900),
  JSON.stringify(treze));
const comp = calcularEncargos(cob("2025-09-28"), { ...CFG, regime: "composto" }, HOJE);
ok("U6 composto capitaliza (maior que o simples e bate a fórmula)",
  comp.juros > treze.juros && perto(comp.juros, 100000 * (Math.pow(1.023, 13) - 1), 0.5),
  `simples ${treze.juros} · composto ${comp.juros}`);
ok("U7 paga/cancelada não acumulam", calcularEncargos(cob("2025-01-10", "paga"), CFG, HOJE).encargos === 0
  && calcularEncargos(cob("2025-01-10", "cancelada"), CFG, HOJE).encargos === 0);
ok("U8 contagens: mesesDeAtraso e emAtraso nas bordas",
  mesesDeAtraso("2025-08-28", HOJE) === 14 && mesesDeAtraso("2026-10-01", HOJE) === 0
  && emAtraso("2026-10-13", HOJE, 0) === true && emAtraso("2026-10-14", HOJE, 0) === false
  && emAtraso("2026-10-10", HOJE, 4) === false && emAtraso("2026-10-10", HOJE, 3) === true);

/* ══ E · servidor + banco (RLS, informe, baixa, caixa) ══ */
console.log("\n━━ E · encargos no servidor (Manuais) ━━");

const post = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  }).catch(() => null);
  if (!r) return { http: 0 };
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j };
};
const login = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" });
const loginM = await post("auth/login", { perfil: "morador", nome: "Morador Manuais", senha: "teste123" });

if (!login.token || !loginM.token) {
  for (const n of ["cfg pelo diretor", "morador não configura", "informe do devido", "informe só do principal", "baixa manual + caixa", "restauração"])
    pula(n, `login falhou — dev server de pé em ${BASE}? (npm run dev)`);
} else {
  const app = clienteApp(login.token), appM = clienteApp(loginM.token);
  const NONCE = Date.now().toString(36);
  const comprovante = (rotulo) => Buffer.from(`comprovante encargos ${rotulo} ${NONCE} — condomaster`).toString("base64");

  /* estado original para restaurar no fim */
  const { data: antes } = await admin.from("condominios").select("encargos_atraso").eq("id", COND).maybeSingle();

  /* E1 · diretor liga a cfg (RLS tenant_escrita) — e morador NÃO consegue */
  const cfgOn = { ativo: true, multa_pct: 2, juros_am_pct: 2.3, regime: "simples", carencia_dias: 0 };
  const { error: eCfg } = await app.from("condominios").update({ encargos_atraso: cfgOn }).eq("id", COND);
  const { data: lida } = await admin.from("condominios").select("encargos_atraso").eq("id", COND).maybeSingle();
  ok("E1 diretor liga os encargos (RLS permite e grava)", !eCfg && lida?.encargos_atraso?.ativo === true,
    eCfg?.message || JSON.stringify(lida?.encargos_atraso));
  await appM.from("condominios").update({ encargos_atraso: { ativo: false } }).eq("id", COND);
  const { data: aposM } = await admin.from("condominios").select("encargos_atraso").eq("id", COND).maybeSingle();
  ok("E2 morador não altera a configuração", aposM?.encargos_atraso?.ativo === true);

  /* cobrança VENCIDA de sonda: 4 meses de mora (vencimento ~120 dias atrás) */
  const { data: unidades } = await admin.from("unidades")
    .select("id, responsavel_financeiro_id").eq("condominio_id", COND).is("deletado_em", null);
  const alvo = (unidades || []).find((u) => u.responsavel_financeiro_id);
  if (!alvo) {
    for (const n of ["informe do devido", "informe só do principal", "baixa manual + caixa"]) pula(n, "sem unidade com responsável — rode testar-manuais-seed.mjs");
  } else {
    await admin.from("cobrancas").delete().eq("condominio_id", COND).eq("competencia", COMP_SONDA);
    const venc = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const { data: criada, error: eC } = await app.from("cobrancas").insert({
      condominio_id: COND, unidade_id: alvo.id, responsavel_id: alvo.responsavel_financeiro_id,
      competencia: COMP_SONDA, tipo: "extra", valor_original: 100, vencimento: venc, status: "vencida",
    }).select().single();
    ok("E3 cobrança vencida de sonda criada", !eC && !!criada?.id, eC?.message || venc);

    if (criada?.id) {
      const devido = calcularEncargos({ valor_original: 100, vencimento: venc, status: "vencida" }, cfgOn).total;
      const esperado = calcularEncargos({ valor_original: 100, vencimento: venc, status: "vencida" }, cfgOn);
      ok("E4 devido calculado tem mora real (meses ≥ 3)", esperado.meses >= 3 && devido > 102,
        `devido ${devido} (${esperado.meses} meses, juros ${esperado.juros})`);

      /* informe com o DEVIDO → o servidor usa o MESMO motor → sem divergência */
      const i1 = await post("cobrancas/informar-pagamento", {
        cobrancaId: criada.id, forma: "transferencia", valorInformado: devido,
        pagoEm: new Date().toISOString().slice(0, 10),
        arquivoBase64: comprovante("devido"), nomeArquivo: "c1.png", mime: "image/png",
      }, loginM.token);
      ok("E5 informe do valor DEVIDO (com encargos) não diverge",
        i1.http === 200 && i1.divergente === false, i1.error || i1.motivo || `http ${i1.http}`);

      await admin.from("pagamentos_informados").delete().eq("cobranca_id", criada.id);
      await admin.from("cobrancas").update({ status: "vencida" }).eq("id", criada.id);

      /* informe SÓ do principal → divergente (o devido de hoje é maior) */
      const i2 = await post("cobrancas/informar-pagamento", {
        cobrancaId: criada.id, forma: "transferencia", valorInformado: 100,
        pagoEm: new Date().toISOString().slice(0, 10),
        arquivoBase64: comprovante("principal"), nomeArquivo: "c2.png", mime: "image/png",
      }, loginM.token);
      ok("E6 informe só do principal fica divergente", i2.http === 200 && i2.divergente === true,
        i2.error || JSON.stringify({ divergente: i2.divergente, motivo: i2.motivo }));
      await admin.from("pagamentos_informados").delete().eq("cobranca_id", criada.id);
      await admin.from("cobrancas").update({ status: "vencida" }).eq("id", criada.id);

      /* baixa manual com o devido → o CAIXA tem de receber o devido
         (supabase-encargos.sql); função antiga → lança o original (pula) */
      const { data: rB, error: eB } = await app.rpc("registrar_pagamento_manual", {
        p_cobranca_id: criada.id, p_forma: "dinheiro", p_valor: devido,
        p_pago_em: new Date().toISOString(),
        p_justificativa: "Sonda encargos — baixa com principal + encargos",
        p_tx: null, p_informado_id: null,
      });
      ok("E7 baixa manual com o devido (RPC)", !eB && rB?.ok === true && rB?.status === "paga_em_atraso",
        eB?.message || JSON.stringify(rB));
      const { data: lanc } = await admin.from("lancamentos")
        .select("valor").eq("origem_tipo", "cobranca").eq("origem_id", criada.id)
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
      if (lanc && perto(Number(lanc.valor), devido))
        ok("E8 caixa recebeu o valor COM encargos (supabase-encargos.sql ativo)", true, `lançado ${lanc.valor}`);
      else if (lanc && perto(Number(lanc.valor), 100))
        pula("E8 caixa com encargos", "supabase-encargos.sql ainda não rodou — caixa no valor original (degrada aberto)");
      else
        ok("E8 caixa recebeu o valor COM encargos", false, `lançamento ${JSON.stringify(lanc)}`);

      /* limpeza: tudo que a sonda criou sai; cfg volta ao que era */
      await admin.from("pagamentos").delete().eq("cobranca_id", criada.id);
      await admin.from("lancamentos").delete().eq("origem_tipo", "cobranca").eq("origem_id", criada.id);
      await admin.from("pagamentos_informados").delete().eq("cobranca_id", criada.id);
      await admin.from("cobrancas").delete().eq("id", criada.id);
    }
  }
  await admin.from("condominios").update({ encargos_atraso: antes?.encargos_atraso ?? { multa_pct: 2, juros_am_pct: 1 } }).eq("id", COND);
  const { data: depois } = await admin.from("condominios").select("encargos_atraso").eq("id", COND).maybeSingle();
  ok("E9 configuração restaurada (Manuais intacto para as outras sondas)",
    JSON.stringify(depois?.encargos_atraso) === JSON.stringify(antes?.encargos_atraso ?? { multa_pct: 2, juros_am_pct: 1 }));
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n💰 ENCARGOS DE ATRASO OK${puladas ? ` · ${puladas} pulada(s)` : ""}`);
/* exitCode em vez de process.exit(): sockets abertos derrubam o libuv no Windows */
process.exitCode = falhas ? 1 : 0;
