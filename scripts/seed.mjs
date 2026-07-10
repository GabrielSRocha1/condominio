/* Popula o Supabase com os dados de demonstração do CondoMaster Pro.
   Uso:  node scripts/seed.mjs   (lê as credenciais do .env) */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const sha = (s) => createHash("sha256").update(s).digest("hex");

async function ins(table, rows) {
  const { data, error } = await sb.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ✔ ${table}: ${data.length} registro(s)`);
  return data;
}
const byKey = (arr, key) => Object.fromEntries(arr.map((r) => [r[key], r]));

// ─── já populado? ───
const { data: existing, error: exErr } = await sb.from("condominios").select("id").eq("cnpj", "12.345.678/0001-90");
if (exErr) { console.error("Erro ao consultar o banco:", exErr.message); process.exit(1); }
if (existing.length) { console.log("O banco já está populado (Residencial Águas Claras existe). Nada a fazer."); process.exit(0); }

console.log("Populando o banco de demonstração…");

// ─── planos e perfis (criados pelo schema) ───
const planos = byKey((await sb.from("saas_planos").select("id,nome")).data, "nome");
const perfis = byKey((await sb.from("perfis").select("id,nome")).data, "nome");

// ─── condomínios (tenants) ───
const conds = await ins("condominios", [
  { nome_fantasia: "Residencial Águas Claras", razao_social: "Condomínio Residencial Águas Claras", cnpj: "12.345.678/0001-90",
    endereco: { logradouro: "Av. das Palmeiras", numero: "1200", bairro: "Centro", cidade: "Foz do Iguaçu", uf: "PR", cep: "85851-000" },
    tipo: "residencial", porte: "alto",
    regras_internas: { silencio: "22h — 8h", mudancas: "Seg–Sáb, 8h–17h, com agendamento", obras: "Seg–Sex, 8h–17h", visitantes: "Pré-autorização pelo portal", animais: "Permitidos com coleira nas áreas comuns", areas_comuns: "Reserva com 48h de antecedência" },
    identidade_visual: { sigla: "AC", cor_primaria: "#D4AF37", assinante: "Roberto Silva — Síndico" } },
  { nome_fantasia: "Edifício Comercial Center", razao_social: "Condomínio Edifício Comercial Center", cnpj: "23.456.789/0001-01",
    endereco: { logradouro: "Rua Almirante Barroso", numero: "500", bairro: "Centro", cidade: "Foz do Iguaçu", uf: "PR", cep: "85851-010" },
    tipo: "comercial", porte: "medio" },
  { nome_fantasia: "Condomínio Vila Verde", razao_social: "Condomínio Residencial Vila Verde", cnpj: "34.567.890/0001-12",
    endereco: { logradouro: "Rua das Acácias", numero: "80", bairro: "Vila A", cidade: "Foz do Iguaçu", uf: "PR", cep: "85852-000" },
    tipo: "residencial", porte: "baixo" },
  { nome_fantasia: "Torres do Lago", razao_social: "Condomínio Torres do Lago", cnpj: "45.678.901/0001-23",
    endereco: { logradouro: "Av. Beira Lago", numero: "3000", bairro: "Lago Azul", cidade: "Foz do Iguaçu", uf: "PR", cep: "85853-000" },
    tipo: "residencial", porte: "alto" },
]);
const AC = conds[0].id;

await ins("saas_assinaturas", [
  { condominio_id: AC,          plano_id: planos["Premium"].id,   status: "ativa",        inicio: "2026-01-05", renovacao: "2026-07-05", forma_pagamento: "verum_pay" },
  { condominio_id: conds[1].id, plano_id: planos["Standard"].id,  status: "ativa",        inicio: "2026-02-12", renovacao: "2026-07-12", forma_pagamento: "verum_pay" },
  { condominio_id: conds[2].id, plano_id: planos["Essencial"].id, status: "teste",        inicio: "2026-06-15", forma_pagamento: "transferencia" },
  { condominio_id: conds[3].id, plano_id: planos["Premium"].id,   status: "inadimplente", inicio: "2025-11-28", renovacao: "2026-06-28", forma_pagamento: "verum_pay" },
]);

// ─── blocos ───
const blocos = byKey(await ins("blocos", [
  { condominio_id: AC, nome: "A", andares: 12 },
  { condominio_id: AC, nome: "B", andares: 12 },
  { condominio_id: AC, nome: "T", andares: 1 },
]), "nome");

// ─── pessoas ───
const pessoas = byKey(await ins("pessoas", [
  { condominio_id: AC, nome: "Carlos Mendes",     tipo_pessoa: "fisica",   cpf_cnpj: "412.345.678-10",     telefone: "(45) 9 9911-2233", email: "carlos.mendes@email.com" },
  { condominio_id: AC, nome: "Ana Beatriz Rocha", tipo_pessoa: "fisica",   cpf_cnpj: "318.222.333-77",     telefone: "(45) 9 9822-4410", email: "ana.rocha@email.com" },
  { condominio_id: AC, nome: "Roberto Silva",     tipo_pessoa: "fisica",   cpf_cnpj: "225.111.444-04",     telefone: "(45) 9 9733-8891", email: "sindico@aguasclaras.com.br" },
  { condominio_id: AC, nome: "Fernanda Costa",    tipo_pessoa: "fisica",   cpf_cnpj: "377.888.999-21",     telefone: "(45) 9 9555-6677", email: "fernanda.costa@email.com" },
  { condominio_id: AC, nome: "Marcos Paulo",      tipo_pessoa: "fisica",   cpf_cnpj: "509.666.777-33",     telefone: "(45) 9 9644-1102", email: "marcos.paulo@email.com" },
  { condominio_id: AC, nome: "ElevaTec Ltda",     tipo_pessoa: "juridica", cpf_cnpj: "12.345.678/0002-71", telefone: "(45) 3222-7788",   email: "contato@elevatec.com.br" },
  { condominio_id: AC, nome: "Padaria Real Ltda", tipo_pessoa: "juridica", cpf_cnpj: "98.765.432/0001-55", telefone: "(45) 3222-1100",   email: "padaria.real@email.com" },
]), "nome");
const P = (n) => pessoas[n].id;

await sb.from("condominios").update({ sindico_pessoa_id: P("Roberto Silva") }).eq("id", AC);

// ─── unidades ───
const unidades = byKey(await ins("unidades", [
  { condominio_id: AC, bloco_id: blocos["A"].id, numero: "101",   tipo: "apartamento", andar: 1, status: "ocupada", fracao_ideal: 0.62, area_privativa_m2: 86,  responsavel_financeiro_id: P("Carlos Mendes") },
  { condominio_id: AC, bloco_id: blocos["A"].id, numero: "102",   tipo: "apartamento", andar: 1, status: "alugada", fracao_ideal: 0.58, area_privativa_m2: 74,  responsavel_financeiro_id: P("Ana Beatriz Rocha") },
  { condominio_id: AC, bloco_id: blocos["A"].id, numero: "201",   tipo: "apartamento", andar: 2, status: "ocupada", fracao_ideal: 0.62, area_privativa_m2: 86,  responsavel_financeiro_id: P("Roberto Silva") },
  { condominio_id: AC, bloco_id: blocos["A"].id, numero: "202",   tipo: "cobertura",   andar: 2, status: "ocupada", fracao_ideal: 1.10, area_privativa_m2: 148, responsavel_financeiro_id: P("Fernanda Costa") },
  { condominio_id: AC, bloco_id: blocos["T"].id, numero: "LJ-01", tipo: "loja",        andar: 0, status: "alugada", fracao_ideal: 0.45, area_privativa_m2: 60,  responsavel_financeiro_id: P("Padaria Real Ltda") },
  { condominio_id: AC, bloco_id: blocos["B"].id, numero: "301",   tipo: "apartamento", andar: 3, status: "vaga",    fracao_ideal: 0.58, area_privativa_m2: 74 },
]), "numero");
const U = (n) => unidades[n].id;

// ─── vagas ───
await ins("vagas", [
  { condominio_id: AC, numero: "V-01", tipo: "fixa", status: "vinculada", unidade_id: U("101") },
  { condominio_id: AC, numero: "V-02", tipo: "fixa", status: "vinculada", unidade_id: U("101") },
  { condominio_id: AC, numero: "V-03", tipo: "fixa", status: "vinculada", unidade_id: U("102") },
  { condominio_id: AC, numero: "V-04", tipo: "fixa", status: "vinculada", unidade_id: U("201") },
  { condominio_id: AC, numero: "V-05", tipo: "fixa", status: "vinculada", unidade_id: U("201") },
  { condominio_id: AC, numero: "V-06", tipo: "fixa", status: "vinculada", unidade_id: U("202") },
  { condominio_id: AC, numero: "V-07", tipo: "fixa", status: "vinculada", unidade_id: U("202") },
  { condominio_id: AC, numero: "V-08", tipo: "PCD".toLowerCase(), status: "vinculada", unidade_id: U("202") },
  { condominio_id: AC, numero: "V-09", tipo: "fixa", status: "vinculada", unidade_id: U("301") },
  { condominio_id: AC, numero: "VIS-1", tipo: "visitante", status: "livre" },
  { condominio_id: AC, numero: "VIS-2", tipo: "visitante", status: "livre" },
  { condominio_id: AC, numero: "VIS-3", tipo: "visitante", status: "bloqueada" },
]);

// ─── vínculos (papéis) ───
const vinculos = await ins("pessoa_vinculos", [
  { condominio_id: AC, pessoa_id: P("Carlos Mendes"),     unidade_id: U("101"),   papel: "proprietario", inicio: "2024-03-01" },
  { condominio_id: AC, pessoa_id: P("Ana Beatriz Rocha"), unidade_id: U("102"),   papel: "inquilino",    inicio: "2025-08-01" },
  { condominio_id: AC, pessoa_id: P("Roberto Silva"),     unidade_id: U("201"),   papel: "proprietario", inicio: "2023-01-15" },
  { condominio_id: AC, pessoa_id: P("Roberto Silva"),     papel: "sindico",       inicio: "2026-01-01" },
  { condominio_id: AC, pessoa_id: P("Fernanda Costa"),    unidade_id: U("202"),   papel: "proprietario", inicio: "2024-11-10" },
  { condominio_id: AC, pessoa_id: P("Padaria Real Ltda"), unidade_id: U("LJ-01"), papel: "inquilino",    inicio: "2025-02-01" },
  { condominio_id: AC, pessoa_id: P("Marcos Paulo"),      papel: "funcionario",   inicio: "2024-06-01" },
  { condominio_id: AC, pessoa_id: P("ElevaTec Ltda"),     papel: "prestador",     inicio: "2025-01-01" },
]);
const vincMarcos  = vinculos.find((v) => v.pessoa_id === P("Marcos Paulo") && v.papel === "funcionario").id;
const vincElevaTec = vinculos.find((v) => v.pessoa_id === P("ElevaTec Ltda")).id;

// ─── usuário (síndico) ───
const [usuario] = await ins("usuarios", [
  { pessoa_id: P("Roberto Silva"), email: "sindico@aguasclaras.com.br", senha_hash: "demo-sem-login-real" },
]);
await ins("usuario_perfis", [
  { usuario_id: usuario.id, condominio_id: AC, perfil_id: perfis["sindico"].id },
]);

// ─── categorias financeiras ───
const cats = byKey(await ins("categorias_financeiras", [
  { condominio_id: AC, nome: "Taxa condominial", tipo: "receita" },
  { condominio_id: AC, nome: "Multas",           tipo: "receita" },
  { condominio_id: AC, nome: "Extras",           tipo: "receita" },
  { condominio_id: AC, nome: "Portaria",         tipo: "despesa" },
  { condominio_id: AC, nome: "Limpeza",          tipo: "despesa" },
  { condominio_id: AC, nome: "Manutenção",       tipo: "despesa" },
  { condominio_id: AC, nome: "Energia",          tipo: "despesa" },
  { condominio_id: AC, nome: "Água",             tipo: "despesa" },
  { condominio_id: AC, nome: "Elevadores",       tipo: "despesa" },
  { condominio_id: AC, nome: "Jardinagem",       tipo: "despesa" },
  { condominio_id: AC, nome: "Administração",    tipo: "despesa" },
  { condominio_id: AC, nome: "Fundo de reserva", tipo: "ambas" },
]), "nome");
const C = (n) => cats[n].id;

await ins("fundos", [
  { condominio_id: AC, nome: "Fundo de reserva", saldo: 64100 },
  { condominio_id: AC, nome: "Fundo de obras",   saldo: 21500 },
]);

// ─── lançamentos (jan–jun 2026) ───
const uid = usuario.id;
const hist = [
  ["2026-01", 84200, 61300], ["2026-02", 86100, 64800], ["2026-03", 83400, 70100],
  ["2026-04", 88900, 62450], ["2026-05", 87300, 66900],
].flatMap(([comp, rec, desp]) => [
  { condominio_id: AC, tipo: "receita", categoria_id: C("Taxa condominial"), descricao: `Rateio ${comp.slice(5)}/${comp.slice(0, 4)} — 96 unidades`, valor: rec, data: `${comp}-10`, competencia: comp, status: "pago", forma_pagamento: "verum_pay", lancado_por: uid, aprovado_por: uid },
  { condominio_id: AC, tipo: "despesa", categoria_id: C("Administração"), descricao: `Despesas consolidadas ${comp.slice(5)}/${comp.slice(0, 4)}`, valor: desp, data: `${comp}-25`, competencia: comp, status: "pago", forma_pagamento: "transferencia", lancado_por: uid, aprovado_por: uid },
]);
const jun = [
  { cat: "Portaria",   desc: "Folha equipe portaria",            v: 21400, forma: "transferencia" },
  { cat: "Limpeza",    desc: "Equipe de limpeza — junho",        v: 12800, forma: "transferencia" },
  { cat: "Manutenção", desc: "Manutenções gerais — junho",       v: 9800,  forma: "transferencia" },
  { cat: "Energia",    desc: "COPEL — competência 05/26",        v: 8400,  forma: "debito_automatico" },
  { cat: "Água",       desc: "Sanepar — competência 05/26",      v: 7100,  forma: "debito_automatico" },
  { cat: "Elevadores", desc: "Contrato manutenção elevadores",   v: 4200,  forma: "transferencia" },
  { cat: "Jardinagem", desc: "Serviço de jardinagem — junho",    v: 2900,  forma: "transferencia" },
].map((d) => ({ condominio_id: AC, tipo: "despesa", categoria_id: C(d.cat), descricao: d.desc, valor: d.v, data: "2026-06-05", competencia: "2026-06", status: "pago", forma_pagamento: d.forma, lancado_por: uid, aprovado_por: uid }));

const lancs = await ins("lancamentos", [
  ...hist, ...jun,
  { condominio_id: AC, tipo: "receita", categoria_id: C("Taxa condominial"), descricao: "Rateio junho — 96 unidades", valor: 88900, data: "2026-06-10", competencia: "2026-06", status: "aprovado", forma_pagamento: "verum_pay", lancado_por: uid, aprovado_por: uid },
  { condominio_id: AC, tipo: "despesa", categoria_id: C("Manutenção"), descricao: "Reparo bomba d'água — Bloco B", valor: 3200, data: "2026-06-14", competencia: "2026-06", status: "aguardando_aprovacao", forma_pagamento: "transferencia", lancado_por: uid },
  { condominio_id: AC, tipo: "receita", categoria_id: C("Multas"), descricao: "Multa 2026-013 — unidade LJ-01", valor: 350, data: "2026-06-18", competencia: "2026-06", status: "aprovado", forma_pagamento: "verum_pay", lancado_por: uid, aprovado_por: uid },
]);
const lancMulta = lancs[lancs.length - 1];

// ─── documentos timbrados ───
const docs = await ins("documentos", [
  { condominio_id: AC, tipo: "multa",      titulo: "Multa 2026-013 — LJ-01",           unidade_id: U("LJ-01"), arquivo_url: "https://storage.demo/multa-2026-013.pdf",  hash_sha256: sha("multa-2026-013"),  template_versao: "v1", emitido_por: uid, retencao_ate: "2031-06-04" },
  { condominio_id: AC, tipo: "convocacao", titulo: "Convocação AGO 30/06",                                      arquivo_url: "https://storage.demo/convocacao-ago.pdf",   hash_sha256: sha("convocacao-ago"),   template_versao: "v1", emitido_por: uid, retencao_ate: "2031-06-10" },
  { condominio_id: AC, tipo: "ata",        titulo: "Ata — Assembleia 28/03",                                    arquivo_url: "https://storage.demo/ata-2026-03-28.pdf",   hash_sha256: sha("ata-2026-03-28"),   template_versao: "v1", emitido_por: uid, retencao_ate: "2031-03-30" },
  { condominio_id: AC, tipo: "recibo",     titulo: "Recibo — pagamento 202-A junho",   unidade_id: U("202"),   arquivo_url: "https://storage.demo/recibo-202a-jun.pdf",  hash_sha256: sha("recibo-202a-jun"),  template_versao: "v1", emitido_por: uid, retencao_ate: "2031-06-12" },
]);

// ─── cobranças ───
const cobr = await ins("cobrancas", [
  { condominio_id: AC, unidade_id: U("101"),   responsavel_id: P("Carlos Mendes"),     competencia: "2026-06", tipo: "ordinaria", valor_original: 920.00,  vencimento: "2026-06-10", status: "paga",    provider_charge_id: "VP-9F31A2" },
  { condominio_id: AC, unidade_id: U("102"),   responsavel_id: P("Ana Beatriz Rocha"), competencia: "2026-06", tipo: "ordinaria", valor_original: 860.00,  vencimento: "2026-06-10", status: "vencida" },
  { condominio_id: AC, unidade_id: U("202"),   responsavel_id: P("Fernanda Costa"),    competencia: "2026-06", tipo: "ordinaria", valor_original: 1630.00, vencimento: "2026-06-10", status: "paga",    provider_charge_id: "VP-7C08E1" },
  { condominio_id: AC, unidade_id: U("LJ-01"), responsavel_id: P("Padaria Real Ltda"), competencia: "2026-06", tipo: "ordinaria", valor_original: 1120.00, vencimento: "2026-06-10", status: "vencida" },
  { condominio_id: AC, unidade_id: U("201"),   responsavel_id: P("Roberto Silva"),     competencia: "2026-06", tipo: "ordinaria", valor_original: 920.00,  vencimento: "2026-06-10", status: "emitida" },
  { condominio_id: AC, unidade_id: U("102"),   responsavel_id: P("Ana Beatriz Rocha"), competencia: "2026-05", tipo: "ordinaria", valor_original: 860.00,  vencimento: "2026-05-10", status: "paga",    provider_charge_id: "VP-5B22D0" },
  { condominio_id: AC, unidade_id: U("102"),   responsavel_id: P("Ana Beatriz Rocha"), competencia: "2026-04", tipo: "ordinaria", valor_original: 845.00,  vencimento: "2026-04-10", status: "paga",    provider_charge_id: "VP-4A19C8" },
]);

await ins("pagamentos", [
  { condominio_id: AC, cobranca_id: cobr[0].id, valor_pago: 920.00,  pago_em: "2026-06-08T14:22:00-03:00", origem: "webhook", provider_event_id: "evt-2026-06-0001", provider_tx_id: "VP-9F31A2" },
  { condominio_id: AC, cobranca_id: cobr[2].id, valor_pago: 1630.00, pago_em: "2026-06-09T09:10:00-03:00", origem: "webhook", provider_event_id: "evt-2026-06-0002", provider_tx_id: "VP-7C08E1" },
  { condominio_id: AC, cobranca_id: cobr[5].id, valor_pago: 860.00,  pago_em: "2026-05-09T11:40:00-03:00", origem: "webhook", provider_event_id: "evt-2026-05-0001", provider_tx_id: "VP-5B22D0" },
  { condominio_id: AC, cobranca_id: cobr[6].id, valor_pago: 845.00,  pago_em: "2026-04-08T16:05:00-03:00", origem: "webhook", provider_event_id: "evt-2026-04-0001", provider_tx_id: "VP-4A19C8" },
]);

// ─── penalidades ───
await ins("penalidades", [
  { condominio_id: AC, numero: "2026-014", tipo: "multa", unidade_id: U("102"), infrator_id: P("Ana Beatriz Rocha"),
    categoria_infracao: "Barulho após horário de silêncio", descricao: "Som alto após as 22h, reclamação de 3 unidades vizinhas.",
    base_normativa: "Regimento interno, art. 12", ocorrida_em: "2026-06-12T23:15:00-03:00", valor: 480,
    prazo_defesa: "2026-06-22", status: "em_defesa", registrada_por: uid },
  { condominio_id: AC, numero: "2026-013", tipo: "multa", unidade_id: U("LJ-01"), infrator_id: P("Padaria Real Ltda"),
    categoria_infracao: "Descarte irregular de resíduos", descricao: "Resíduos comerciais descartados fora da área designada.",
    base_normativa: "Regimento interno, art. 18", ocorrida_em: "2026-06-04T07:40:00-03:00", valor: 350,
    prazo_defesa: "2026-06-14", status: "aprovada", registrada_por: uid, decidida_por: uid,
    parecer: "Defesa não apresentada no prazo. Multa mantida.", documento_id: docs[0].id, lancamento_id: lancMulta.id },
  { condominio_id: AC, numero: "2026-012", tipo: "advertencia", unidade_id: U("301"),
    categoria_infracao: "Uso indevido de vaga", descricao: "Visitante autorizado estacionou em vaga fixa de outra unidade.",
    base_normativa: "Convenção, art. 22", ocorrida_em: "2026-05-28T19:30:00-03:00",
    status: "aprovada", registrada_por: uid, decidida_por: uid, parecer: "Primeira ocorrência: advertência formal." },
]);

// ─── comunicados + leitura ───
const coms = await ins("comunicados", [
  { condominio_id: AC, tipo: "comunicado", titulo: "Manutenção dos elevadores — Bloco A", corpo: "Os elevadores do Bloco A passarão por manutenção preventiva no dia 20/06, das 8h às 12h.", segmento: { todos: true }, canais: ["portal", "email"], publicado_em: "2026-06-18T09:00:00-03:00", publicado_por: uid },
  { condominio_id: AC, tipo: "convocacao", titulo: "Assembleia Geral Ordinária — 30/06", corpo: "Convocamos todos os condôminos para a AGO de 30/06 às 19h30 no salão de festas. Pauta: prestação de contas, previsão orçamentária e obras da fachada.", segmento: { todos: true }, canais: ["portal", "whatsapp"], publicado_em: "2026-06-10T10:00:00-03:00", publicado_por: uid, documento_id: docs[1].id },
  { condominio_id: AC, tipo: "aviso_manutencao", titulo: "Interrupção de água — caixa d'água", corpo: "Limpeza semestral da caixa d'água em 05/06: fornecimento interrompido das 9h às 14h.", segmento: { todos: true }, canais: ["portal"], publicado_em: "2026-06-02T08:00:00-03:00", publicado_por: uid },
]);
const todasPessoas = Object.values(pessoas).map((p) => p.id);
const dest = [];
coms.forEach((c, ci) => {
  const lidos = [5, 6, 7][ci];
  todasPessoas.forEach((pid, i) => {
    dest.push({ comunicado_id: c.id, pessoa_id: pid, lido_em: i < lidos ? "2026-06-19T12:00:00-03:00" : null });
  });
});
await ins("comunicado_destinatarios", dest);

// ─── chamados ───
await ins("chamados", [
  { condominio_id: AC, numero: "OS-231", categoria: "elevador",   prioridade: "alta",  descricao: "Elevador social parando entre andares", status: "andamento", aberto_por: uid, responsavel_vinculo_id: vincElevaTec, custo_estimado: 1800, criado_em: "2026-06-16T08:30:00-03:00" },
  { condominio_id: AC, numero: "OS-230", categoria: "hidraulica", prioridade: "alta",  descricao: "Vazamento na garagem G1",               status: "aberto",    aberto_por: uid, criado_em: "2026-06-15T17:10:00-03:00" },
  { condominio_id: AC, numero: "OS-229", categoria: "pintura",    prioridade: "media", descricao: "Pintura corredor 3º andar Bloco B",     status: "aberto",    aberto_por: uid, criado_em: "2026-06-12T10:00:00-03:00" },
  { condominio_id: AC, numero: "OS-227", categoria: "jardinagem", prioridade: "baixa", descricao: "Poda das palmeiras da entrada",         status: "concluido", aberto_por: uid, responsavel_vinculo_id: vincMarcos, custo_realizado: 420, criado_em: "2026-06-05T09:00:00-03:00", fechado_em: "2026-06-08T15:00:00-03:00" },
]);

// ─── áreas comuns ───
await ins("areas_comuns", [
  { condominio_id: AC, nome: "Salão de festas", taxa: 250, regras: { antecedencia_horas: 48, capacidade: 80 } },
  { condominio_id: AC, nome: "Churrasqueira",   taxa: 120, regras: { antecedencia_horas: 48, capacidade: 25 } },
  { condominio_id: AC, nome: "Quadra",          taxa: 0,   regras: { antecedencia_horas: 24 } },
]);

// ─── portaria: pré-autorização + acessos de hoje ───
const hoje = new Date().toISOString().slice(0, 10);
const [preAut] = await ins("pre_autorizacoes", [
  { condominio_id: AC, tipo: "visitante", nome: "João Pereira", unidade_id: U("101"), autorizada_por: uid,
    valida_de: `${hoje}T08:00:00-03:00`, valida_ate: `${hoje}T20:00:00-03:00`,
    qr_token_hash: sha(randomBytes(16).toString("hex")), usada_em: `${hoje}T14:32:00-03:00` },
]);
await ins("acessos_portaria", [
  { condominio_id: AC, tipo: "entrada", pre_autorizacao_id: preAut.id, pessoa_nome: "João Pereira (visitante)", unidade_id: U("101"), registrado_por: uid, detalhes: "QR pré-autorizado", ocorrido_em: `${hoje}T14:32:00-03:00` },
  { condominio_id: AC, tipo: "entrada", pessoa_nome: "ElevaTec — 2 técnicos", registrado_por: uid, detalhes: "OS-231 · Casa de máquinas", ocorrido_em: `${hoje}T13:10:00-03:00` },
  { condominio_id: AC, tipo: "entrega", pessoa_nome: "Entrega Mercado Livre", unidade_id: U("202"), registrado_por: uid, detalhes: "Retirada na portaria", ocorrido_em: `${hoje}T11:47:00-03:00` },
  { condominio_id: AC, tipo: "saida",   pessoa_nome: "Maria Souza (diarista)", unidade_id: U("201"), registrado_por: uid, detalhes: "Cadastro fixo", ocorrido_em: `${hoje}T09:15:00-03:00` },
]);

console.log("\n✅ Banco populado com sucesso! Recarregue o site para ver os dados reais.");
