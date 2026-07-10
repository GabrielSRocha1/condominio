import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("C:/Users/gabri/Downloads/condomaster-pro-projeto-v1_1/.env", "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const conds = await sb.from("condominios").select("id, nome_fantasia, unidades(count)").order("criado_em");
if (conds.error) { console.log("FALHOU condominios:", conds.error.message); process.exit(1); }
const principal = [...conds.data].sort((a, b) => (b.unidades?.[0]?.count ?? 0) - (a.unidades?.[0]?.count ?? 0))[0];
console.log("condomínio principal:", principal.nome_fantasia);
const cid = principal.id;

const tests = {
  unidades: sb.from("unidades").select("*, blocos(nome), pessoas(nome)").eq("condominio_id", cid).is("deletado_em", null),
  lancamentos: sb.from("lancamentos").select("*, categorias_financeiras(nome)").eq("condominio_id", cid),
  cobrancas: sb.from("cobrancas").select("*, unidades(numero, blocos(nome)), pessoas(nome)").eq("condominio_id", cid),
  penalidades: sb.from("penalidades").select("*, unidades(numero, blocos(nome)), pessoas(nome)").eq("condominio_id", cid),
  comunicados: sb.from("comunicados").select("*, comunicado_destinatarios(lido_em)").eq("condominio_id", cid),
  chamados: sb.from("chamados").select("*, pessoa_vinculos(pessoas(nome))").eq("condominio_id", cid),
  acessos: sb.from("acessos_portaria").select("*, unidades(numero, blocos(nome))").eq("condominio_id", cid),
  documentos: sb.from("documentos").select("*, unidades(numero, blocos(nome))").eq("condominio_id", cid),
  tenants: sb.from("condominios").select("id, nome_fantasia, saas_assinaturas(status, renovacao, saas_planos(nome, preco_mensal)), unidades(count)"),
  pagamentos: sb.from("pagamentos").select("valor_pago, pago_em, cobrancas(unidades(numero, blocos(nome)))").eq("condominio_id", cid),
};

let falhas = 0;
for (const [nome, p] of Object.entries(tests)) {
  const { data, error } = await p;
  if (error) { console.log(`✗ ${nome}: ${error.message}`); falhas++; }
  else console.log(`✔ ${nome}: ${data.length} linha(s)`);
}
console.log(falhas ? `\n${falhas} consulta(s) falharam` : "\nTodas as consultas funcionam!");
