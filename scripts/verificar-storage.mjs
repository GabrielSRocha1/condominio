/* Verifica a conexão com o Supabase e o upload de documentos (bucket "documentos"):
   bucket configurado, políticas de RLS do storage, coluna pessoas.documento_url,
   e o fluxo completo como o app faz (token de diretor → upload → URL pública → delete).
   Uso: node scripts/verificar-storage.mjs */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const faltando = [["VITE_SUPABASE_URL", url], ["VITE_SUPABASE_ANON_KEY", env.VITE_SUPABASE_ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY], ["SUPABASE_JWT_SECRET", env.SUPABASE_JWT_SECRET]]
  .filter(([, v]) => !v || v.startsWith("COLE_AQUI")).map(([k]) => k);
if (faltando.length) { console.log("✗ Variáveis faltando no .env:", faltando.join(", ")); process.exit(1); }

let falhas = 0;
const ok = (m) => console.log(`✔ ${m}`);
const erro = (m) => { console.log(`✗ ${m}`); falhas++; };

/* 1 · bucket existe e está configurado */
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: buckets, error: eB } = await admin.storage.listBuckets();
if (eB) { erro(`não consegui listar buckets: ${eB.message}`); process.exit(1); }
const bucket = (buckets || []).find((b) => b.id === "documentos");
if (!bucket) { erro('bucket "documentos" não existe — rode o supabase-storage.sql no SQL Editor'); process.exit(1); }
ok(`bucket "documentos" existe (público: ${bucket.public}, limite: ${Math.round((bucket.file_size_limit || 0) / 1048576)} MB)`);

/* 2 · coluna pessoas.documento_url */
const { error: eCol } = await admin.from("pessoas").select("documento_url").limit(1);
if (eCol) erro(`coluna pessoas.documento_url: ${eCol.message}`);
else ok("coluna pessoas.documento_url acessível");

/* 3 · token igual ao emitido pelo /api/auth (diretor do condomínio principal) */
const { data: conds, error: eC } = await admin.from("condominios").select("id, nome_fantasia").limit(1);
if (eC || !conds?.length) { erro(`nenhum condomínio encontrado: ${eC?.message || "tabela vazia"}`); process.exit(1); }
const cid = conds[0].id;
console.log(`  (testando como diretor de: ${conds[0].nome_fantasia})`);
const b64u = (s) => Buffer.from(s).toString("base64url");
const assinar = (claims) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role: "authenticated", iss: "condomaster",
    exp: Math.floor(Date.now() / 1000) + 300, ...claims }));
  return `${h}.${p}.${createHmac("sha256", env.SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const token = assinar({ sub: "verificacao", perfil: "diretor", condominio_id: cid });
const app = createClient(url, env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });

/* 4 · upload como o app faz */
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const caminho = `${cid}/pessoas/verificacao-${Date.now()}.png`;
const { error: eUp } = await app.storage.from("documentos").upload(caminho, png, { contentType: "image/png" });
if (eUp) erro(`upload com token de diretor: ${eUp.message}`);
else ok("upload com token de diretor funcionou");

/* 5 · leitura pública da URL */
if (!eUp) {
  const publicUrl = app.storage.from("documentos").getPublicUrl(caminho).data.publicUrl;
  const r = await fetch(publicUrl);
  if (r.ok) ok("URL pública do arquivo responde (leitura ok)");
  else erro(`URL pública devolveu ${r.status}`);
}

/* 5b · vídeo (prova de multa) com token de diretor */
const mp4 = Buffer.from("AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29t", "base64"); // header mínimo de mp4
const caminhoProva = `${cid}/provas/verificacao-${Date.now()}.mp4`;
const { error: eVid } = await app.storage.from("documentos").upload(caminhoProva, mp4, { contentType: "video/mp4" });
if (eVid) erro(`upload de vídeo (provas): ${eVid.message} — re-rode o supabase-storage.sql`);
else { ok("upload de vídeo na pasta provas/ funcionou"); await app.storage.from("documentos").remove([caminhoProva]); }

/* 5c · morador: pode subir em chamados/, não pode em pessoas/ */
const tokenMorador = assinar({ sub: "verificacao", perfil: "morador", condominio_id: cid });
const appMorador = createClient(url, env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${tokenMorador}` } } });
const caminhoChamado = `${cid}/chamados/verificacao-${Date.now()}.png`;
const { error: eMor } = await appMorador.storage.from("documentos").upload(caminhoChamado, png, { contentType: "image/png" });
if (eMor) erro(`morador não conseguiu subir foto em chamados/: ${eMor.message} — re-rode o supabase-storage.sql`);
else { ok("morador consegue subir foto na pasta chamados/"); await admin.storage.from("documentos").remove([caminhoChamado]); }
const { error: eMorPessoas } = await appMorador.storage.from("documentos")
  .upload(`${cid}/pessoas/invasao-morador.png`, png, { contentType: "image/png" });
if (eMorPessoas) ok("morador foi bloqueado na pasta pessoas/ (RLS ok)");
else { erro("RLS NÃO bloqueou morador na pasta pessoas/!"); await admin.storage.from("documentos").remove([`${cid}/pessoas/invasao-morador.png`]); }

/* 6 · escrever fora da pasta do próprio condomínio deve ser BLOQUEADO */
const { error: eForaOk } = await app.storage.from("documentos")
  .upload(`00000000-0000-0000-0000-000000000000/pessoas/invasao.png`, png, { contentType: "image/png" });
if (eForaOk) ok("upload na pasta de outro condomínio foi bloqueado (RLS ok)");
else { erro("RLS NÃO bloqueou upload na pasta de outro condomínio!"); await admin.storage.from("documentos").remove(["00000000-0000-0000-0000-000000000000/pessoas/invasao.png"]); }

/* 7 · limpeza (testa também a política de delete) */
if (!eUp) {
  const { error: eDel } = await app.storage.from("documentos").remove([caminho]);
  if (eDel) { erro(`delete com token de diretor: ${eDel.message}`); await admin.storage.from("documentos").remove([caminho]); }
  else ok("delete com token de diretor funcionou (arquivo de teste removido)");
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam` : "\nTudo conectado: upload de documentos pronto para uso!");
process.exit(falhas ? 1 : 0);
