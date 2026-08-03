// Apaga TODOS os arquivos do bucket "documentos" (o bucket e as políticas
// continuam existindo). Complemento do supabase-limpar-dados.sql, já que o
// Supabase não permite delete direto em storage.objects via SQL.
// Uso: node scripts/limpar-storage.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || /COLE_AQUI/i.test(key)) {
  console.error("SUPABASE_SERVICE_ROLE_KEY ausente no .env — necessária para apagar arquivos.");
  process.exit(1);
}
const sb = createClient(env.VITE_SUPABASE_URL, key);
const BUCKET = "documentos";

/* lista recursivamente (os arquivos vivem em <condominio_id>/<pasta>/...) */
async function listar(prefixo = "") {
  const { data, error } = await sb.storage.from(BUCKET).list(prefixo, { limit: 1000 });
  if (error) throw new Error(`list "${prefixo}": ${error.message}`);
  const caminhos = [];
  for (const item of data || []) {
    const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
    if (item.id) caminhos.push(caminho);            // arquivo
    else caminhos.push(...await listar(caminho));   // pasta
  }
  return caminhos;
}

const arquivos = await listar();
if (!arquivos.length) { console.log("Bucket já está vazio."); process.exit(0); }

for (let i = 0; i < arquivos.length; i += 100) {
  const lote = arquivos.slice(i, i + 100);
  const { error } = await sb.storage.from(BUCKET).remove(lote);
  if (error) { console.error("Falha ao apagar:", error.message); process.exit(1); }
}
console.log(`${arquivos.length} arquivo(s) apagado(s) do bucket "${BUCKET}".`);
