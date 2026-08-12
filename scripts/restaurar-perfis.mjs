/* Restaura os perfis nativos do sistema que tenham sido excluídos da tabela
   "perfis" (a lista canônica é a mesma do seed em supabase-schema.sql).
   Perfis existentes são mantidos; só os que faltam são recriados.
   Uso:  node scripts/restaurar-perfis.mjs   (lê as credenciais do .env) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

/* a RLS de "perfis" só permite leitura — a escrita exige a service_role */
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const NATIVOS = [
  ["administradora", "Gestão SaaS: clientes, planos e licenças"],
  ["diretor",        "Visão estratégica, aprovações e auditoria"],
  ["sindico",        "Operação, multas, comunicados e manutenção"],
  ["tesouraria",     "Financeiro, cobranças e conciliação"],
  ["conselho_fiscal","Consulta fiscal e pareceres"],
  ["morador",        "Boletos, comprovantes, comunicados e chamados"],
  ["funcionario",    "Operação interna designada"],
  ["prestador",      "Prestador de serviço externo"],
];

const { data: atuais, error } = await sb.from("perfis").select("id, nome");
if (error) { console.error("Erro ao ler perfis:", error.message); process.exit(1); }
console.log("Perfis existentes:", atuais.map((p) => p.nome).sort().join(", ") || "(nenhum)");

const existentes = new Set(atuais.map((p) => p.nome));
const faltando = NATIVOS.filter(([nome]) => !existentes.has(nome));
if (!faltando.length) { console.log("Nada a restaurar — os 8 perfis nativos estão presentes."); process.exit(0); }

const { data: criados, error: eIns } = await sb.from("perfis")
  .insert(faltando.map(([nome, descricao]) => ({ nome, descricao, sistema: true }))).select("nome");
if (eIns) { console.error("Erro ao restaurar:", eIns.message); process.exit(1); }
console.log("Restaurados:", criados.map((p) => p.nome).join(", "));

/* sanidade: nenhum vínculo de usuário pode ter ficado órfão (o FK impede,
   mas conferimos mesmo assim) */
const { data: vincs } = await sb.from("usuario_perfis").select("perfil_id, perfis(nome)");
const orfaos = (vincs || []).filter((v) => !v.perfis);
console.log(orfaos.length
  ? `ATENÇÃO: ${orfaos.length} vínculo(s) de usuário órfão(s) — investigar.`
  : "OK: todos os vínculos de usuário apontam para um perfil válido.");
