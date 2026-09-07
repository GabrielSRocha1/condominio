/* SUPPLY CHAIN — varredura de segredos no bundle do frontend.
   Uso: npx vite build && node scripts/verificar-segredos-bundle.mjs
   Lê os VALORES sensíveis do .env (nunca imprime nenhum) e confere que
   NENHUM aparece nos arquivos gerados em dist/ — se o build vazar uma
   chave de servidor, o deploy entregaria o cofre junto com o site.
   Também caça padrões perigosos soltos (sk_live/sk_test, whsec_, JWT de
   service_role) que possam ter sido colados hardcoded. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(
  readFileSync(join(RAIZ, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

/* sensíveis = tudo que NÃO é público por definição (VITE_* vai pro browser).
   Valores idênticos a alguma VITE_* são públicos de qualquer jeito (ex.:
   SUPABASE_URL espelha a VITE_SUPABASE_URL) — fora da caça. */
const publicos = new Set(Object.entries(env).filter(([k]) => k.startsWith("VITE_")).map(([, v]) => v));
const SENSIVEIS = Object.entries(env).filter(([k, v]) =>
  !k.startsWith("VITE_") && v && v.length >= 16 && !v.startsWith("COLE_AQUI") && !publicos.has(v));

const arquivos = [];
const varrer = (dir) => {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho);
    else if (/\.(js|css|html|json|map)$/.test(nome)) arquivos.push(caminho);
  }
};
try { varrer(join(RAIZ, "dist")); }
catch { console.error("dist/ não existe — rode `npx vite build` antes."); process.exit(1); }

let vazamentos = 0;
for (const caminho of arquivos) {
  const conteudo = readFileSync(caminho, "utf8");
  for (const [chave, valor] of SENSIVEIS)
    if (conteudo.includes(valor)) {
      vazamentos++;
      console.log(`❌ VAZAMENTO: valor de ${chave} presente em ${caminho.replace(RAIZ, "")}`);
    }
  for (const padrao of [/\bsk_(live|test)_[A-Za-z0-9]{16,}/, /\bwhsec_[A-Za-z0-9]{16,}/, /"role"\s*:\s*"service_role"/])
    if (padrao.test(conteudo)) {
      vazamentos++;
      console.log(`❌ PADRÃO PERIGOSO ${padrao} em ${caminho.replace(RAIZ, "")}`);
    }
}
console.log(vazamentos
  ? `\n❌ ${vazamentos} vazamento(s) — NÃO faça deploy até corrigir`
  : `✅ bundle limpo: ${arquivos.length} arquivos verificados, ${SENSIVEIS.length} segredos do .env procurados, nenhum vazou`);
process.exit(vazamentos ? 1 : 0);
