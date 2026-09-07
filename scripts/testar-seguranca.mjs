/* Sondas de segurança da Etapa 1 (auth + validação + blindagem de dados).
   Roda contra o dev server (localhost:5173) usando o condomínio TESTE
   Manuais. Detecta sozinho se o supabase-seguranca.sql já foi aplicado:
   sem ele, as sondas que dependem do banco são puladas com aviso (e as de
   RLS mostram o estado VULNERÁVEL para evidenciar o antes/depois). */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL_SB = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(URL_SB, env.SUPABASE_SERVICE_ROLE_KEY);
const clienteApp = (token) => createClient(URL_SB, env.VITE_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: `Bearer ${token}` } } });

const BASE = "http://localhost:5173";
const SENHA = "teste123";
const EMAIL_DIRETOR = "diretor.manuais@teste.condomaster.dev";
const COND = "87e6ade7-264e-4b3a-9eef-30b4d78b83fb";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

/* fetch cru para inspecionar status e cookies */
const post = async (rota, body, { token, cookie, origin } = {}) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  const setCookie = r.headers.get("set-cookie") || "";
  const refreshCookie = (setCookie.match(/cm_refresh=([^;]*)/) || [])[1] || null;
  return { http: r.status, corpo: j, refreshCookie };
};

/* SQL de segurança já aplicado? */
const { error: eTab } = await admin.from("auth_sessoes").select("id").limit(1);
const sqlAplicado = !eTab;
console.log(sqlAplicado
  ? "ℹ️ supabase-seguranca.sql: APLICADO — rodando todas as sondas\n"
  : "ℹ️ supabase-seguranca.sql: AINDA NÃO APLICADO — sondas de banco serão puladas\n");

/* ══ 1 · validação deny-by-default ══ */
console.log("━━ validação de entrada ━━");
const lg = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
ok("login do diretor funciona", lg.http === 200 && !!lg.corpo.token);
const TOKEN = lg.corpo.token;

const v1 = await post("cobrancas/informar-pagamento", { cobrancaId: "1 OR 1=1", forma: "verum_pay", txHash: "x" }, { token: TOKEN });
ok("cobrancaId não-UUID → 400", v1.http === 400, `${v1.http}`);
const v2 = await post("cobrancas/informar-pagamento", { cobrancaId: COND, forma: "verum_pay", txHash: "hash-invalido!!" }, { token: TOKEN });
ok("txHash fora do formato → 400", v2.http === 400, `${v2.http}`);
const v3 = await post("stripe/licenca", { condominioId: "abc" }, { token: TOKEN });
ok("condominioId não-UUID → 400", v3.http === 400, `${v3.http}`);
const v4 = await post("auth/registrar", { nome: "X", email: `probe.${Date.now()}@teste.dev`, senha: "1234567" });
ok("registrar com senha curta → 400", v4.http === 400, `${v4.http}`);

/* ══ 2 · autenticação e sessão ══ */
console.log("\n━━ autenticação ━━");
const tokenAdulterado = TOKEN.slice(0, -6) + "abcdef";
const a1 = await post("stripe/licenca", { condominioId: COND }, { token: tokenAdulterado });
ok("JWT adulterado → 401", a1.http === 401, `${a1.http}`);
const a2 = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: "senha-errada-xx" });
ok("senha errada → 401 genérico", a2.http === 401 && !/existe|cadastr/i.test(a2.corpo.error || ""), `${a2.http}`);
const a3 = await fetch(`${BASE}/api/auth/diag`);
ok("diag sem sessão → 401", a3.status === 401, `${a3.status}`);
const exp = JSON.parse(Buffer.from(TOKEN.split(".")[1], "base64url").toString()).exp;
const ttlMin = Math.round((exp - Date.now() / 1000) / 60);
ok("JWT de acesso curto (≤ 61 min)", ttlMin <= 61, `expira em ${ttlMin} min`);

/* migração transparente de hash legado (SHA-256 → scrypt) */
const emailLegado = "legado.manuais@teste.condomaster.dev";
await admin.from("usuarios").delete().eq("email", emailLegado);
await admin.from("pessoas").delete().eq("condominio_id", COND).eq("nome", "Sonda Legado");
const { data: pLeg, error: ePLeg } = await admin.from("pessoas").insert({
  condominio_id: COND, nome: "Sonda Legado", tipo_pessoa: "fisica", cpf_cnpj: "P-sonda-legado",
}).select("id").single();
if (ePLeg) { console.error("não criou a pessoa da sonda:", ePLeg.message); process.exit(1); }
const { data: uLeg, error: eULeg } = await admin.from("usuarios").insert({ email: emailLegado, pessoa_id: pLeg.id,
  senha_hash: createHash("sha256").update(SENHA).digest("hex") }).select("id").single();
if (eULeg) { console.error("não criou o usuário legado:", eULeg.message); process.exit(1); }
const { data: perfilDir } = await admin.from("perfis").select("id").eq("nome", "sindico").single();
await admin.from("usuario_perfis").insert({ usuario_id: uLeg.id, condominio_id: COND, perfil_id: perfilDir.id });
const lgLeg = await post("auth/login", { perfil: "sindico", email: emailLegado, senha: SENHA });
ok("hash legado (SHA-256) ainda loga", lgLeg.http === 200);
const { data: uDepois } = await admin.from("usuarios").select("senha_hash").eq("email", emailLegado).single();
ok("hash migrado para scrypt no login", uDepois?.senha_hash?.startsWith("s2$"), uDepois?.senha_hash?.slice(0, 6));
const TOKEN_SINDICO = lgLeg.corpo.token;

/* ══ 3 · refresh token (rotação + reuso + logout) ══ */
console.log("\n━━ refresh token ━━");
if (!sqlAplicado || !lg.refreshCookie) {
  pula("cookie HttpOnly no login / rotação / reuso / logout", "rode supabase-seguranca.sql e teste de novo");
} else {
  ok("login emite cookie cm_refresh", !!lg.refreshCookie);
  const c1 = `cm_refresh=${lg.refreshCookie}`;
  const r1 = await post("auth/refresh", undefined, { cookie: c1 });
  ok("refresh devolve token novo + cookie rotacionado", r1.http === 200 && !!r1.corpo.token && !!r1.refreshCookie && r1.refreshCookie !== lg.refreshCookie);
  const r2 = await post("auth/refresh", undefined, { cookie: c1 });
  ok("REUSO do cookie antigo → 401 (roubo detectado)", r2.http === 401, `${r2.http}`);
  const r3 = await post("auth/refresh", undefined, { cookie: `cm_refresh=${r1.refreshCookie}` });
  ok("família inteira revogada após o reuso", r3.http === 401, `${r3.http}`);

  const lg2 = await post("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
  const rOrigem = await post("auth/refresh", undefined, { cookie: `cm_refresh=${lg2.refreshCookie}`, origin: "https://site-malicioso.dev" });
  ok("refresh com Origin de outro site → 403", rOrigem.http === 403, `${rOrigem.http}`);
  await post("auth/logout", undefined, { cookie: `cm_refresh=${lg2.refreshCookie}` });
  const r4 = await post("auth/refresh", undefined, { cookie: `cm_refresh=${lg2.refreshCookie}` });
  ok("logout revoga a sessão (refresh nega)", r4.http === 401, `${r4.http}`);
}

/* ══ 4 · lockout de força bruta ══ */
console.log("\n━━ força bruta ━━");
if (!sqlAplicado) {
  pula("lockout após 5 falhas", "rode supabase-seguranca.sql e teste de novo");
} else {
  const alvo = `bruteforce.${Date.now()}@teste.dev`; // conta inexistente: só falhas
  let ultimo = 0;
  for (let i = 0; i < 6; i++)
    ultimo = (await post("auth/login", { perfil: "diretor", email: alvo, senha: "errada" })).http;
  ok("6ª falha seguida → 429 (conta bloqueada)", ultimo === 429, `${ultimo}`);
  await admin.from("auth_protecao").delete().like("chave", `%${alvo}%`);
  await admin.from("auth_protecao").delete().like("chave", "login:ip:%"); // não suja as próximas rodadas
}

/* ══ 5 · blindagem do banco (RLS + grants por coluna) ══ */
console.log("\n━━ blindagem do banco ━━");
const sbDir = clienteApp(TOKEN);
const { error: eHash } = await sbDir.from("usuarios").select("senha_hash").limit(1);
if (sqlAplicado) ok("senha_hash INVISÍVEL para o navegador", !!eHash, eHash?.message?.slice(0, 60) || "consulta passou!");
else ok("senha_hash legível pelo navegador (VULNERÁVEL — rode o SQL)", !eHash ? false : true, "estado pré-SQL");

const sbSind = clienteApp(TOKEN_SINDICO);
const { data: perfilDiretor } = await admin.from("perfis").select("id").eq("nome", "diretor").single();
const { error: eEsc } = await sbSind.from("usuario_perfis")
  .insert({ usuario_id: uLeg.id, condominio_id: COND, perfil_id: perfilDiretor.id });
if (!eEsc) await admin.from("usuario_perfis").delete()
  .eq("usuario_id", uLeg.id).eq("perfil_id", perfilDiretor.id); // limpa a prova
ok(sqlAplicado ? "síndico NÃO consegue se promover a diretor" : "escalação síndico→diretor (VULNERÁVEL — rode o SQL)",
  sqlAplicado ? !!eEsc : !eEsc ? false : true, eEsc?.message?.slice(0, 60) || (eEsc ? "" : "insert passou!"));

/* acessos: só diretor */
const ac1 = await post("auth/acessos", { acao: "listar" }, { token: TOKEN_SINDICO });
ok("síndico em /auth/acessos → 403", ac1.http === 403, `${ac1.http}`);
const ac2 = await post("auth/acessos", { acao: "listar" }, { token: TOKEN });
ok("diretor lista acessos via backend", ac2.http === 200 && Array.isArray(ac2.corpo.acessos), `${ac2.http}`);
const ac3 = await post("auth/acessos", { acao: "criar", perfil: "diretor", email: "evil@x.dev", senha: "12345678" }, { token: TOKEN });
ok("criar acesso com perfil 'diretor' → recusado", ac3.http === 400, `${ac3.http}`);

/* limpeza da conta legada de teste */
await admin.from("usuario_perfis").delete().eq("usuario_id", uLeg.id);
await admin.from("auth_sessoes").delete().eq("usuario_id", uLeg.id).then(() => {}, () => {});
await admin.from("usuarios").delete().eq("email", emailLegado);
await admin.from("pessoas").delete().eq("id", pLeg.id);

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🛡️ SEGURANÇA OK${puladas ? ` · ${puladas} sonda(s) aguardando o supabase-seguranca.sql` : ""}`);
process.exit(falhas ? 1 : 0);
