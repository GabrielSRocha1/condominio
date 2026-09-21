/* Sondas da Etapa 4 — recuperação de senha por código.
   Roda contra o dev server (localhost:5173) usando o condomínio TESTE
   Manuais. Detecta sozinho se o supabase-seguranca4.sql já foi aplicado:
   sem ele, as sondas do fluxo são puladas com aviso (e os endpoints devem
   responder 503 sem derrubar nada).

   Cobre: autonomia (a própria conta gera o código permanente via
   /api/auth/codigo e o flag temCodigoRecuperacao do login), plano B do
   diretor (código de 24h em Gerenciar Acessos), formato do código, código
   errado/reusado/expirado → 401 genérico, troca efetiva com senha antiga
   morta, morador pelo nome, e restauração do estado ao final (a conta
   manuais volta à senha original). */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
const NOME_MORADOR = "Probe Recuperacao Morador";
const RX_CODIGO = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

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
    if (a.email === EMAIL_SINDICO || a.nome === NOME_MORADOR)
      await post("auth/acessos", { acao: "remover", usuarioId: a.id }, { token });
  }
  await admin.from("auth_protecao").delete().like("chave", "recuperar:%").then(() => {}, () => {});
}

/* SQL da etapa 4 já aplicado? */
const { error: eTab } = await admin.from("auth_recuperacao").select("id").limit(1);
const sqlAplicado = !eTab;
console.log(sqlAplicado
  ? "ℹ️ supabase-seguranca4.sql: APLICADO — rodando todas as sondas\n"
  : "ℹ️ supabase-seguranca4.sql: AINDA NÃO APLICADO — fluxo será pulado; endpoints devem responder 503\n");

/* ══ 1 · validação e autorização ══ */
console.log("━━ validação e autorização ━━");
const lg = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
ok("login do diretor funciona", lg.http === 200 && !!lg.corpo.token, `${lg.http}`);
ok("login devolve temCodigoRecuperacao (boolean)", typeof lg.corpo.conta?.temCodigoRecuperacao === "boolean",
  String(lg.corpo.conta?.temCodigoRecuperacao));
const TOKEN = lg.corpo.token;
if (!TOKEN) { console.log("\nSem diretor de teste — rode as sondas da Etapa 1 antes."); process.exit(1); }
await limpar(TOKEN); // estado limpo de execuções anteriores

const v1 = await post("auth/recuperar", { perfil: "diretor", email: EMAIL_DIRETOR, senha: "12345678" });
ok("recuperar sem código → 400", v1.http === 400, `${v1.http}`);
const v2 = await post("auth/recuperar", { perfil: "diretor", email: EMAIL_DIRETOR, codigo: "AAAA", senha: "1234567" });
ok("recuperar com senha curta → 400", v2.http === 400, `${v2.http}`);
const v3 = await post("auth/acessos", { acao: "codigo" });
ok("gerar código sem token → 403", v3.http === 403, `${v3.http}`);

if (!sqlAplicado) {
  const d1 = await post("auth/acessos", { acao: "codigo" }, { token: TOKEN });
  ok("gerar código sem a tabela → 503 (degrada com aviso)", d1.http === 503, `${d1.http}`);
  const d2 = await post("auth/codigo", {}, { token: TOKEN });
  ok("código próprio sem a tabela → 503 (degrada com aviso)", d2.http === 503, `${d2.http}`);
  ok("login sem a tabela → temCodigoRecuperacao=true (não sugere nada)", lg.corpo.conta?.temCodigoRecuperacao === true,
    String(lg.corpo.conta?.temCodigoRecuperacao));
  pula("fluxo completo de recuperação", "rode o supabase-seguranca4.sql e repita");
} else {
  /* ══ 2 · síndico: código de 24h gerado pelo diretor ══ */
  console.log("\n━━ síndico (código de 24h) ━━");
  const cr = await post("auth/acessos", { acao: "criar", perfil: "sindico", email: EMAIL_SINDICO, senha: SENHA }, { token: TOKEN });
  ok("acesso de síndico criado para a sonda", cr.http === 200 && !!cr.corpo.id, `${cr.http}`);
  const SINDICO_ID = cr.corpo.id;

  const lgS = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: SENHA });
  ok("síndico entra com a senha original", lgS.http === 200, `${lgS.http}`);
  const g0 = await post("auth/acessos", { acao: "codigo", usuarioId: SINDICO_ID }, { token: lgS.corpo.token });
  ok("síndico NÃO gera código (só diretor) → 403", g0.http === 403, `${g0.http}`);

  const g1 = await post("auth/acessos", { acao: "codigo", usuarioId: SINDICO_ID }, { token: TOKEN });
  ok("diretor gera código para o síndico", g1.http === 200 && RX_CODIGO.test(g1.corpo.codigo || ""), g1.corpo.codigo || `${g1.http}`);
  const em24h = g1.corpo.expiraEm && Math.abs(new Date(g1.corpo.expiraEm) - Date.now() - 24 * 3600e3) < 60e3;
  ok("código do síndico expira em ~24h", !!em24h, g1.corpo.expiraEm || "sem expiraEm");

  const r1 = await post("auth/recuperar", { perfil: "sindico", email: EMAIL_SINDICO, codigo: "ZZZZ-ZZZZ-ZZZZ-ZZZZ", senha: "novaSenha1" });
  ok("código errado → 401 genérico", r1.http === 401 && !/existe|cadastr/i.test(r1.corpo.error || ""), `${r1.http}`);
  const r2 = await post("auth/recuperar", { perfil: "sindico", email: EMAIL_SINDICO, codigo: g1.corpo.codigo, senha: "novaSenha1" });
  ok("código certo redefine a senha", r2.http === 200, `${r2.http}`);
  const lgVelha = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: SENHA });
  ok("senha antiga morreu → 401", lgVelha.http === 401, `${lgVelha.http}`);
  const lgNova = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: "novaSenha1" });
  ok("senha nova entra", lgNova.http === 200, `${lgNova.http}`);
  const r3 = await post("auth/recuperar", { perfil: "sindico", email: EMAIL_SINDICO, codigo: g1.corpo.codigo, senha: "novaSenha2" });
  ok("reuso do código → 401 (uso único)", r3.http === 401, `${r3.http}`);

  /* código expirado: vence no banco e tenta usar */
  const g2 = await post("auth/acessos", { acao: "codigo", usuarioId: SINDICO_ID }, { token: TOKEN });
  await admin.from("auth_recuperacao").update({ expira_em: new Date(Date.now() - 60e3).toISOString() })
    .eq("usuario_id", SINDICO_ID).is("usado_em", null);
  const r4 = await post("auth/recuperar", { perfil: "sindico", email: EMAIL_SINDICO, codigo: g2.corpo.codigo, senha: "novaSenha3" });
  ok("código expirado → 401", r4.http === 401, `${r4.http}`);

  /* ══ 3 · morador: identifica pelo nome ══ */
  console.log("\n━━ morador (pelo nome) ━━");
  const cm = await post("auth/acessos", { acao: "criar", perfil: "morador", nome: NOME_MORADOR, senha: SENHA }, { token: TOKEN });
  ok("acesso de morador criado para a sonda", cm.http === 200 && !!cm.corpo.id, `${cm.http}`);
  const g3 = await post("auth/acessos", { acao: "codigo", usuarioId: cm.corpo.id }, { token: TOKEN });
  const r5 = await post("auth/recuperar", { perfil: "morador", nome: NOME_MORADOR, codigo: g3.corpo.codigo, senha: "novaSenha4" });
  ok("morador redefine pelo nome + código", r5.http === 200, `${r5.http}`);
  const lgM = await post("auth/login", { perfil: "morador", nome: NOME_MORADOR, senha: "novaSenha4" });
  ok("morador entra com a senha nova", lgM.http === 200, `${lgM.http}`);

  /* ══ 4 · autonomia: a própria conta gera o código permanente ══ */
  console.log("\n━━ autonomia (/api/auth/codigo) ━━");
  const c0 = await post("auth/codigo", {});
  ok("gerar o próprio código sem token → 401", c0.http === 401, `${c0.http}`);
  const lgS2 = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: "novaSenha1" });
  ok("síndico sem código permanente → temCodigoRecuperacao=false", lgS2.corpo.conta?.temCodigoRecuperacao === false,
    String(lgS2.corpo.conta?.temCodigoRecuperacao));
  const c1 = await post("auth/codigo", {}, { token: lgS2.corpo.token });
  ok("síndico gera o PRÓPRIO código permanente", c1.http === 200 && RX_CODIGO.test(c1.corpo.codigo || "") && c1.corpo.expiraEm === null,
    c1.corpo.expiraEm === null ? c1.corpo.codigo : `${c1.http} expiraEm=${c1.corpo.expiraEm}`);
  const lgS3 = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: "novaSenha1" });
  ok("com código ativo → temCodigoRecuperacao=true", lgS3.corpo.conta?.temCodigoRecuperacao === true,
    String(lgS3.corpo.conta?.temCodigoRecuperacao));
  const r5b = await post("auth/recuperar", { perfil: "sindico", email: EMAIL_SINDICO, codigo: c1.corpo.codigo, senha: "novaSenha5" });
  ok("síndico se recupera SOZINHO com o próprio código", r5b.http === 200, `${r5b.http}`);
  const lgS4 = await post("auth/login", { perfil: "sindico", email: EMAIL_SINDICO, senha: "novaSenha5" });
  ok("senha nova entra e o código consumido some do login", lgS4.http === 200 && lgS4.corpo.conta?.temCodigoRecuperacao === false,
    `${lgS4.http}/${lgS4.corpo.conta?.temCodigoRecuperacao}`);

  /* ══ 5 · diretor: código permanente do próprio ══ */
  console.log("\n━━ diretor (código permanente) ━━");
  const dirIdSonda = (await admin.from("usuarios").select("id").eq("email", EMAIL_DIRETOR).single()).data.id;
  const g5 = await post("auth/acessos", { acao: "codigo", usuarioId: dirIdSonda }, { token: TOKEN });
  ok("usuarioId do próprio diretor = código permanente", g5.http === 200 && g5.corpo.expiraEm === null, `${g5.http}`);
  const g4 = await post("auth/acessos", { acao: "codigo" }, { token: TOKEN });
  ok("diretor gera o próprio código (permanente)", g4.http === 200 && RX_CODIGO.test(g4.corpo.codigo || "") && g4.corpo.expiraEm === null,
    g4.corpo.expiraEm === null ? g4.corpo.codigo : `expiraEm=${g4.corpo.expiraEm}`);
  const rSub = await post("auth/recuperar", { perfil: "diretor", email: EMAIL_DIRETOR, codigo: g5.corpo.codigo, senha: "senhaTemp99" });
  ok("código anterior morre quando um novo é gerado → 401", rSub.http === 401, `${rSub.http}`);

  const r6 = await post("auth/recuperar", { perfil: "diretor", email: EMAIL_DIRETOR, codigo: g4.corpo.codigo, senha: "senhaTemp99" });
  ok("diretor redefine com o código permanente", r6.http === 200, `${r6.http}`);
  const lgD1 = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
  ok("senha antiga do diretor morreu → 401", lgD1.http === 401, `${lgD1.http}`);
  const lgD2 = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: "senhaTemp99" });
  ok("diretor entra com a senha nova", lgD2.http === 200, `${lgD2.http}`);

  /* restaura a senha original da conta manuais (o JWT antigo segue válido 1h) */
  const g6 = await post("auth/acessos", { acao: "codigo" }, { token: TOKEN });
  const r7 = await post("auth/recuperar", { perfil: "diretor", email: EMAIL_DIRETOR, codigo: g6.corpo.codigo, senha: SENHA });
  const lgD3 = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
  ok("senha original do diretor restaurada", r7.http === 200 && lgD3.http === 200, `${r7.http}/${lgD3.http}`);

  /* ══ 6 · limpeza ══ */
  await limpar(lgD3.corpo.token || TOKEN);
  const dirId = (await admin.from("usuarios").select("id").eq("email", EMAIL_DIRETOR).single()).data?.id;
  if (dirId) await admin.from("auth_recuperacao").delete().eq("usuario_id", dirId).then(() => {}, () => {});
}

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🛡️ RECUPERAÇÃO OK${puladas ? ` · ${puladas} sonda(s) aguardando o supabase-seguranca4.sql` : ""}`);
process.exit(falhas ? 1 : 0);
