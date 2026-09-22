/* Sondas das Etapas 4+5 — recuperação de senha.
   · Etapa 4 (CÓDIGO): tesouraria e morador — /api/auth/codigo (permanente
     próprio), /api/auth/acessos acao "codigo" (24h pelo diretor) e
     /api/auth/recuperar.
   · Etapa 5 (LINK POR E-MAIL): diretor e síndico — /api/auth/esqueci envia
     o link (SMTP próprio) e /api/auth/redefinir consome o token. O
     redefinir é sondado com token SEMEADO via service role — dispensa
     SMTP e caixa de entrada; do esqueci se confere a neutralidade
     (resposta idêntica exista a conta ou não) e a recusa de `.local`.
   Roda contra o dev server (localhost:5173) usando o condomínio TESTE
   Manuais. Detecta sozinho o que está instalado: sem o
   supabase-seguranca4.sql pula o fluxo por código; sem o
   supabase-seguranca5.sql ou sem SMTP_*, as sondas correspondentes viram
   verificação do 503 (degrada aberto). Restaura o estado ao final. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BASE = process.env.BASE || "http://localhost:5173";
const SENHA = "teste123";
const EMAIL_DIRETOR = "diretor.manuais@teste.condomaster.dev";
const EMAIL_SINDICO = "sindico.recuperacao@teste.condomaster.dev";
const EMAIL_TESOURARIA = "tesouraria.recuperacao@teste.condomaster.dev";
const NOME_MORADOR = "Probe Recuperacao Morador";
const RX_CODIGO = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const sha256 = (t) => createHash("sha256").update(t).digest("hex");

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

const post = async (rota, body, { token } = {}) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { http: r.status, corpo: await r.json().catch(() => ({})) };
};

/* limpeza reaproveitável: acessos e contadores que esta sonda cria */
async function limpar(token) {
  const lista = await post("auth/acessos", { acao: "listar" }, { token });
  for (const a of lista.corpo.acessos || []) {
    if (a.email === EMAIL_SINDICO || a.email === EMAIL_TESOURARIA || a.nome === NOME_MORADOR)
      await post("auth/acessos", { acao: "remover", usuarioId: a.id }, { token });
  }
  for (const padrao of ["recuperar:%", "esqueci:%", "redefinir:%"])
    await admin.from("auth_protecao").delete().like("chave", padrao).then(() => {}, () => {});
}

/* ══ o que está instalado? ══ */
const { error: eTab } = await admin.from("auth_recuperacao").select("id").limit(1);
const sql4 = !eTab;
const { error: eCanal } = await admin.from("auth_recuperacao").select("canal").limit(1);
const sql5 = sql4 && !eCanal;
/* SMTP: um esqueci de e-mail inexistente responde 503 com "SMTP" quando as
   envs faltam; qualquer outra resposta = envio configurado */
const pSmtp = await post("auth/esqueci", { perfil: "diretor", email: "probe.smtp@invalido.condomaster.dev" });
const smtp = !(pSmtp.http === 503 && /SMTP/i.test(pSmtp.corpo.error || ""));
console.log(`ℹ️ supabase-seguranca4.sql: ${sql4 ? "APLICADO" : "AINDA NÃO APLICADO — fluxo por código vira sonda de 503"}`);
console.log(`ℹ️ supabase-seguranca5.sql: ${sql5 ? "APLICADO" : "AINDA NÃO APLICADO — redefinir vira sonda de 503"}`);
console.log(`ℹ️ SMTP: ${smtp ? "CONFIGURADO" : "SEM CONFIG — esqueci deve responder 503 (verificado) e as sondas de envio são puladas"}\n`);

/* ══ 1 · validação, autorização e gates por perfil ══ */
console.log("━━ validação, autorização e gates ━━");
const lg = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
ok("login do diretor funciona", lg.http === 200 && !!lg.corpo.token, `${lg.http}`);
const TOKEN = lg.corpo.token;
if (!TOKEN) { console.log("\nSem diretor de teste — rode as sondas da Etapa 1 antes."); process.exit(1); }
await limpar(TOKEN); // estado limpo de execuções anteriores

ok("diretor no login → temCodigoRecuperacao=true (nunca é convidado a gerar código)",
  lg.corpo.conta?.temCodigoRecuperacao === true, String(lg.corpo.conta?.temCodigoRecuperacao));

/* gates independem dos SQLs: são recusas de perfil no próprio código */
const gDir = await post("auth/recuperar", { perfil: "diretor", email: EMAIL_DIRETOR, codigo: "ZZZZ-ZZZZ-ZZZZ-ZZZZ", senha: "novaSenha1" });
ok("recuperar por código como diretor → 403 (agora é por link)", gDir.http === 403, `${gDir.http}`);
const gSin = await post("auth/recuperar", { perfil: "sindico", email: EMAIL_SINDICO, codigo: "ZZZZ-ZZZZ-ZZZZ-ZZZZ", senha: "novaSenha1" });
ok("recuperar por código como síndico → 403", gSin.http === 403, `${gSin.http}`);
const gCod = await post("auth/codigo", {}, { token: TOKEN });
ok("código próprio como diretor → 403", gCod.http === 403, `${gCod.http}`);
const gPro = await post("auth/acessos", { acao: "codigo" }, { token: TOKEN });
ok("acessos codigo sem usuarioId (o próprio diretor) → 403", gPro.http === 403, `${gPro.http}`);

const v1 = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, senha: "12345678" });
ok("recuperar sem código → 400", v1.http === 400, `${v1.http}`);
const v2 = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, codigo: "AAAA", senha: "1234567" });
ok("recuperar com senha curta → 400", v2.http === 400, `${v2.http}`);
const v3 = await post("auth/acessos", { acao: "codigo" });
ok("gerar código sem token → 403", v3.http === 403, `${v3.http}`);
const v4 = await post("auth/esqueci", { perfil: "tesouraria", email: EMAIL_TESOURARIA });
ok("esqueci só aceita diretor/síndico → 400", v4.http === 400 || (v4.http === 503 && !smtp), `${v4.http}`);
const c0 = await post("auth/codigo", {});
ok("gerar o próprio código sem token → 401", c0.http === 401, `${c0.http}`);

if (!sql4) {
  const d1 = await post("auth/acessos", { acao: "codigo", usuarioId: "00000000-0000-0000-0000-000000000000" }, { token: TOKEN });
  ok("gerar código sem a tabela → 404/503 (degrada com aviso)", d1.http === 503 || d1.http === 404, `${d1.http}`);
  pula("fluxo por código (tesouraria/morador)", "rode o supabase-seguranca4.sql e repita");
} else {
  /* ══ 2 · síndico: só gates (o código saiu para ele) ══ */
  console.log("\n━━ síndico (agora por link — só gates) ━━");
  const cr = await post("auth/acessos", { acao: "criar", perfil: "sindico", email: EMAIL_SINDICO, senha: SENHA }, { token: TOKEN });
  ok("acesso de síndico criado para a sonda", cr.http === 200 && !!cr.corpo.id, `${cr.http}`);
  const SINDICO_ID = cr.corpo.id;
  const lgS = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: SENHA });
  ok("síndico entra com a senha", lgS.http === 200, `${lgS.http}`);
  ok("síndico no login → temCodigoRecuperacao=true (não é convidado)",
    lgS.corpo.conta?.temCodigoRecuperacao === true, String(lgS.corpo.conta?.temCodigoRecuperacao));
  const gS1 = await post("auth/codigo", {}, { token: lgS.corpo.token });
  ok("código próprio como síndico → 403", gS1.http === 403, `${gS1.http}`);
  const gS2 = await post("auth/acessos", { acao: "codigo", usuarioId: SINDICO_ID }, { token: TOKEN });
  ok("diretor NÃO gera código para síndico → 403", gS2.http === 403, `${gS2.http}`);

  /* ══ 3 · tesouraria: código de 24h + autonomia (fluxo migrado do síndico) ══ */
  console.log("\n━━ tesouraria (código de 24h + autonomia) ━━");
  const ct = await post("auth/acessos", { acao: "criar", perfil: "tesouraria", email: EMAIL_TESOURARIA, senha: SENHA }, { token: TOKEN });
  ok("acesso de tesouraria criado para a sonda", ct.http === 200 && !!ct.corpo.id, `${ct.http}`);
  const TES_ID = ct.corpo.id;

  const lgT = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TESOURARIA, senha: SENHA });
  ok("tesouraria entra com a senha original", lgT.http === 200, `${lgT.http}`);
  ok("tesouraria sem código → temCodigoRecuperacao=false (convite continua)",
    lgT.corpo.conta?.temCodigoRecuperacao === false, String(lgT.corpo.conta?.temCodigoRecuperacao));
  const g0 = await post("auth/acessos", { acao: "codigo", usuarioId: TES_ID }, { token: lgT.corpo.token });
  ok("tesouraria NÃO gera código de 24h (só diretor) → 403", g0.http === 403, `${g0.http}`);

  const g1 = await post("auth/acessos", { acao: "codigo", usuarioId: TES_ID }, { token: TOKEN });
  ok("diretor gera código para a tesouraria", g1.http === 200 && RX_CODIGO.test(g1.corpo.codigo || ""), g1.corpo.codigo || `${g1.http}`);
  const em24h = g1.corpo.expiraEm && Math.abs(new Date(g1.corpo.expiraEm) - Date.now() - 24 * 3600e3) < 60e3;
  ok("código da tesouraria expira em ~24h", !!em24h, g1.corpo.expiraEm || "sem expiraEm");

  const r1 = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, codigo: "ZZZZ-ZZZZ-ZZZZ-ZZZZ", senha: "novaSenha1" });
  ok("código errado → 401 genérico", r1.http === 401 && !/existe|cadastr/i.test(r1.corpo.error || ""), `${r1.http}`);
  const r2 = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, codigo: g1.corpo.codigo, senha: "novaSenha1" });
  ok("código certo redefine a senha", r2.http === 200, `${r2.http}`);
  const lgVelha = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TESOURARIA, senha: SENHA });
  ok("senha antiga morreu → 401", lgVelha.http === 401, `${lgVelha.http}`);
  const lgNova = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TESOURARIA, senha: "novaSenha1" });
  ok("senha nova entra", lgNova.http === 200, `${lgNova.http}`);
  const r3 = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, codigo: g1.corpo.codigo, senha: "novaSenha2" });
  ok("reuso do código → 401 (uso único)", r3.http === 401, `${r3.http}`);

  /* código expirado: vence no banco e tenta usar */
  const g2 = await post("auth/acessos", { acao: "codigo", usuarioId: TES_ID }, { token: TOKEN });
  await admin.from("auth_recuperacao").update({ expira_em: new Date(Date.now() - 60e3).toISOString() })
    .eq("usuario_id", TES_ID).is("usado_em", null);
  const r4 = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, codigo: g2.corpo.codigo, senha: "novaSenha3" });
  ok("código expirado → 401", r4.http === 401, `${r4.http}`);

  /* autonomia: a própria tesouraria gera o código permanente */
  const c1 = await post("auth/codigo", {}, { token: lgNova.corpo.token });
  ok("tesouraria gera o PRÓPRIO código permanente", c1.http === 200 && RX_CODIGO.test(c1.corpo.codigo || "") && c1.corpo.expiraEm === null,
    c1.corpo.expiraEm === null ? c1.corpo.codigo : `${c1.http} expiraEm=${c1.corpo.expiraEm}`);
  const lgT2 = await post("auth/login", { perfil: "tesouraria", email: EMAIL_TESOURARIA, senha: "novaSenha1" });
  ok("com código ativo → temCodigoRecuperacao=true", lgT2.corpo.conta?.temCodigoRecuperacao === true,
    String(lgT2.corpo.conta?.temCodigoRecuperacao));
  const r5b = await post("auth/recuperar", { perfil: "tesouraria", email: EMAIL_TESOURARIA, codigo: c1.corpo.codigo, senha: "novaSenha5" });
  ok("tesouraria se recupera SOZINHA com o próprio código", r5b.http === 200, `${r5b.http}`);

  /* ══ 4 · morador: identifica pelo nome ══ */
  console.log("\n━━ morador (pelo nome) ━━");
  const cm = await post("auth/acessos", { acao: "criar", perfil: "morador", nome: NOME_MORADOR, senha: SENHA }, { token: TOKEN });
  ok("acesso de morador criado para a sonda", cm.http === 200 && !!cm.corpo.id, `${cm.http}`);
  const g3 = await post("auth/acessos", { acao: "codigo", usuarioId: cm.corpo.id }, { token: TOKEN });
  const r5 = await post("auth/recuperar", { perfil: "morador", nome: NOME_MORADOR, codigo: g3.corpo.codigo, senha: "novaSenha4" });
  ok("morador redefine pelo nome + código", r5.http === 200, `${r5.http}`);
  const lgM = await post("auth/login", { perfil: "morador", nome: NOME_MORADOR, senha: "novaSenha4" });
  ok("morador entra com a senha nova", lgM.http === 200, `${lgM.http}`);

  /* ══ 5 · esqueci: link por e-mail (diretor/síndico) ══ */
  console.log("\n━━ esqueci (link por e-mail) ━━");
  if (!smtp) {
    ok("esqueci sem SMTP → 503 com instrução das envs", pSmtp.http === 503 && /SMTP/i.test(pSmtp.corpo.error || ""), `${pSmtp.http}`);
    pula("neutralidade e criação de token do esqueci", "configure SMTP_HOST/PORT/USER/PASS (ex.: smtp4dev local) e repita");
  } else if (!sql5) {
    const e1 = await post("auth/esqueci", { perfil: "sindico", email: EMAIL_SINDICO });
    ok("esqueci de conta real sem o sql5 → 503 (degrada com aviso)", e1.http === 503 && /seguranca5/i.test(e1.corpo.error || ""), `${e1.http}`);
    pula("neutralidade e criação de token do esqueci", "rode o supabase-seguranca5.sql e repita");
  } else {
    const eNao = await post("auth/esqueci", { perfil: "diretor", email: "nao.existe@invalido.condomaster.dev" });
    const eSim = await post("auth/esqueci", { perfil: "sindico", email: EMAIL_SINDICO });
    ok("conta inexistente → 200 neutro", eNao.http === 200 && eNao.corpo.ok === true, `${eNao.http}`);
    ok("conta existente → 200 neutro IDÊNTICO (anti-enumeração)",
      eSim.http === 200 && JSON.stringify(eSim.corpo) === JSON.stringify(eNao.corpo), `${eSim.http}`);
    const { data: tokReal } = await admin.from("auth_recuperacao")
      .select("expira_em").eq("usuario_id", SINDICO_ID).eq("canal", "email").is("usado_em", null);
    const em60 = tokReal?.length === 1 && Math.abs(new Date(tokReal[0].expira_em) - Date.now() - 3600e3) < 120e3;
    ok("pedido real criou exatamente 1 token de e-mail (~60 min)", !!em60, `linhas=${tokReal?.length}`);
    const eLocal = await post("auth/esqueci", { perfil: "sindico", email: "morador+fulano@abcd1234.local" });
    ok("e-mail sintético .local → 200 neutro", eLocal.http === 200, `${eLocal.http}`);
    const { count: nLocal } = await admin.from("auth_recuperacao")
      .select("id", { count: "exact", head: true }).eq("canal", "email").gt("criado_em", new Date(Date.now() - 5000).toISOString());
    ok(".local não criou token novo", (nLocal || 0) <= 1, `tokens recentes=${nLocal}`);
  }

  /* ══ 6 · redefinir: consome o token do link (semeado via service role) ══ */
  console.log("\n━━ redefinir (token do link) ━━");
  const rv = await post("auth/redefinir", { token: "nao-e-hex", senha: "novaSenha7" });
  ok("token malformado → 400", rv.http === 400, `${rv.http}`);
  const rv2 = await post("auth/redefinir", { token: randomBytes(32).toString("hex"), senha: "1234567" });
  ok("senha curta → 400", rv2.http === 400, `${rv2.http}`);
  if (!sql5) {
    const rd = await post("auth/redefinir", { token: randomBytes(32).toString("hex"), senha: "novaSenha7" });
    ok("redefinir sem o sql5 → 503 (degrada com aviso)", rd.http === 503 && /seguranca5/i.test(rd.corpo.error || ""), `${rd.http}`);
    pula("fluxo completo do redefinir", "rode o supabase-seguranca5.sql e repita");
  } else {
    const rAle = await post("auth/redefinir", { token: randomBytes(32).toString("hex"), senha: "novaSenha7" });
    ok("token aleatório → 401 genérico", rAle.http === 401 && !/existe|cadastr/i.test(rAle.corpo.error || ""), `${rAle.http}`);

    /* semeia um token válido para o síndico de sonda — o mesmo que o
       /api/auth/esqueci gravaria (delete + insert com canal='email') */
    const tokenBom = randomBytes(32).toString("hex");
    await admin.from("auth_recuperacao").delete().eq("usuario_id", SINDICO_ID).eq("canal", "email").is("usado_em", null);
    const { error: eSeed } = await admin.from("auth_recuperacao").insert({
      usuario_id: SINDICO_ID, codigo_hash: sha256(tokenBom), canal: "email",
      criado_por: SINDICO_ID, expira_em: new Date(Date.now() + 3600e3).toISOString(),
    });
    ok("token semeado no banco", !eSeed, eSeed?.message || "");
    const rOk = await post("auth/redefinir", { token: tokenBom, senha: "novaSenha8" });
    ok("token válido redefine a senha", rOk.http === 200, `${rOk.http}`);
    const lgSV = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: SENHA });
    ok("senha antiga do síndico morreu → 401", lgSV.http === 401, `${lgSV.http}`);
    const lgSN = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: "novaSenha8" });
    ok("senha nova do síndico entra", lgSN.http === 200, `${lgSN.http}`);
    const rRe = await post("auth/redefinir", { token: tokenBom, senha: "novaSenha9" });
    ok("reuso do token → 401 (uso único)", rRe.http === 401, `${rRe.http}`);

    /* token vencido */
    const tokenVelho = randomBytes(32).toString("hex");
    await admin.from("auth_recuperacao").insert({
      usuario_id: SINDICO_ID, codigo_hash: sha256(tokenVelho), canal: "email",
      criado_por: SINDICO_ID, expira_em: new Date(Date.now() - 60e3).toISOString(),
    });
    const rVenc = await post("auth/redefinir", { token: tokenVelho, senha: "novaSenha9" });
    ok("token vencido → 401", rVenc.http === 401, `${rVenc.http}`);
  }

  /* ══ 7 · limpeza (remover os acessos apaga os tokens via cascade) ══ */
  await limpar(TOKEN);
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🛡️ RECUPERAÇÃO OK${puladas ? ` · ${puladas} sonda(s) aguardando instalação (SQL/SMTP)` : ""}`);
process.exit(falhas ? 1 : 0);
