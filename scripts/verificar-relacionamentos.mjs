// Prova que o banco é relacional: o PostgREST só aceita consulta aninhada
// (embed) quando a foreign key existe DE FATO no banco. Se alguma FK
// estivesse faltando, a consulta falharia com "Could not find a relationship".
// Uso: node scripts/verificar-relacionamentos.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const sb = createClient(env.VITE_SUPABASE_URL, key);

// domínio → consulta aninhada que só funciona se as FKs existirem
const RELACOES = {
  "condomínio → unidades/blocos":        sb.from("condominios").select("id, unidades(count), blocos(count)").limit(1),
  "unidade → bloco + responsável":       sb.from("unidades").select("numero, blocos(nome), pessoas(nome)").limit(1),
  "unidade → vagas de garagem":          sb.from("unidades").select("numero, vagas(numero)").limit(1),
  "pessoa → vínculos (papel/unidade)":   sb.from("pessoas").select("nome, pessoa_vinculos(papel, unidades(numero))").limit(1),
  "financeiro: lançamento → categoria":  sb.from("lancamentos").select("descricao, categorias_financeiras(nome), fundos(nome)").limit(1),
  "cobrança → unidade + responsável":    sb.from("cobrancas").select("competencia, unidades(numero), pessoas(nome)").limit(1),
  "cobrança → pagamentos recebidos":     sb.from("cobrancas").select("status, pagamentos(valor_pago, pago_em)").limit(1),
  "multa → unidade/infrator/provas":     sb.from("penalidades").select("numero, unidades(numero), pessoas(nome), penalidade_provas(tipo)").limit(1),
  "multa → documento + lançamento":      sb.from("penalidades").select("numero, documentos(titulo), lancamentos(descricao)").limit(1),
  "comunicado → leituras por pessoa":    sb.from("comunicados").select("titulo, comunicado_destinatarios(pessoas(nome), lido_em)").limit(1),
  "documento → unidade + emissor":       sb.from("documentos").select("titulo, unidades(numero), usuarios(email)").limit(1),
  "manutenção: chamado → unidade/resp.": sb.from("chamados").select("numero, unidades(numero), pessoa_vinculos(pessoas(nome))").limit(1),
  "portaria: acesso → pré-autorização":  sb.from("acessos_portaria").select("tipo, pre_autorizacoes(nome), unidades(numero)").limit(1),
  "portaria: pré-aut. → unidade/autor":  sb.from("pre_autorizacoes").select("nome, unidades(numero), usuarios(email)").limit(1),
  "acesso: usuário → pessoa + perfis":   sb.from("usuarios").select("email, pessoas(nome), usuario_perfis(perfis(nome), condominios(nome_fantasia))").limit(1),
  "acesso: perfil → permissões (N:N)":   sb.from("perfis").select("nome, perfil_permissoes(permissoes(codigo))").limit(1),
  "planos: assinatura → plano + cond.":  sb.from("saas_assinaturas").select("status, saas_planos(nome, preco_mensal), condominios(nome_fantasia)").limit(1),
  "reserva → área comum + cobrança":     sb.from("reservas").select("inicio, areas_comuns(nome), cobrancas(status)").limit(1),
};

let falhas = 0;
for (const [nome, consulta] of Object.entries(RELACOES)) {
  const { error } = await consulta;
  if (error) { console.log(`✗ ${nome}: ${error.message}`); falhas++; }
  else console.log(`✔ ${nome}`);
}
console.log(falhas
  ? `\n${falhas} relacionamento(s) com problema — ver mensagens acima.`
  : "\nTodos os relacionamentos existem no banco: o modelo é relacional de ponta a ponta.");
process.exit(falhas ? 1 : 0);
