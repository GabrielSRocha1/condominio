/* Auditoria de isolamento multi-tenant: um token de OUTRO condomínio (e de
   perfis diferentes) não pode ler nem escrever nada do condomínio real.
   Varre todas as tabelas do supabase-schema.sql. */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

const raiz = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const { createClient } = createRequire(`${raiz}/package.json`)("@supabase/supabase-js");
const env = Object.fromEntries(
  readFileSync(`${raiz}/.env`, "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;

/* todas as tabelas do schema */
const schema = readFileSync(`${raiz}/supabase-schema.sql`, "utf8");
const tabelas = [...schema.matchAll(/^create table (\w+)/gm)].map((m) => m[1]);

/* leitura liberada por desenho (referência do produto, sem dados de usuário) */
const referencia = new Set(["saas_planos", "perfis", "permissoes", "perfil_permissoes"]);

const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: conds } = await admin.from("condominios").select("id, nome_fantasia").limit(5);
const alvo = conds[0]; // condomínio real (vítima)

const b64u = (s) => Buffer.from(s).toString("base64url");
const assinar = (claims) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role: "authenticated", iss: "condomaster", exp: Math.floor(Date.now() / 1000) + 300, sub: "auditoria", ...claims }));
  return `${h}.${p}.${createHmac("sha256", env.SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const cliente = (claims) => createClient(url, env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${assinar(claims)}` } } });

const OUTRO = "00000000-0000-0000-0000-00000000dead";
const perfis = [
  ["diretor de outro condomínio", cliente({ perfil: "diretor", condominio_id: OUTRO })],
  ["morador de outro condomínio", cliente({ perfil: "morador", condominio_id: OUTRO })],
  ["token sem condominio_id",     cliente({ perfil: "diretor", condominio_id: null })],
  ["anon (sem login)",            createClient(url, env.VITE_SUPABASE_ANON_KEY)],
];

console.log(`Condomínio real no banco: "${alvo.nome_fantasia}" — ${tabelas.length} tabelas do schema\n`);
let vazamentos = 0;

for (const [nomePerfil, cli] of perfis) {
  const problemas = [];
  for (const t of tabelas) {
    const { data, error } = await cli.from(t).select("*").limit(5);
    if (error) continue;                       // negado/inexistente = ok
    if (data.length === 0) continue;           // nada visível = ok
    if (referencia.has(t)) continue;           // leitura pública por desenho
    problemas.push(`${t} (${data.length} linha(s) visíveis!)`);
  }
  if (problemas.length) { vazamentos += problemas.length; console.log(`✗ ${nomePerfil} CONSEGUE LER: ${problemas.join(", ")}`); }
  else console.log(`✔ ${nomePerfil}: nenhuma tabela com dados visíveis (fora as de referência)`);
}

/* escritas cruzadas: tentar gravar/alterar dados NO condomínio real com token estrangeiro */
console.log("\nEscritas cruzadas (devem TODAS falhar):");
const invasor = perfis[0][1];
const escritas = [
  ["insert pessoas no condomínio real", invasor.from("pessoas").insert({ condominio_id: alvo.id, nome: "Invasor", tipo_pessoa: "fisica", cpf_cnpj: `X-${Date.now()}` }).select()],
  ["update condominios do condomínio real", invasor.from("condominios").update({ nome_fantasia: "HACKEADO" }).eq("id", alvo.id).select()],
  ["insert lancamentos no condomínio real", invasor.from("lancamentos").insert({ condominio_id: alvo.id, tipo: "despesa", descricao: "x", valor: 1, data: "2026-01-01", competencia: "2026-01" }).select()],
  ["delete pessoas do condomínio real", invasor.from("pessoas").delete().eq("condominio_id", alvo.id).select()],
];
for (const [nome, p] of escritas) {
  const { data, error } = await p;
  const bloqueado = error || !data || data.length === 0;
  if (bloqueado) console.log(`✔ bloqueado: ${nome}`);
  else { vazamentos++; console.log(`✗ PASSOU: ${nome} — ${JSON.stringify(data).slice(0, 120)}`); }
}

/* nota: perfil administradora (dona do SaaS) lê condominios/unidades/saas_assinaturas por desenho */
const adm = cliente({ perfil: "administradora", condominio_id: null });
const { data: admConds } = await adm.from("condominios").select("id");
const { data: admPessoas } = await adm.from("pessoas").select("id").limit(1);
console.log(`\nPerfil administradora (painel SaaS, por desenho): vê ${admConds?.length ?? 0} condomínio(s); pessoas: ${admPessoas?.length ? "VAZOU!" : "bloqueado ✔"}`);
if (admPessoas?.length) vazamentos++;

console.log(vazamentos ? `\n✗ ${vazamentos} VAZAMENTO(S) ENCONTRADO(S)` : "\n✔ Nenhum vazamento: dados isolados por condomínio.");
process.exit(vazamentos ? 1 : 0);
