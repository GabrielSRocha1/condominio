/* Sondas do idioma por IP, da preferência no banco e da semente de moeda.
   Roda contra o dev server. Se a coluna usuarios.preferencias ainda não
   existir (o alter do supabase-schema.sql), as sondas que dependem dela são
   puladas com aviso — o resto continua valendo.

   Uso: node scripts/testar-idioma-moeda.mjs      (BASE=http://localhost:5173)
        BASE=http://localhost:5174 node scripts/testar-idioma-moeda.mjs */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { IDIOMA_POR_PAIS, MOEDA_POR_PAIS, resolverGeo } from "../api/_lib/geo.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = process.env.BASE || "http://localhost:5173";

let falhas = 0, puladas = 0;
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };

const geo = async (pais) => {
  const r = await fetch(`${BASE}/api/geo`, { headers: pais ? { "x-vercel-ip-country": pais } : {} });
  return { http: r.status, cache: r.headers.get("cache-control"), corpo: await r.json().catch(() => ({})) };
};
const post = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  return { http: r.status, corpo: await r.json().catch(() => ({})) };
};

/* ══ 1 · /api/geo ══ */
console.log("━━ /api/geo ━━");
const semPais = await geo(null);
ok("sem header de país → tudo null, fonte ausente",
  semPais.http === 200 && semPais.corpo.pais === null && semPais.corpo.fonte === "ausente");
ok("Cache-Control é no-store (o CDN não pode compartilhar a resposta)",
  /no-store/.test(semPais.cache || ""), semPais.cache || "ausente");
const br = await geo("BR"), jp = await geo("JP"), dk = await geo("DK"), ar = await geo("AR");
ok("BR → pt / BRL", br.corpo.idioma === "pt" && br.corpo.moeda === "BRL", JSON.stringify(br.corpo));
ok("JP → ja / JPY", jp.corpo.idioma === "ja" && jp.corpo.moeda === "JPY", JSON.stringify(jp.corpo));
ok("DK → en / DKK (sem dicionário dinamarquês, cai no inglês — não no espanhol)",
  dk.corpo.idioma === "en" && dk.corpo.moeda === "DKK", JSON.stringify(dk.corpo));
ok("AR é Argentina (es/ARS), não árabe", ar.corpo.idioma === "es" && ar.corpo.moeda === "ARS", JSON.stringify(ar.corpo));
const xx = await geo("XX");
ok("país degenerado (XX) é descartado", xx.corpo.pais === null);
const metodo = await fetch(`${BASE}/api/geo`, { method: "POST" });
ok("POST em /api/geo → 405", metodo.status === 405, `${metodo.status}`);

/* ══ 2 · coerência dos mapas ══ */
console.log("\n━━ mapas de país ━━");
const i18n = readFileSync(new URL("../src/lib/i18n.js", import.meta.url), "utf8");
const LANGS = [...i18n.slice(i18n.indexOf("export const LANGS"), i18n.indexOf("];", i18n.indexOf("export const LANGS")))
  .matchAll(/\["([a-z]{2})",/g)].map((m) => m[1]);
ok("LANGS tem os 15 idiomas", LANGS.length === 15, `${LANGS.length}`);
const foraDeLangs = [...new Set(Object.values(IDIOMA_POR_PAIS))].filter((l) => !LANGS.includes(l));
ok("todo idioma do mapa existe no seletor", foraDeLangs.length === 0, foraDeLangs.join(", "));
const semIdioma = Object.keys(MOEDA_POR_PAIS).filter((p) => !IDIOMA_POR_PAIS[p]);
ok("todo país com moeda tem idioma mapeado", semIdioma.length === 0, semIdioma.join(", "));

/* o <select name="moeda"> precisa ter <option> para TODA moeda que o geo
   semeia: sem a option o browser submete a primeira (USD) em silêncio */
const jsx = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
const listaMoedas = jsx.slice(jsx.indexOf("const MOEDAS = ["), jsx.indexOf("];", jsx.indexOf("const MOEDAS = [")));
const noSeletor = new Set([...listaMoedas.matchAll(/\["([A-Z]{3})",/g)].map((m) => m[1]));
const semOption = [...new Set(Object.values(MOEDA_POR_PAIS))].filter((m) => !noSeletor.has(m));
ok("o seletor de moeda cobre todas as moedas semeadas", semOption.length === 0, semOption.join(", "));

/* ══ 3 · dicionários ══ */
console.log("\n━━ dicionários ━━");
const textos = (txt) => { /* strings entre aspas, com o char seguinte */
  const out = []; let i = 0;
  while (i < txt.length) {
    if (txt[i] === '"') {
      let j = i + 1, b = "";
      while (j < txt.length && txt[j] !== '"') { if (txt[j] === "\\") { b += txt[j] + txt[j + 1]; j += 2; } else { b += txt[j]; j++; } }
      out.push({ s: b, depois: txt.slice(j + 1, j + 2), antes: txt.slice(Math.max(0, i - 9), i) });
      i = j + 1;
    } else i++;
  }
  return out;
};
const usadas = new Set();
for (const t of textos(jsx)) {
  if ((t.antes.endsWith("L(") && t.depois === ")") || t.antes.endsWith("label=") || t.antes.endsWith("title=")) usadas.add(t.s);
}
for (const nome of ["EN", "ES"]) {
  const ini = i18n.indexOf(`const ${nome} = {`);
  const chaves = new Set(textos(i18n.slice(ini, i18n.indexOf("\n};", ini))).filter((t) => t.depois === ":").map((t) => t.s));
  const falta = [...usadas].filter((s) => !chaves.has(s));
  ok(`${nome} traduz todas as ${usadas.size} strings da interface`, falta.length === 0,
    falta.length ? `faltam ${falta.length}: ${JSON.stringify(falta.slice(0, 3))}` : `${chaves.size} chaves`);
}

/* ══ 4 · preferência de idioma no banco ══ */
console.log("\n━━ /api/auth/preferencias ━━");
const g = await fetch(`${BASE}/api/auth/preferencias`);
ok("GET → 405", g.status === 405, `${g.status}`);
const semToken = await post("auth/preferencias", { idioma: "ja" });
ok("sem token → 401", semToken.http === 401, `${semToken.http}`);

/* entrar no sistema NUNCA pode depender da coluna nova — esta sonda vale
   antes e depois do alter table */
const lg = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" });
const lgM = await post("auth/login", { perfil: "morador", nome: "Morador Manuais", senha: "teste123" });
ok("login do diretor funciona (com ou sem a coluna preferencias)", lg.http === 200, `${lg.http}`);
ok("login do morador funciona (com ou sem a coluna preferencias)", lgM.http === 200, `${lgM.http}`);

const { error: eCol } = await admin.from("usuarios").select("preferencias").limit(1);
if (eCol) {
  console.log("\nℹ️ coluna usuarios.preferencias AINDA NÃO existe");
  pula("login devolve o idioma salvo", "rode o alter table do supabase-schema.sql");
  pula("salva a preferência da própria conta", "rode o alter table do supabase-schema.sql");
  pula("idioma inválido é recusado", "rode o alter table do supabase-schema.sql");
  pula("usuarioId no corpo é ignorado", "rode o alter table do supabase-schema.sql");
} else {
  if (lg.http !== 200) {
    pula("sondas com sessão", `login de teste falhou (${lg.http}) — rode scripts/seed.mjs`);
  } else {
    ok("login devolve o campo idioma", "idioma" in lg.corpo.conta, JSON.stringify(lg.corpo.conta));
    const tk = lg.corpo.token;

    const ruim = await post("auth/preferencias", { idioma: "xx" }, tk);
    ok("idioma fora da lista → 400", ruim.http === 400, `${ruim.http} ${ruim.corpo.error || ""}`);

    const sal = await post("auth/preferencias", { idioma: "ja" }, tk);
    ok("salva a preferência da própria conta", sal.http === 200 && sal.corpo.preferencias?.idioma === "ja", JSON.stringify(sal.corpo));

    const { data: linha } = await admin.from("usuarios").select("preferencias")
      .eq("email", "diretor.manuais@teste.condomaster.dev").maybeSingle();
    ok("preferência gravada no banco", linha?.preferencias?.idioma === "ja", JSON.stringify(linha?.preferencias));

    const relogin = await post("auth/login", { perfil: "diretor", email: "diretor.manuais@teste.condomaster.dev", senha: "teste123" });
    ok("o login seguinte traz o idioma salvo", relogin.corpo.conta?.idioma === "ja", `${relogin.corpo.conta?.idioma}`);

    /* campo fora do esquema é descartado pelo validador: a conta alheia não é tocada */
    const { data: outro } = await admin.from("usuarios").select("id, preferencias")
      .neq("email", "diretor.manuais@teste.condomaster.dev").limit(1).maybeSingle();
    if (!outro) pula("usuarioId no corpo é ignorado", "só há uma conta no banco");
    else {
      const antes = JSON.stringify(outro.preferencias);
      await post("auth/preferencias", { idioma: "tr", usuarioId: outro.id, id: outro.id }, tk);
      const { data: depois } = await admin.from("usuarios").select("preferencias").eq("id", outro.id).maybeSingle();
      ok("usuarioId no corpo é ignorado (conta alheia intacta)", JSON.stringify(depois?.preferencias) === antes,
        `${antes} → ${JSON.stringify(depois?.preferencias)}`);
    }

    /* devolve o diretor de teste ao português, para não bagunçar o roteiro visual */
    await post("auth/preferencias", { idioma: "pt" }, tk);
  }
}

/* ══ 5 · semente da moeda ══ */
console.log("\n━━ semente da moeda de gestão ━━");
ok("resolverGeo devolve a moeda do país", resolverGeo({ headers: { "x-vercel-ip-country": "DK" } }).moeda === "DKK");
ok("sem país, quem cria o condomínio cai em USD",
  (resolverGeo({ headers: {} }).moeda || "USD") === "USD");
const criacao = readFileSync(new URL("../api/auth/condominio.js", import.meta.url), "utf8");
ok("api/auth/condominio.js semeia regras_internas.moeda no insert",
  /regras_internas:\s*\{\s*moeda:/.test(criacao));

console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🌎 IDIOMA E MOEDA OK${puladas ? ` · ${puladas} sonda(s) aguardando o alter table` : ""}`);
process.exit(falhas ? 1 : 0);
