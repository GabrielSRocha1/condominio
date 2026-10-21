/* Sondas de segurança da Etapa 2 (infraestrutura + transações).
   Roda contra o dev server (localhost:5173) usando o condomínio TESTE
   Manuais. Se o supabase-seguranca2.sql ainda não rodou, as sondas de
   idempotência são puladas com aviso. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { assinarToken } from "../api/_lib/seguranca.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = "http://localhost:5173";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

const post = async (rota, body, { token, origin, chave } = {}) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(chave ? { "Idempotency-Key": chave } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, corpo: j, replay: r.headers.get("idempotency-replayed") === "true" };
};

const { error: eTab } = await admin.from("api_idempotencia").select("chave").limit(1);
const sql2 = !eTab;
console.log(sql2
  ? "ℹ️ supabase-seguranca2.sql: APLICADO — rodando todas as sondas\n"
  : "ℹ️ supabase-seguranca2.sql: AINDA NÃO APLICADO — sondas de idempotência serão puladas\n");

/* logins */
const lgD = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" });
const lgM = await post("auth/login", { perfil: "morador", nome: "Morador Manuais", senha: "teste123" });
ok("logins de teste funcionam", lgD.http === 200 && lgM.http === 200);

/* ══ 1 · gateway: origem estrita ══ */
console.log("\n━━ origem estrita (anti-CSRF) ━━");
const o1 = await post("stripe/licenca", { condominioId: COND }, { token: lgD.corpo.token, origin: "https://site-malicioso.dev" });
ok("POST sensível com Origin alheia → 403", o1.http === 403, `${o1.http}`);
const o2 = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" }, { origin: "https://site-malicioso.dev" });
ok("login com Origin alheia → 403", o2.http === 403, `${o2.http}`);
const o3 = await post("stripe/licenca", { condominioId: COND }, { token: lgD.corpo.token, origin: `http://localhost:5173` });
ok("Origin legítima (mesmo host) passa", o3.http === 200, `${o3.http}`);
const o4 = await post("stripe/licenca", { condominioId: COND }, { token: lgD.corpo.token });
ok("sem Origin (scripts/serviços) passa", o4.http === 200, `${o4.http}`);

/* ══ 2 · idempotência de transações ══ */
console.log("\n━━ idempotência ━━");
if (!sql2) {
  pula("replay de Idempotency-Key não duplica informe", "rode supabase-seguranca2.sql e teste de novo");
} else {
  /* cobrança de teste própria (não mexe no roteiro visual) */
  const { data: unidade } = await admin.from("unidades").select("id, responsavel_financeiro_id")
    .eq("condominio_id", COND).limit(1).single();
  const { data: cobr, error: eCobr } = await admin.from("cobrancas").insert({
    condominio_id: COND, unidade_id: unidade.id, responsavel_id: unidade.responsavel_financeiro_id,
    competencia: "2026-10", tipo: "extra", valor_original: 77,
    vencimento: "2026-10-28", status: "emitida",
  }).select("id").single();
  if (eCobr) { console.error(eCobr.message); process.exit(1); }

  const chave = randomUUID();
  const corpoInforme = {
    cobrancaId: cobr.id, forma: "transferencia", valorInformado: 77,
    pagoEm: "2026-09-07",
    arquivoBase64: Buffer.from(`comprovante idempotencia ${chave}`).toString("base64"),
    nomeArquivo: "idem.png", mime: "image/png",
  };
  const i1 = await post("cobrancas/informar-pagamento", corpoInforme, { token: lgM.corpo.token, chave });
  ok("1ª chamada processa normal", i1.http === 200 && !i1.replay, `${i1.http}`);
  const i2 = await post("cobrancas/informar-pagamento", corpoInforme, { token: lgM.corpo.token, chave });
  ok("retry com a MESMA chave → replay", i2.http === 200 && i2.replay === true, `replay=${i2.replay}`);
  /* o jsonb do Postgres reordena as chaves — compara de forma canônica */
  const canonico = (o) => JSON.stringify(o, o && typeof o === "object" ? Object.keys(o).sort() : undefined);
  ok("resposta do replay idêntica à original", canonico(i1.corpo) === canonico(i2.corpo),
    canonico(i1.corpo) === canonico(i2.corpo) ? "" : `${canonico(i1.corpo)} ≠ ${canonico(i2.corpo)}`);
  const { data: informes } = await admin.from("pagamentos_informados")
    .select("id").eq("cobranca_id", cobr.id);
  ok("apenas UM informe no banco (nada duplicou)", informes?.length === 1, `${informes?.length}`);

  /* chave diferente = operação nova (guard de pendência entra em ação) */
  const i3 = await post("cobrancas/informar-pagamento", corpoInforme, { token: lgM.corpo.token, chave: randomUUID() });
  ok("chave nova cai na regra de negócio (já há pendente) → 409", i3.http === 409, `${i3.http}`);

  /* limpeza: some com a cobrança de teste e o rastro */
  const { data: docs } = await admin.from("pagamentos_informados").select("documento_id").eq("cobranca_id", cobr.id);
  await admin.from("pagamentos_informados").delete().eq("cobranca_id", cobr.id);
  for (const d of docs || []) if (d.documento_id) await admin.from("documentos").delete().eq("id", d.documento_id).then(() => {}, () => {});
  await admin.from("cobrancas").delete().eq("id", cobr.id);
  await admin.from("api_idempotencia").delete().like("rota", "%informar%");
}

/* ══ 3 · OpSec: redação de logs ══ */
console.log("\n━━ redação de logs ━━");
const { logSeguro } = await import("../api/_lib/seguranca.js");
let capturado = "";
const consoleError = console.error;
console.error = (...a) => { capturado = a.join(" "); };
logSeguro("[probe]", new Error(
  "falhou com Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk " +
  "sk_test_abc123XYZ whsec_topsecret cm_refresh=tokenzao senha: \"minhasenha\""));
console.error = consoleError;
ok("JWT redigido", !capturado.includes("eyJhbGciOiJIUzI1NiJ9"), "");
ok("chave Stripe redigida", !capturado.includes("sk_test_abc123XYZ"));
ok("segredo de webhook redigido", !capturado.includes("whsec_topsecret"));
ok("cookie de refresh redigido", !capturado.includes("tokenzao"));

/* ══ 4 · encoding contextual (impressão de multa) ══
   único sink de HTML manual do app: o document.write do timbrado. O esc()
   precisa escapar TAMBÉM aspas — logoUrl entra em atributo src="…" e uma
   aspa sem &quot; escaparia do atributo (injeção de handler = XSS). */
console.log("\n━━ encoding da impressão ━━");
const jsx = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
const mEsc = jsx.match(/const esc = (\(s\) => String\(s \|\| ""\)[^\n]*);/);
const escFn = mEsc ? eval(mEsc[1]) : null;
ok('esc() escapa & < > e aspas (contexto de atributo src="…")',
  !!escFn && escFn('"<x>&') === "&quot;&lt;x&gt;&amp;",
  escFn ? escFn('"<x>&') : "esc() não encontrado no CondoMasterPro.jsx");

/* ══ 5 · rate limit da criação de condomínio ══
   o token pré-condomínio (condominio_id nulo) vale 1h — sem limite, replays
   criariam condomínios sem fim. A sonda usa uma conta FANTASMA: o limitador
   responde antes da busca do usuário, então nada é criado no banco. */
console.log("\n━━ rate limit do condomínio ━━");
const subSonda = randomUUID();
const tokenPre = assinarToken({ sub: subSonda, email: "sonda.condominio@teste.condomaster.dev",
  nome: "Sonda", perfil: "diretor", condominio_id: null }, env.SUPABASE_JWT_SECRET);
const corpoCond = { nome: "Sonda Cond", cnpj: "11.111.111/0001-11", cpf: "111.111.111-11", endereco: "Rua X, 1" };
const c5a = await post("auth/condominio", corpoCond, { token: tokenPre });
ok("1ª chamada passa do limitador (401: conta fantasma não existe)", c5a.http === 401, `${c5a.http}`);
for (let i = 0; i < 5; i++)
  await admin.rpc("registrar_tentativa", { p_chave: `condominio:${subSonda}`, p_janela_seg: 3600, p_max: 5, p_bloqueio_seg: 3600 });
const c5b = await post("auth/condominio", corpoCond, { token: tokenPre });
ok("balde estourado → 429 (nada criado)", c5b.http === 429, `${c5b.http}`);
await admin.from("auth_protecao").delete().eq("chave", `condominio:${subSonda}`);

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🛡️ ETAPA 2 OK${puladas ? ` · ${puladas} sonda(s) aguardando o supabase-seguranca2.sql` : ""}`);
process.exit(falhas ? 1 : 0);
