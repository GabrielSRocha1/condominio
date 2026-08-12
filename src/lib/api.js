/* Camada de dados: lê e grava no Supabase e converte para o formato das telas. */
import { supabase, setAuthToken, getAuthToken } from "./supabase";
import { jsPDF } from "jspdf";

/* chamadas ao backend de autenticação (/api/auth/*) — é ele quem confere as
   credenciais e emite o token que o RLS usa para escopar por condomínio */
async function chamarAuth(rota, body) {
  let r;
  try {
    r = await fetch(`/api/auth/${rota}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch { throw new Error("Não foi possível falar com o servidor de login."); }
  const corpo = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(corpo?.error || `Erro ${r.status}.`); e.status = r.status; throw e; }
  return corpo;
}
export { setAuthToken, getAuthToken };

/* ─────────── helpers ─────────── */
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const ddmm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const ddmmyyyy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const compBR = (c) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : "—");
const mesLabel = (c) => MESES[Number(c.slice(5, 7)) - 1];
const num = (v) => Number(v || 0);
const primeiroNome = (n) => (n || "—").split(" ").slice(0, 2).join(" ");
const maskDoc = (d) => {
  if (!d) return "—";
  const only = d.replace(/[^\d]/g, "");
  if (only.length > 11) return d.slice(0, 9) + "***/****-" + d.slice(-2); // CNPJ
  return d.slice(0, 3) + ".***.***-" + d.slice(-2); // CPF
};
export const parseBRL = (s) => Number(String(s || "0").replace(/[R$\s.]/g, "").replace(",", ".")) || 0;

/* Formata um valor na moeda de gestão do condomínio — padrão: dólar (USD) */
const LOCALE_MOEDA = { BRL: "pt-BR", USD: "en-US", EUR: "de-DE", GBP: "en-GB", ARS: "es-AR", PYG: "es-PY" };
export const fmtMoeda = (v, moeda) => Number(v || 0).toLocaleString(
  LOCALE_MOEDA[moeda] || "en-US", { style: "currency", currency: LOCALE_MOEDA[moeda] ? moeda : "USD" });
const hex64 = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
};

const q = async (promise, label) => {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

/* ─────────── mapas de rótulos ─────────── */
const PAPEL_LABEL = {
  proprietario: "Proprietário", coproprietario: "Coproprietário", inquilino: "Inquilino", morador: "Morador",
  dependente: "Dependente", sindico: "Síndico", diretor: "Diretor", tesouraria: "Tesouraria",
  conselho_fiscal: "Conselho fiscal", funcionario: "Funcionário", prestador: "Prestador",
  visitante_recorrente: "Visitante recorrente", imobiliaria: "Imobiliária",
};
const PAPEL_ENUM = Object.fromEntries(Object.entries(PAPEL_LABEL).map(([k, v]) => [v, k]));
const PAPEL_PRIORIDADE = ["sindico", "diretor", "tesouraria", "proprietario", "inquilino", "funcionario", "prestador", "morador"];

const UNIDADE_TIPO_LABEL = { apartamento: "Apartamento", sala: "Sala", loja: "Loja", cobertura: "Cobertura", box: "Box", deposito: "Depósito" };
const UNIDADE_TIPO_ENUM = { Apartamento: "apartamento", "Sala comercial": "sala", Loja: "loja", Cobertura: "cobertura", Box: "box", "Depósito": "deposito", Vaga: "box" };
const UNIDADE_STATUS_ENUM = { Ocupada: "ocupada", Vaga: "vaga", Alugada: "alugada", Vendida: "vendida", Reservada: "reservada", Inativa: "inativa" };

const LANC_STATUS_UI = { pago: "pago", aguardando_aprovacao: "aguardando", aprovado: "aberto", rejeitado: "cancelado", cancelado: "cancelado" };
const FORMA_LABEL = { verum_pay: "QR Verum Pay", transferencia: "Transferência", debito_automatico: "Débito automático", dinheiro: "Dinheiro" };
const FORMA_ENUM = Object.fromEntries(Object.entries(FORMA_LABEL).map(([k, v]) => [v, k]));

const COBR_STATUS_UI = { paga: "pago", paga_em_atraso: "pago", rascunho: "emitida", emitida: "emitida", vencida: "vencida", cancelada: "cancelada", pagamento_divergente: "vencida" };

const COMUNIC_TIPO_LABEL = { comunicado: "Comunicado", convocacao: "Convocação", circular: "Circular", aviso_manutencao: "Aviso", emergencia: "Emergência" };
const COMUNIC_TIPO_ENUM = { "Comunicado geral": "comunicado", "Convocação de assembleia": "convocacao", Circular: "circular", "Aviso de manutenção": "aviso_manutencao", "Informe de emergência": "emergencia" };

const CHAMADO_CAT_LABEL = { eletrica: "Elétrica", hidraulica: "Hidráulica", pintura: "Pintura", limpeza: "Limpeza", elevador: "Elevador", portao: "Portão", cameras: "Câmeras", jardinagem: "Jardinagem", estrutural: "Estrutural", telhado: "Telhado", area_comum: "Área comum", equipamentos: "Equipamentos", emergencia: "Emergência" };
const CHAMADO_CAT_ENUM = Object.fromEntries(Object.entries(CHAMADO_CAT_LABEL).map(([k, v]) => [v, k]));
const PRIO_ENUM = { Baixa: "baixa", "Média": "media", Alta: "alta" };

const DOC_TIPO_LABEL = { multa: "Multas", advertencia: "Advertências", recibo: "Recibos", comprovante: "Recibos", convocacao: "Convocações", ata: "Atas", autorizacao: "Autorizações", circular: "Comunicados", extrato: "Extratos", ordem_servico: "Ordens de serviço" };
const DOC_TIPO_ENUM = { Comunicados: "circular", "Convocações": "convocacao", Atas: "ata", "Advertências": "advertencia", Multas: "multa", Recibos: "recibo", Extratos: "extrato", "Autorizações": "autorizacao", "Ordens de serviço": "ordem_servico" };

const PREAUT_TIPO_ENUM = { Visitante: "visitante", "Prestador de serviço": "prestador", Entrega: "entrega", "Visitante recorrente": "recorrente" };
const ACESSO_UI = {
  entrada: { tipo: "visitante", status: "dentro" },
  saida: { tipo: "recorrente", status: "saiu" },
  entrega: { tipo: "entrega", status: "retirado" },
  ocorrencia: { tipo: "prestador", status: "ocorrencia" },
};

/* ─────────── carga completa ─────────── */
export async function loadAll(condominioId) {
  const tenantsRaw = await q(
    supabase.from("condominios").select("id, nome_fantasia, saas_assinaturas(status, renovacao, saas_planos(nome, preco_mensal, preco_anual)), unidades(count)").order("criado_em"),
    "condominios"
  );
  if (!tenantsRaw.length) return { vazio: true }; // banco em branco: o app mostra o fluxo de primeiro acesso
  /* multi-tenant: cada conta enxerga SOMENTE o condomínio dela (vindo do
     login). Sem id — administradora, dona do SaaS — usa o maior só p/ stats. */
  const principal = condominioId
    ? tenantsRaw.find((t) => t.id === condominioId)
    : [...tenantsRaw].sort((a, b) => (b.unidades?.[0]?.count ?? 0) - (a.unidades?.[0]?.count ?? 0))[0];
  if (!principal) return { vazio: true }; // conta ainda sem condomínio próprio → fluxo de primeiro acesso
  const cid = principal.id;

  const [
    blocos, unidadesRaw, vagas, pessoasRaw, vinculos, usuarios, categorias, fundos,
    lancRaw, cobrRaw, multasRaw, comunicRaw, chamadosRaw, acessosRaw, docsRaw, pagamentosRaw,
    condRows,
  ] = await Promise.all([
    q(supabase.from("blocos").select("id, nome").eq("condominio_id", cid).order("nome"), "blocos"),
    q(supabase.from("unidades").select("*, blocos(nome), pessoas(nome)").eq("condominio_id", cid).is("deletado_em", null).order("numero"), "unidades"),
    q(supabase.from("vagas").select("id, unidade_id, tipo, status").eq("condominio_id", cid), "vagas"),
    q(supabase.from("pessoas").select("*").eq("condominio_id", cid).order("nome"), "pessoas"),
    q(supabase.from("pessoa_vinculos").select("*").eq("condominio_id", cid).is("fim", null), "pessoa_vinculos"),
    q(supabase.from("usuario_perfis").select("usuario_id").eq("condominio_id", cid).limit(1), "usuario_perfis"),
    q(supabase.from("categorias_financeiras").select("id, nome, tipo").eq("condominio_id", cid).eq("ativa", true), "categorias"),
    q(supabase.from("fundos").select("nome, saldo").eq("condominio_id", cid), "fundos"),
    q(supabase.from("lancamentos").select("*, categorias_financeiras(nome)").eq("condominio_id", cid).order("data", { ascending: false }), "lancamentos"),
    q(supabase.from("cobrancas").select("*, unidades(numero, blocos(nome)), pessoas(nome)").eq("condominio_id", cid).order("vencimento", { ascending: false }), "cobrancas"),
    q(supabase.from("penalidades").select("*, unidades(numero, blocos(nome)), pessoas(nome), penalidade_provas(id, tipo, arquivo_url)").eq("condominio_id", cid).order("numero", { ascending: false }), "penalidades"),
    q(supabase.from("comunicados").select("*, comunicado_destinatarios(lido_em)").eq("condominio_id", cid).order("criado_em", { ascending: false }), "comunicados"),
    q(supabase.from("chamados").select("*, pessoa_vinculos(pessoas(nome)), unidades(numero, blocos(nome))").eq("condominio_id", cid).order("criado_em", { ascending: false }), "chamados"),
    q(supabase.from("acessos_portaria").select("*, unidades(numero, blocos(nome))").eq("condominio_id", cid).order("ocorrido_em", { ascending: false }).limit(20), "acessos_portaria"),
    q(supabase.from("documentos").select("*, unidades(numero, blocos(nome))").eq("condominio_id", cid).is("deletado_em", null).order("criado_em", { ascending: false }), "documentos"),
    q(supabase.from("pagamentos").select("valor_pago, pago_em, cobrancas(unidades(numero, blocos(nome)))").eq("condominio_id", cid).order("pago_em", { ascending: false }).limit(3), "pagamentos"),
    q(supabase.from("condominios").select("nome_fantasia, cnpj, endereco, identidade_visual, regras_internas").eq("id", cid), "condominios"),
  ]);

  /* dados do próprio condomínio (cabeçalho do portal, documento timbrado) */
  const condRow = condRows?.[0] || {};
  const cond = {
    nome: condRow.nome_fantasia || "—", cnpj: condRow.cnpj || "",
    endereco: condRow.endereco?.texto || "",
    logoUrl: condRow.identidade_visual?.logo_url || null,
    cor: condRow.identidade_visual?.cor_primaria || null,
    sindico: condRow.regras_internas?.gestao?.sindico || "",
    moeda: condRow.regras_internas?.moeda || "USD",
    pagamentos: (() => {
      const pg = condRow.regras_internas?.pagamentos || {};
      return {
        verumWallet: pg.verum_wallet || pg.cripto || "", // pg.cripto: formato antigo (texto livre)
        dinheiro: pg.dinheiro !== false, // padrão: aceita dinheiro
        banco: { ...(pg.banco || {}), obs: pg.banco?.obs || pg.transferencia || "" },
      };
    })(),
  };

  const uLabel = (u) => (u ? `${u.numero}-${u.blocos?.nome || "?"}` : "—");
  const unidadeById = Object.fromEntries(unidadesRaw.map((u) => [u.id, u]));

  /* unidades */
  const cobrPorUnidade = {};
  cobrRaw.forEach((c) => {
    if (c.status === "vencida") cobrPorUnidade[c.unidade_id] = (cobrPorUnidade[c.unidade_id] || 0) + num(c.valor_original) + num(c.encargos);
  });
  const unidades = unidadesRaw.map((u) => ({
    id: u.id, num: u.numero, bloco: u.blocos?.nome || "?", andar: u.andar,
    tipo: UNIDADE_TIPO_LABEL[u.tipo] || u.tipo, tipoRaw: u.tipo, status: u.status,
    fracao: num(u.fracao_ideal), area: num(u.area_privativa_m2), resp: u.pessoas?.nome || "—",
    respId: u.responsavel_financeiro_id || "",
    vagas: vagas.filter((v) => v.unidade_id === u.id).length,
    saldo: -(cobrPorUnidade[u.id] || 0),
  }));

  /* pessoas */
  const pessoas = pessoasRaw.map((p) => {
    const vs = vinculos.filter((v) => v.pessoa_id === p.id)
      .sort((a, b) => PAPEL_PRIORIDADE.indexOf(a.papel) - PAPEL_PRIORIDADE.indexOf(b.papel));
    const v = vs[0];
    return {
      id: p.id, nome: p.nome, papel: v ? PAPEL_LABEL[v.papel] : "—",
      unidade: v?.unidade_id ? uLabel(unidadeById[v.unidade_id]) : "—", unidadeId: v?.unidade_id || null,
      doc: maskDoc(p.cpf_cnpj), tel: p.telefone || "—", status: "ativo",
      documentoUrl: p.documento_url || null,
      /* valores crus para o formulário de edição */
      docRaw: p.cpf_cnpj, telRaw: p.telefone || "", email: p.email || "",
      inicio: v?.inicio || "", vinculoId: v?.id || null,
    };
  });

  /* lançamentos */
  const lanc = lancRaw.map((l) => ({
    id: l.id, data: ddmm(l.data), tipo: l.tipo, cat: l.categorias_financeiras?.nome || "—",
    desc: l.descricao, valor: num(l.valor), status: LANC_STATUS_UI[l.status] || l.status,
    forma: FORMA_LABEL[l.forma_pagamento] || "—", competencia: l.competencia,
    nf: l.nota_fiscal_url || null,
  }));

  /* cobranças */
  const cobr = cobrRaw.map((c) => ({
    id: c.id, comp: compBR(c.competencia), unidade: uLabel(c.unidades),
    resp: primeiroNome(c.pessoas?.nome), respId: c.responsavel_id || null, valor: num(c.valor_original),
    venc: ddmm(c.vencimento), vencFull: ddmmyyyy(c.vencimento),
    status: COBR_STATUS_UI[c.status] || c.status, tx: c.provider_charge_id || "—",
    unidadeId: c.unidade_id, competencia: c.competencia,
  }));

  /* multas — ciclo: pendente (síndico) → aprovada (aguardando envio) →
     entregue → encerrada (advertência) | paga/vencida (multa, pela cobrança) */
  const hojeISO = new Date().toISOString().slice(0, 10);
  const multas = multasRaw.map((m) => {
    const anteriores = multasRaw.filter((x) => x.id !== m.id && x.unidade_id === m.unidade_id && x.ocorrida_em < m.ocorrida_em).length;
    const cobrancaM = m.cobranca_id ? cobrRaw.find((c) => c.id === m.cobranca_id) : null;
    let statusUI;
    if (m.status === "cancelada") statusUI = "cancelada";
    else if (m.status === "registrada" || m.status === "em_defesa") statusUI = "pendente";
    else if (!m.entregue_em) statusUI = "aprovada_envio";
    else if (m.tipo === "advertencia") statusUI = "encerrada";
    else if (cobrancaM && (cobrancaM.status === "paga" || cobrancaM.status === "paga_em_atraso")) statusUI = "paga";
    else if (cobrancaM && (cobrancaM.status === "vencida" || cobrancaM.vencimento < hojeISO)) statusUI = "vencida";
    else statusUI = "entregue";
    return {
      id: m.id, num: m.numero, unidade: uLabel(m.unidades), unidadeId: m.unidade_id, infrator: m.pessoas?.nome || "Não identificado",
      categoria: m.categoria_infracao, data: ddmmyyyy(m.ocorrida_em), valor: num(m.valor),
      status: statusUI, prazo: m.prazo_defesa && statusUI === "pendente" ? ddmm(m.prazo_defesa) : "—",
      prazoISO: m.prazo_defesa || null, entregueEm: m.entregue_em ? ddmmyyyy(m.entregue_em) : null,
      reincidencia: anteriores, base: m.base_normativa, descricao: m.descricao,
      provas: (m.penalidade_provas || []).map((p) => ({ id: p.id, tipo: p.tipo, url: p.arquivo_url })),
    };
  });

  /* comunicados */
  const comunic = comunicRaw.map((c) => {
    const d = c.comunicado_destinatarios || [];
    const CANAL = { portal: "Portal", email: "E-mail", whatsapp: "WhatsApp" };
    return {
      id: c.id, tipo: COMUNIC_TIPO_LABEL[c.tipo] || c.tipo, titulo: c.titulo, corpo: c.corpo,
      data: ddmmyyyy(c.publicado_em || c.criado_em),
      canal: (c.canais || []).map((x) => CANAL[x] || x).join(" + ") || "Portal",
      leitura: d.length ? Math.round((d.filter((x) => x.lido_em).length / d.length) * 100) : 0,
      publico: c.segmento?.descricao || "Todas as unidades",
      pdfUrl: c.segmento?.pdf_url || null, // PDF timbrado arquivado no módulo Documentos
    };
  });

  /* chamados */
  const chamados = chamadosRaw.map((c) => ({
    id: c.id, num: c.numero, cat: CHAMADO_CAT_LABEL[c.categoria] || c.categoria, desc: c.descricao,
    prio: c.prioridade, status: c.status,
    unidade: c.unidades ? uLabel(c.unidades) : null, // preenchida quando o chamado veio do portal do morador
    resp: primeiroNome(c.pessoa_vinculos?.pessoas?.nome) || "—",
    aberto: ddmm(c.criado_em), custo: num(c.custo_realizado) || num(c.custo_estimado),
    midias: Array.isArray(c.midias) ? c.midias : [],
    /* detalhes/gestão */
    respId: c.responsavel_vinculo_id || "", prazo: c.prazo || "",
    custoEstimado: num(c.custo_estimado), custoRealizado: num(c.custo_realizado),
    abertoFull: ddmmyyyy(c.criado_em), fechado: c.fechado_em ? ddmmyyyy(c.fechado_em) : null,
  }));

  /* acessos */
  const acessos = acessosRaw.map((a) => ({
    id: a.id, hora: a.ocorrido_em ? a.ocorrido_em.slice(11, 16) : "—", data: ddmm(a.ocorrido_em),
    nome: a.pessoa_nome, destino: a.unidades ? uLabel(a.unidades) : (a.detalhes || "—"),
    tipo: ACESSO_UI[a.tipo]?.tipo || "visitante", via: a.detalhes || "Portaria",
    status: ACESSO_UI[a.tipo]?.status || a.tipo,
  }));

  /* documentos */
  const docs = docsRaw.map((d) => ({
    id: d.id, nome: d.titulo, tipo: DOC_TIPO_LABEL[d.tipo] || d.tipo,
    data: ddmmyyyy(d.criado_em), envios: d.unidades ? `Unidade ${uLabel(d.unidades)}` : "Portal",
    url: d.arquivo_url,
  }));

  /* tenants (painel SaaS) */
  const tenants = tenantsRaw.map((t) => {
    const a = (t.saas_assinaturas || [])[0];
    const st = a?.status === "ativa" ? "ativo" : a?.status || "teste";
    return {
      id: t.id, nome: t.nome_fantasia, plano: a?.saas_planos?.nome || "—",
      unidades: t.unidades?.[0]?.count ?? 0, status: st,
      mrr: st === "teste" ? 0 : num(a?.saas_planos?.preco_mensal),
      precoPlano: num(a?.saas_planos?.preco_mensal),
      precoPlanoAnual: num(a?.saas_planos?.preco_anual),
      venc: a?.renovacao ? ddmm(a.renovacao) : "—",
    };
  });

  /* boletos do morador (demo: unidade 102) */
  const unidMorador = unidadesRaw.find((u) => u.numero === "102") || unidadesRaw[0];
  const boletos = cobr.filter((c) => c.unidadeId === unidMorador?.id)
    .map((c) => ({ id: c.id, comp: c.comp, desc: "Taxa condominial", valor: c.valor, venc: c.vencFull, status: c.status }));

  /* gráficos */
  const porComp = {};
  lancRaw.forEach((l) => {
    if (l.status === "cancelado" || l.status === "rejeitado") return;
    const c = (porComp[l.competencia] ||= { receita: 0, despesa: 0 });
    c[l.tipo] += num(l.valor);
  });
  const comps = Object.keys(porComp).sort().slice(-6);
  const fluxo = comps.map((c) => ({ m: mesLabel(c), receita: porComp[c].receita, despesa: porComp[c].despesa }));
  const compAtual = comps[comps.length - 1];

  /* evolução diária: um ponto para cada dia, agrupado por mês (chave AAAA-MM).
     O mês corrente sempre existe no mapa, mesmo sem lançamentos. */
  const hoje = new Date();
  const mesAtualReal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const porDiaMes = {};
  lancRaw.forEach((l) => {
    if (l.status === "cancelado" || l.status === "rejeitado") return;
    if (!l.data) return;
    const d = ((porDiaMes[l.data.slice(0, 7)] ||= {})[l.data.slice(8, 10)] ||= { receita: 0, despesa: 0 });
    d[l.tipo] += num(l.valor);
  });
  porDiaMes[mesAtualReal] ||= {};
  const fluxoDiarioPorMes = Object.fromEntries(Object.keys(porDiaMes).sort().map((mes) => {
    const diasNoMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
    return [mes, Array.from({ length: diasNoMes }, (_, i) => {
      const dia = String(i + 1).padStart(2, "0");
      return { m: dia, receita: porDiaMes[mes][dia]?.receita || 0, despesa: porDiaMes[mes][dia]?.despesa || 0 };
    })];
  }));

  /* despesas e receitas por categoria, agrupadas por competência (AAAA-MM).
     O mês corrente sempre existe no mapa, mesmo sem lançamentos. */
  const catPorMes = {};
  lancRaw.forEach((l) => {
    if (l.status === "cancelado" || l.status === "rejeitado" || !l.competencia) return;
    const m = (catPorMes[l.competencia] ||= { despesa: {}, receita: {} });
    const nome = l.categorias_financeiras?.nome || "Outros";
    m[l.tipo][nome] = (m[l.tipo][nome] || 0) + num(l.valor);
  });
  catPorMes[mesAtualReal] ||= { despesa: {}, receita: {} };
  const despesasPorMes = {}, pieReceitasPorMes = {};
  Object.keys(catPorMes).forEach((mes) => {
    despesasPorMes[mes] = Object.entries(catPorMes[mes].despesa).map(([cat, v]) => ({ cat, v })).sort((a, b) => b.v - a.v);
    const totalRec = Object.values(catPorMes[mes].receita).reduce((s, v) => s + v, 0) || 1;
    pieReceitasPorMes[mes] = Object.entries(catPorMes[mes].receita).map(([name, v]) => ({ name, value: Math.round((v / totalRec) * 100) }));
  });

  const cobrPorComp = {};
  cobrRaw.forEach((c) => {
    const b = (cobrPorComp[c.competencia] ||= { total: 0, vencido: 0 });
    b.total += num(c.valor_original);
    if (c.status === "vencida") b.vencido += num(c.valor_original);
  });
  const inadim = Object.keys(cobrPorComp).sort().slice(-6)
    .map((c) => ({ m: mesLabel(c), pct: Math.round((cobrPorComp[c].vencido / (cobrPorComp[c].total || 1)) * 1000) / 10 }));

  /* indicadores */
  const soma = (arr, f) => arr.reduce((s, x) => s + (f(x) ? num(x.valor) : 0), 0);
  const fluxoAtual = porComp[compAtual] || { receita: 0, despesa: 0 };
  const pagoTotal = lancRaw.reduce((s, l) => s + (l.status === "pago" ? (l.tipo === "receita" ? num(l.valor) : -num(l.valor)) : 0), 0);
  const cobrAtual = cobrRaw.filter((c) => c.competencia === compAtual);
  const fundoDe = (n) => num(fundos.find((f) => f.nome.toLowerCase().includes(n))?.saldo);

  const stats = {
    saldo: pagoTotal, receitaMes: fluxoAtual.receita, despesaMes: fluxoAtual.despesa,
    inadimplencia: inadim.length ? inadim[inadim.length - 1].pct : 0,
    aReceber: soma(lancRaw, (l) => l.tipo === "receita" && l.competencia === compAtual && l.status !== "pago"),
    aPagar: soma(lancRaw, (l) => l.tipo === "despesa" && l.competencia === compAtual && l.status !== "pago"),
    fundoReserva: fundoDe("reserva"), fundoObras: fundoDe("obra"),
    cobrEmitidas: cobrAtual.length,
    cobrPagas: cobrAtual.filter((c) => c.status === "paga" || c.status === "paga_em_atraso").length,
    cobrAguardando: cobrAtual.filter((c) => c.status === "emitida" || c.status === "rascunho").length,
    cobrVencidasValor: cobrAtual.reduce((s, c) => s + (c.status === "vencida" ? num(c.valor_original) : 0), 0),
    multasAno: multasRaw.length,
    multasEmDefesa: multasRaw.filter((m) => m.status === "em_defesa" || m.status === "registrada").length,
    multasArrecadado: multasRaw.reduce((s, m) => s + (m.status === "aprovada" || m.status === "lancada" ? num(m.valor) : 0), 0),
    mrr: tenants.reduce((s, t) => s + t.mrr, 0),
    tenantsAtivos: tenants.filter((t) => t.status === "ativo").length,
    tenantsTeste: tenants.filter((t) => t.status === "teste").length,
    tenantsInadimplentes: tenants.filter((t) => t.status === "inadimplente" || t.status === "bloqueada").length,
    acessosHoje: acessos.length,
    visitantesDentro: acessos.filter((a) => a.status === "dentro").length,
    encomendas: acessos.filter((a) => a.tipo === "entrega").length,
    vagasVisitante: `${vagas.filter((v) => v.tipo === "visitante" && v.status === "livre").length}/${vagas.filter((v) => v.tipo === "visitante").length}`,
    competencia: compAtual ? compBR(compAtual) : "—",
  };

  /* atividades recentes — todas, ordenadas da mais nova para a mais antiga;
     [texto, quando, tela de destino] para o clique navegar */
  const atividades = [
    ...pagamentosRaw.map((p) => [`Pagamento confirmado — ${uLabel(p.cobrancas?.unidades)} · ${fmtMoeda(num(p.valor_pago), cond.moeda)}`, p.pago_em, "cobrancas"]),
    ...comunicRaw.map((c) => [`Comunicado "${c.titulo}" publicado`, c.publicado_em || c.criado_em, "comunicados"]),
    ...chamadosRaw.map((c) => [`Chamado ${c.numero} — ${c.descricao}`, c.criado_em, "chamados"]),
    ...multasRaw.map((m) => [`${m.tipo === "multa" ? "Multa" : "Advertência"} ${m.numero} — ${m.categoria_infracao}`, m.criado_em, "multas"]),
    ...acessosRaw.map((a) => [`Portaria: ${a.pessoa_nome}`, a.ocorrido_em, "portaria"]),
  ].sort((a, b) => (b[1] || "").localeCompare(a[1] || ""))
   .map(([txt, iso, tela]) => [txt, ddmm(iso), tela]);

  /* contexto para escritas */
  const ctx = {
    condominioId: cid, condominioNome: principal.nome_fantasia, moeda: cond.moeda,
    usuarioId: usuarios[0]?.usuario_id || null,
    blocos, categorias,
    unidades: unidadesRaw.map((u) => {
      /* labelResp: unidade + responsável financeiro — usado nos dropdowns de unidade */
      const respNome = pessoasRaw.find((p) => p.id === u.responsavel_financeiro_id)?.nome || "";
      return {
        id: u.id, label: uLabel(u), labelResp: uLabel(u) + (respNome ? ` — ${respNome}` : ""),
        responsavelId: u.responsavel_financeiro_id, fracao: num(u.fracao_ideal),
        bloco: u.blocos?.nome || "", tipo: u.tipo, andar: u.andar,
      };
    }),
    /* nome + unidade + papel — todo select de pessoas usa `label` para exibição.
       papel = vínculo de maior prioridade; unidade = primeiro vínculo que tem uma */
    pessoas: pessoasRaw.map((p) => {
      const vs = vinculos.filter((x) => x.pessoa_id === p.id)
        .sort((a, b) => PAPEL_PRIORIDADE.indexOf(a.papel) - PAPEL_PRIORIDADE.indexOf(b.papel));
      const papel = vs[0] ? PAPEL_LABEL[vs[0].papel] : "";
      const vUni = vs.find((x) => x.unidade_id);
      const unidade = vUni ? uLabel(unidadeById[vUni.unidade_id]) : "";
      return {
        id: p.id, nome: p.nome, unidadeId: vUni?.unidade_id || null, unidade, papel,
        label: p.nome + (unidade ? ` — ${unidade}` : "") + (papel ? ` · ${papel}` : ""),
      };
    }),
    /* segmentos reais para os destinatários de comunicados */
    tiposUnidade: [...new Set(unidadesRaw.map((u) => u.tipo))],
    andares: [...new Set(unidadesRaw.map((u) => u.andar).filter((a) => a != null))].sort((a, b) => a - b),
    unidadesVencidas: new Set(cobrRaw.filter((c) => c.status === "vencida").map((c) => c.unidade_id)),
    operacionais: vinculos.filter((v) => v.papel === "funcionario" || v.papel === "prestador")
      .map((v) => ({ id: v.id, label: `${pessoasRaw.find((p) => p.id === v.pessoa_id)?.nome} (${PAPEL_LABEL[v.papel].toLowerCase()})` })),
    maxOS: Math.max(0, ...chamadosRaw.map((c) => Number((c.numero || "").replace(/\D/g, "")) || 0)),
    maxPenalidade: Math.max(0, ...multasRaw.map((m) => Number((m.numero || "").split("-")[1]) || 0)),
  };

  return { ctx, cond, unidades, pessoas, lanc, cobr, multas, comunic, chamados, acessos, docs, tenants, boletos, fluxo, fluxoDiarioPorMes, mesAtualReal, despesasPorMes, inadim, pieReceitasPorMes, stats, atividades };
}

/* ─────────── escritas ─────────── */

/* Primeiro acesso: o backend cria o condomínio DA CONTA LOGADA (condomínio,
   pessoa, vínculo, perfil e assinatura em teste) e devolve o token novo já
   carimbado com o condominio_id — o RLS passa a liberar só esse prédio. */
export async function criarCondominio(f) {
  const r = await chamarAuth("condominio", f);
  setAuthToken(r.token);
  return { id: r.condominioId, token: r.token };
}

/* Planos ativos do SaaS — usados no cadastro para a escolha da licença */
export async function listarPlanos() {
  const { data } = await supabase.from("saas_planos").select("nome, preco_mensal, preco_anual, limite_unidades").eq("ativo", true).order("preco_mensal");
  return data || [];
}

/* Cadastro do diretor na tela de login: o backend grava a conta na tabela
   usuarios e devolve o token de acesso (a conta nasce sem condomínio; o
   prédio dela é criado no passo seguinte). */
export async function registrarDiretor({ nome, email, senha }) {
  const r = await chamarAuth("registrar", { nome, email, senha });
  setAuthToken(r.token);
  return { ...r.conta, token: r.token };
}

/* ─────────── acessos (Gerenciar Acessos) — gravados na tabela usuarios ─────────── */

/* e-mail sintético para morador, que entra pelo nome e não tem e-mail próprio */
const emailMorador = (nome, condominioId) =>
  `morador+${nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".")}@${condominioId.slice(0, 8)}.local`;

/* Cria um acesso (sindico, tesouraria ou morador):
   pessoa + usuário (senha com hash) + perfil; morador ganha também o
   vínculo com a unidade. */
export async function criarAcesso(ctx, f) {
  const ehMorador = f.perfil === "morador";
  const nome = ehMorador ? f.nome.trim() : (f.email.trim().toLowerCase().split("@")[0]);
  const email = ehMorador ? emailMorador(f.nome.trim(), ctx.condominioId) : f.email.trim().toLowerCase();

  const { data: dup } = await supabase.from("usuarios").select("id").eq("email", email).maybeSingle();
  if (dup) throw new Error(ehMorador ? "Já existe um morador cadastrado com este nome." : "Já existe um acesso cadastrado com este e-mail.");

  const [pessoa] = await q(supabase.from("pessoas").insert({
    condominio_id: ctx.condominioId, nome: ehMorador ? f.nome.trim() : nome,
    tipo_pessoa: "fisica", cpf_cnpj: `P-${crypto.randomUUID().slice(0, 12)}`,
    email: ehMorador ? null : email,
  }).select(), "pessoas");
  const [usuario] = await q(supabase.from("usuarios").insert({
    pessoa_id: pessoa.id, email, senha_hash: await sha256(f.senha),
  }).select(), "usuarios");
  const perfil = await q(supabase.from("perfis").select("id").eq("nome", f.perfil).single(), "perfis");
  await q(supabase.from("usuario_perfis").insert({
    usuario_id: usuario.id, condominio_id: ctx.condominioId, perfil_id: perfil.id,
  }).select(), "usuario_perfis");
  /* o perfil escolhido vira o papel da pessoa no condomínio (lista Pessoas);
     morador ganha também o vínculo com a unidade */
  const un = ehMorador ? ctx.unidades.find((u) => u.label === f.unidade || u.id === f.unidade) : null;
  await q(supabase.from("pessoa_vinculos").insert({
    condominio_id: ctx.condominioId, pessoa_id: pessoa.id, unidade_id: un?.id || null,
    papel: f.perfil, inicio: new Date().toISOString().slice(0, 10),
  }).select(), "pessoa_vinculos");
  /* morador vinculado à unidade vira o responsável financeiro dela automaticamente */
  if (un) await salvarResponsavelUnidade(ctx, un.id, pessoa.id);
  return { id: usuario.id };
}

/* Lista os acessos do condomínio (todos os perfis, exceto o diretor). */
export async function listarAcessos(ctx) {
  const rows = await q(supabase.from("usuario_perfis")
    .select("perfis(nome), usuarios(id, email, pessoas(nome, pessoa_vinculos(papel, unidades(numero, blocos(nome)))))")
    .eq("condominio_id", ctx.condominioId), "usuario_perfis");
  return rows
    .filter((r) => r.perfis?.nome && r.perfis.nome !== "diretor" && r.usuarios)
    .map((r) => {
      const u = r.usuarios, p = u.pessoas;
      const vinc = (p?.pessoa_vinculos || []).find((v) => v.papel === "morador");
      const unidade = vinc?.unidades ? `${vinc.unidades.numero}-${vinc.unidades.blocos?.nome || "?"}` : null;
      return {
        id: u.id, role: r.perfis.nome, nome: p?.nome || null,
        email: u.email.endsWith(".local") ? null : u.email, unidade,
      };
    });
}

/* Remove um acesso: usuário, perfis e vínculos (a pessoa some junto se
   não estiver referenciada em outra tabela). */
export async function removerAcesso(usuarioId) {
  const { data: u } = await supabase.from("usuarios").select("pessoa_id").eq("id", usuarioId).maybeSingle();
  await supabase.from("usuario_perfis").delete().eq("usuario_id", usuarioId);
  await q(supabase.from("usuarios").delete().eq("id", usuarioId), "usuarios");
  if (u?.pessoa_id) {
    await supabase.from("pessoa_vinculos").delete().eq("pessoa_id", u.pessoa_id);
    await supabase.from("pessoas").delete().eq("id", u.pessoa_id).then(() => {}, () => {});
  }
}

/* Login dos demais perfis. Morador entra pelo nome; os outros, pelo e-mail.
   Retorna null quando não confere. */
export async function loginUsuario(role, { email, nome, senha }) {
  try {
    const r = await chamarAuth("login", { perfil: role, email, nome, senha });
    setAuthToken(r.token);
    return { ...r.conta, token: r.token };
  } catch (e) {
    if (e.status === 401) return null;
    throw e;
  }
}

/* "Já tem prédio cadastrado": confere e-mail e senha na tabela usuarios
   e exige que a conta tenha o perfil de diretor em algum condomínio. */
export async function loginDiretor(email, senha) {
  try {
    const r = await chamarAuth("login", { perfil: "diretor", email, senha });
    setAuthToken(r.token);
    return { ...r.conta, senha, token: r.token };
  } catch (e) {
    if (e.status === 401) return null; // credenciais erradas
    throw e;
  }
}

/* O Commet é usado SOMENTE para a licença SaaS (plano do condomínio).
   As cobranças condominiais são pagas pelos meios cadastrados no condomínio
   (carteira Verum Wallet / transferência bancária) — sem gateway. */

/* Licença SaaS: pede ao backend (/api/commet/assinatura) o checkout da
   assinatura recorrente da licença do CondoMaster para um condomínio.
   ciclo: "mensal" ou "anual" — a cobrança é sempre em dólar (USD). */
export async function assinarLicencaCommet(condominioId, ciclo = "mensal", troca = false) {
  let r;
  try {
    r = await fetch("/api/commet/assinatura", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condominioId, ciclo, troca }),
    });
  } catch {
    throw new Error("Não foi possível falar com o backend de pagamentos.");
  }
  let corpo = null; try { corpo = await r.json(); } catch { /* sem JSON */ }
  if (!r.ok) throw new Error(corpo?.error || (r.status === 404
    ? "Backend de pagamentos ainda não publicado — as funções /api sobem no deploy (Vercel/Netlify), não no npm run dev."
    : `Erro ${r.status} ao criar a assinatura.`));
  /* { checkoutUrl } na contratação; na troca de plano pode vir sem checkout
     (trocaAplicada / agendadaPara) quando o Commet aplica direto na assinatura */
  return corpo;
}

/* Upgrade/downgrade: troca o plano da assinatura no banco (via backend).
   Depois da troca, o pagamento é feito pelo checkout de assinarLicencaCommet. */
export async function trocarPlanoLicenca(condominioId, plano) {
  let r;
  try {
    r = await fetch("/api/commet/plano", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condominioId, plano }),
    });
  } catch {
    throw new Error("Não foi possível falar com o backend de pagamentos.");
  }
  let corpo = null; try { corpo = await r.json(); } catch { /* sem JSON */ }
  if (!r.ok) throw new Error(corpo?.error || (r.status === 404
    ? "Backend de pagamentos ainda não publicado — as funções /api sobem no deploy (Vercel/Netlify), não no npm run dev."
    : `Erro ${r.status} ao trocar o plano.`));
  return corpo;
}

/* Confere no Commet (via backend) se a licença foi paga e sincroniza o
   status no banco. Retorna true quando a assinatura está ativa. */
export async function verificarLicencaCommet(condominioId) {
  try {
    const r = await fetch("/api/commet/licenca", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condominioId }),
    });
    const corpo = await r.json().catch(() => null);
    return Boolean(r.ok && corpo?.ativa);
  } catch { return false; }
}

const precisaUsuario = (ctx) => {
  if (!ctx.usuarioId) throw new Error("Nenhum usuário cadastrado no banco (rode o seed).");
  return ctx.usuarioId;
};

/* Cria uma unidade ou um intervalo delas (f.numero até f.numeroAte, ex.: 1 a 100).
   Números que já existem no bloco são pulados. Retorna quantas foram criadas. */
export async function criarUnidade(ctx, f) {
  const nomeBloco = String(f.bloco || "").trim() || "A"; // bloco é opcional — vazio cai no bloco "A"
  let bloco = ctx.blocos.find((b) => b.nome.toLowerCase() === nomeBloco.toLowerCase());
  if (!bloco) bloco = (await q(supabase.from("blocos").insert({ condominio_id: ctx.condominioId, nome: nomeBloco }).select(), "blocos"))[0];

  /* decompõe o número em prefixo + dígitos + sufixo (ex.: "1D" → "", "1", "D") */
  const partes = (s) => String(s).trim().match(/^(\D*)(\d+)(\D*)$/);
  const ate = String(f.numeroAte || "").trim();
  const andarIni = String(f.andar ?? "").trim() ? parseInt(f.andar, 10) : null;
  const andarFim = String(f.andarAte ?? "").trim() ? parseInt(f.andarAte, 10) : null;

  let itens; // [{ numero, andar }]
  if (andarFim != null) {
    /* intervalo de andares: as unidades do intervalo são criadas EM CADA andar,
       numeradas como andar + sequência (andares 1 a 12, unidades 1 a 4 →
       101…104, 201…204 … 1201…1204), cada uma já com o próprio andar */
    if (andarIni == null) throw new Error("Informe o andar inicial do intervalo (ex.: 1 até 12).");
    if (andarFim < andarIni) throw new Error("O andar final deve ser maior ou igual ao inicial.");
    const m1 = partes(f.numero);
    const m2 = ate ? partes(ate) : m1;
    if (!m1 || !m2) throw new Error("Para criar por andares, use números nas unidades (ex.: 1 até 4).");
    const [, prefixo, n1, sufixo] = m1;
    if ((m2[1] && m2[1] !== prefixo) || (m2[3] && m2[3] !== sufixo))
      throw new Error("As letras do início e do fim do intervalo devem ser iguais (ex.: 1D até 4D).");
    const ini = parseInt(n1, 10), fim = parseInt(m2[2], 10);
    if (fim < ini) throw new Error("O número final deve ser maior ou igual ao inicial.");
    const pad = Math.max(2, n1.startsWith("0") ? n1.length : 0); // 1º andar + unidade 1 → 101
    itens = [];
    for (let a = andarIni; a <= andarFim; a++)
      for (let n = ini; n <= fim; n++)
        itens.push({ numero: `${prefixo}${a}${String(n).padStart(pad, "0")}${sufixo}`, andar: a });
  } else {
    let numeros = [String(f.numero).trim()];
    if (ate) {
      /* aceita letras junto com o número (ex.: 1D até 4D → 1D, 2D, 3D, 4D; ou A1 até A10) */
      const m1 = partes(f.numero);
      const m2 = partes(ate);
      if (!m1 || !m2) throw new Error("Para criar um intervalo, use um número com ou sem letras (ex.: 1 até 100, ou 1D até 4D).");
      const [, prefixo, n1, sufixo] = m1;
      const [, p2, n2, s2] = m2;
      if ((p2 && p2 !== prefixo) || (s2 && s2 !== sufixo))
        throw new Error("As letras do início e do fim do intervalo devem ser iguais (ex.: 1D até 4D).");
      const ini = parseInt(n1, 10), fim = parseInt(n2, 10);
      if (fim < ini) throw new Error("O número final deve ser maior ou igual ao inicial.");
      const pad = n1.startsWith("0") ? n1.length : 0; // preserva zeros à esquerda (ex.: 001 a 010)
      numeros = Array.from({ length: fim - ini + 1 }, (_, i) => `${prefixo}${String(ini + i).padStart(pad, "0")}${sufixo}`);
    }
    itens = numeros.map((numero) => ({ numero, andar: andarIni }));
  }
  if (itens.length > 500) throw new Error("Máximo de 500 unidades por vez.");

  const jaExistem = await q(
    supabase.from("unidades").select("numero").eq("condominio_id", ctx.condominioId).eq("bloco_id", bloco.id).in("numero", itens.map((i) => i.numero)),
    "unidades"
  );
  const existentes = new Set(jaExistem.map((u) => u.numero));
  const novos = itens.filter((i) => !existentes.has(i.numero));
  if (!novos.length) throw new Error(itens.length === 1
    ? `A unidade ${itens[0].numero} já existe neste bloco.`
    : "Todas as unidades desse intervalo já existem neste bloco.");

  const base = {
    condominio_id: ctx.condominioId, bloco_id: bloco.id,
    tipo: UNIDADE_TIPO_ENUM[f.tipo] || "apartamento",
    status: UNIDADE_STATUS_ENUM[f.status] || "vaga",
    area_privativa_m2: parseBRL(f.area) || null,
    fracao_ideal: 0, // recalculada logo abaixo a partir da área privativa
  };
  await q(supabase.from("unidades").insert(novos.map(({ numero, andar }) => ({ ...base, numero, andar }))).select(), "unidades");
  await recalcularFracoes(ctx);
  return novos.length;
}

/* Fração ideal (Lei 4.591 / NBR 12721): área privativa da unidade ÷ área
   privativa total do edifício — é a proporção de rateio das despesas comuns.
   Recalculada para TODAS as unidades sempre que uma unidade é criada ou tem a
   área alterada (o total do prédio muda). Unidade sem área informada entra com
   a média das áreas conhecidas; se nenhuma tiver área, o rateio fica igualitário. */
export async function recalcularFracoes(ctx) {
  const unidades = await q(supabase.from("unidades").select("id, area_privativa_m2")
    .eq("condominio_id", ctx.condominioId).is("deletado_em", null), "unidades");
  if (!unidades.length) return;
  const areas = unidades.map((u) => num(u.area_privativa_m2)).filter((a) => a > 0);
  const media = areas.length ? areas.reduce((s, a) => s + a, 0) / areas.length : 1;
  const peso = (u) => (num(u.area_privativa_m2) > 0 ? num(u.area_privativa_m2) : media);
  const totalPeso = unidades.reduce((s, u) => s + peso(u), 0);
  await Promise.all(unidades.map((u) =>
    q(supabase.from("unidades").update({ fracao_ideal: Math.round((peso(u) / totalPeso) * 100 * 1e6) / 1e6 })
      .eq("id", u.id).select(), "unidades")));
}

/* Edição completa da unidade (modal da tela Unidades — exclusiva do diretor).
   f.tipo e f.status chegam como valores do enum; bloco novo é criado se não existir. */
export async function atualizarUnidade(ctx, id, f) {
  const numero = String(f.numero || "").trim();
  if (!numero) throw new Error("Informe o número da unidade.");
  let bloco = ctx.blocos.find((b) => b.nome.toLowerCase() === String(f.bloco || "").trim().toLowerCase());
  if (!bloco && String(f.bloco || "").trim())
    bloco = (await q(supabase.from("blocos").insert({ condominio_id: ctx.condominioId, nome: String(f.bloco).trim() }).select(), "blocos"))[0];
  const patch = {
    numero, tipo: f.tipo, status: f.status,
    andar: f.andar === "" || f.andar == null ? null : Number(f.andar),
    area_privativa_m2: parseBRL(f.area) || null,
    responsavel_financeiro_id: f.responsavel || null,
  };
  if (bloco) patch.bloco_id = bloco.id;
  await q(supabase.from("unidades").update(patch).eq("id", id).select(), "unidades");
  await recalcularFracoes(ctx); // a área pode ter mudado — refaz as frações do prédio
}

/* Altera o responsável financeiro da unidade (modal da tela Unidades) */
export async function salvarResponsavelUnidade(ctx, unidadeId, pessoaId) {
  await q(supabase.from("unidades").update({ responsavel_financeiro_id: pessoaId || null })
    .eq("id", unidadeId).select(), "unidades");
}

/* Exclusão da unidade (modal da tela Unidades — exclusiva do diretor).
   Soft delete: marca deletado_em em vez de apagar, preservando o histórico de
   cobranças, multas e vínculos. Depois refaz as frações ideais do prédio,
   que passam a ser rateadas sem a unidade excluída. */
export async function excluirUnidade(ctx, id) {
  const abertas = await q(supabase.from("cobrancas").select("id").eq("unidade_id", id)
    .in("status", ["rascunho", "emitida", "vencida", "pagamento_divergente"]).limit(1), "cobrancas");
  if (abertas.length) throw new Error("Não é possível excluir: esta unidade tem cobranças em aberto. Quite ou cancele as cobranças antes.");
  await q(supabase.from("unidades").update({ deletado_em: new Date().toISOString(), responsavel_financeiro_id: null })
    .eq("id", id).select(), "unidades");
  await recalcularFracoes(ctx);
}

/* Altera a área privativa de uma unidade e refaz as frações do prédio todo */
export async function salvarAreaUnidade(ctx, unidadeId, area) {
  await q(supabase.from("unidades").update({ area_privativa_m2: parseBRL(area) || null })
    .eq("id", unidadeId).select(), "unidades");
  await recalcularFracoes(ctx);
}

/* ─────────── uploads (bucket "documentos") ───────────
   Os arquivos vão para <condominio_id>/<pasta>/<uuid>.<ext> — o prefixo com o
   condominio_id é o que a política de RLS do storage confere. */
const arquivosDe = (v) => (Array.isArray(v) ? v : v ? [v] : [])
  .filter((a) => a && typeof a === "object" && a.size > 0); // input vazio chega como File de 0 bytes
const provaTipo = (mime) => mime?.startsWith("image/") ? "foto"
  : mime?.startsWith("video/") ? "video" : mime?.startsWith("audio/") ? "audio" : "documento";

async function uploadArquivo(ctx, arquivo, pasta) {
  const ext = (arquivo.name?.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const caminho = `${ctx.condominioId}/${pasta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("documentos").upload(caminho, arquivo, { contentType: arquivo.type || undefined });
  if (error) throw new Error(`upload de "${arquivo.name}": ${error.message}`);
  const hashBuf = await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer());
  return {
    url: supabase.storage.from("documentos").getPublicUrl(caminho).data.publicUrl,
    nome: arquivo.name, mime: arquivo.type || "application/octet-stream",
    hash: Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

/* Aceita um File único ou lista (input multiple); devolve [{url, nome, mime, hash}] */
async function uploadArquivos(ctx, valor, pasta) {
  const out = [];
  for (const a of arquivosDe(valor)) out.push(await uploadArquivo(ctx, a, pasta));
  return out;
}

export async function criarPessoa(ctx, f) {
  const [doc] = await uploadArquivos(ctx, f.arquivo, "pessoas");
  const documentoUrl = doc?.url || null;
  const [p] = await q(supabase.from("pessoas").insert({
    condominio_id: ctx.condominioId, nome: f.nome,
    tipo_pessoa: String(f.doc || "").replace(/\D/g, "").length > 11 ? "juridica" : "fisica",
    cpf_cnpj: f.doc, telefone: f.tel || null, email: f.email || null,
    documento_url: documentoUrl,
  }).select(), "pessoas");
  await q(supabase.from("pessoa_vinculos").insert({
    condominio_id: ctx.condominioId, pessoa_id: p.id,
    unidade_id: f.unidade || null, papel: PAPEL_ENUM[f.papel] || "morador",
    inicio: f.inicio || new Date().toISOString().slice(0, 10),
  }).select(), "pessoa_vinculos");
  /* vincular a uma unidade torna a pessoa o responsável financeiro dela
     automaticamente (pode ser trocado depois, na tela Unidades) */
  if (f.unidade) await salvarResponsavelUnidade(ctx, f.unidade, p.id);
}

/* Edição: atualiza o cadastro e o vínculo principal (papel/unidade/início).
   Documento novo substitui o anterior; sem arquivo, o atual é mantido. */
export async function atualizarPessoa(ctx, pessoa, f) {
  const [doc] = await uploadArquivos(ctx, f.arquivo, "pessoas");
  const upd = {
    nome: f.nome, tipo_pessoa: String(f.doc || "").replace(/\D/g, "").length > 11 ? "juridica" : "fisica",
    cpf_cnpj: f.doc, telefone: f.tel || null, email: f.email || null,
  };
  if (doc) upd.documento_url = doc.url;
  await q(supabase.from("pessoas").update(upd).eq("id", pessoa.id).select(), "pessoas");
  const dados = { unidade_id: f.unidade || null, papel: PAPEL_ENUM[f.papel] || "morador" };
  if (f.inicio) dados.inicio = f.inicio;
  if (pessoa.vinculoId)
    await q(supabase.from("pessoa_vinculos").update(dados).eq("id", pessoa.vinculoId).select(), "pessoa_vinculos");
  else
    await q(supabase.from("pessoa_vinculos").insert({
      condominio_id: ctx.condominioId, pessoa_id: pessoa.id, ...dados,
      inicio: f.inicio || new Date().toISOString().slice(0, 10),
    }).select(), "pessoa_vinculos");
  /* nova unidade vinculada → a pessoa passa a ser o responsável financeiro dela */
  if (f.unidade && f.unidade !== pessoa.unidadeId)
    await salvarResponsavelUnidade(ctx, f.unidade, pessoa.id);
}

/* Exclusão: antes de apagar, confere onde a pessoa é referenciada e explica
   o impedimento — em vez de estourar um erro de chave estrangeira do banco. */
export async function removerPessoa(ctx, id) {
  const checagens = [
    [supabase.from("usuarios").select("id").eq("pessoa_id", id).limit(1), "possui conta de acesso — remova primeiro em Gerenciar Acessos"],
    [supabase.from("unidades").select("id").eq("responsavel_financeiro_id", id).limit(1), "é responsável financeiro de uma unidade"],
    [supabase.from("cobrancas").select("id").eq("responsavel_id", id).limit(1), "é responsável por cobranças emitidas"],
    [supabase.from("penalidades").select("id").eq("infrator_id", id).limit(1), "está registrada em multas/advertências"],
  ];
  for (const [consulta, motivo] of checagens) {
    const { data } = await consulta;
    if (data?.length) throw new Error(`Não é possível excluir: esta pessoa ${motivo}. O histórico precisa ser preservado.`);
  }
  const { error: eV } = await supabase.from("pessoa_vinculos").delete().eq("pessoa_id", id);
  if (eV) throw new Error(/foreign key|violates/i.test(eV.message)
    ? "Não é possível excluir: esta pessoa tem histórico vinculado (chamados ou outros registros)."
    : `vínculos: ${eV.message}`);
  const { error: eP } = await supabase.from("pessoas").delete().eq("id", id);
  if (eP) throw new Error(/foreign key|violates/i.test(eP.message)
    ? "Não é possível excluir: esta pessoa tem histórico vinculado no condomínio."
    : `pessoas: ${eP.message}`);
}

export async function criarLancamento(ctx, f) {
  const uid = precisaUsuario(ctx);
  const tipo = f.tipo === "Receita" ? "receita" : "despesa";
  let cat = ctx.categorias.find((c) => c.tipo === tipo && c.nome.toLowerCase() === String(f.categoria).toLowerCase());
  if (!cat) cat = (await q(supabase.from("categorias_financeiras").insert({ condominio_id: ctx.condominioId, nome: f.categoria, tipo }).select(), "categorias"))[0];
  const [nf] = await uploadArquivos(ctx, f.nota, "notas-fiscais");
  await q(supabase.from("lancamentos").insert({
    condominio_id: ctx.condominioId, tipo, categoria_id: cat.id,
    descricao: f.desc || f.categoria, valor: parseBRL(f.valor),
    data: f.data || new Date().toISOString().slice(0, 10),
    competencia: f.competencia || new Date().toISOString().slice(0, 7),
    centro_custo: f.centro || null, forma_pagamento: FORMA_ENUM[f.forma] || null,
    status: "aguardando_aprovacao", lancado_por: uid, nota_fiscal_url: nf?.url || null,
  }).select(), "lancamentos");
}

/* Aprovação do lançamento (aba Aprovação do Financeiro) — igual às multas:
   aprovado libera a conta para pagamento; rejeitado cancela o lançamento. */
export async function decidirLancamento(ctx, id, aprovar) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("lancamentos").update({
    status: aprovar ? "aprovado" : "rejeitado", aprovado_por: uid,
  }).eq("id", id).select(), "lancamentos");
}

/* Dar baixa numa conta a pagar (aba Contas a pagar do Financeiro) */
export async function marcarLancamentoPago(ctx, id) {
  await q(supabase.from("lancamentos").update({ status: "pago" }).eq("id", id).select(), "lancamentos");
}

export async function criarPenalidade(ctx, f) {
  const uid = precisaUsuario(ctx);
  const tipo = String(f.tipo || "").startsWith("Multa") ? "multa" : "advertencia";
  const ano = new Date().getFullYear();
  const provas = await uploadArquivos(ctx, f.provas, "provas");
  const [pen] = await q(supabase.from("penalidades").insert({
    condominio_id: ctx.condominioId, numero: `${ano}-${String(ctx.maxPenalidade + 1).padStart(3, "0")}`,
    tipo, unidade_id: f.unidade, categoria_infracao: f.categoria,
    descricao: f.desc || f.categoria, base_normativa: f.base || "Regimento interno",
    ocorrida_em: f.data ? new Date(f.data).toISOString() : new Date().toISOString(),
    valor: tipo === "multa" ? parseBRL(f.valor) : null,
    prazo_defesa: f.prazo || null,
    status: tipo === "multa" ? "em_defesa" : "registrada", registrada_por: uid,
  }).select(), "penalidades");
  if (provas.length)
    await q(supabase.from("penalidade_provas").insert(provas.map((p) => ({
      penalidade_id: pen.id, tipo: provaTipo(p.mime), arquivo_url: p.url, hash_sha256: p.hash,
    }))).select(), "provas");
}

/* Envia a penalidade aprovada ao responsável: registra a entrega e, se for
   multa, emite a cobrança (tipo "multa", vencimento no prazo de defesa ou em
   30 dias) vinculada — é ela que define os status "paga"/"vencida".
   Requer as colunas do supabase-penalidades-status.sql. */
export async function enviarPenalidade(ctx, m) {
  const upd = { entregue_em: new Date().toISOString() };
  if (m.valor > 0) {
    const u = ctx.unidades.find((x) => x.id === m.unidadeId);
    if (!u?.responsavelId)
      throw new Error("A unidade desta multa não tem responsável financeiro definido. Vincule a pessoa na tela Pessoas (papel proprietário/inquilino).");
    const venc = m.prazoISO && m.prazoISO > new Date().toISOString().slice(0, 10)
      ? m.prazoISO : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const [cob] = await q(supabase.from("cobrancas").insert({
      condominio_id: ctx.condominioId, unidade_id: m.unidadeId, responsavel_id: u.responsavelId,
      competencia: new Date().toISOString().slice(0, 7), tipo: "multa",
      valor_original: m.valor, vencimento: venc, status: "emitida",
    }).select(), "cobrancas");
    upd.cobranca_id = cob.id;
    upd.status = "lancada";
  }
  const { error } = await supabase.from("penalidades").update(upd).eq("id", m.id).select();
  if (error) throw new Error(/entregue_em|cobranca_id|column|schema cache/i.test(error.message)
    ? "Rode o supabase-penalidades-status.sql no SQL Editor do Supabase para habilitar o envio ao responsável."
    : `penalidades: ${error.message}`);
}

export async function decidirPenalidade(ctx, id, aprovar) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("penalidades").update({
    status: aprovar ? "aprovada" : "cancelada", decidida_por: uid,
    parecer: aprovar ? "Aprovada pelo síndico via painel." : "Cancelada pelo síndico via painel.",
  }).eq("id", id).select(), "penalidades");
}

/* Destinatários do comunicado a partir do segmento escolhido — sempre sobre
   os blocos/tipos/andares realmente cadastrados pelo condomínio. */
function destinatariosDoSegmento(ctx, seg) {
  if (!seg || seg === "todas") return ctx.pessoas;
  if (seg === "inadimplentes") return ctx.pessoas.filter((p) => p.unidadeId && ctx.unidadesVencidas.has(p.unidadeId));
  const [k, v] = seg.split(":");
  const unids = new Set(ctx.unidades
    .filter((u) => (k === "unidade" ? u.id === v : k === "bloco" ? u.bloco === v : k === "tipo" ? u.tipo === v : String(u.andar) === v))
    .map((u) => u.id));
  return ctx.pessoas.filter((p) => p.unidadeId && unids.has(p.unidadeId));
}
const rotuloSegmento = (seg, ctx) => {
  if (!seg || seg === "todas") return "Todas as unidades";
  if (seg === "inadimplentes") return "Somente inadimplentes";
  const [k, v] = seg.split(":");
  if (k === "unidade") return `Unidade ${ctx?.unidades.find((u) => u.id === v)?.label || v}`;
  return k === "bloco" ? `Bloco ${v}` : k === "andar" ? `Andar ${v}` : `${UNIDADE_TIPO_LABEL[v] || v}s`;
};

/* PDF timbrado (comunicados e documentos avulsos), gerado no navegador (jsPDF) */
async function gerarPdfTimbrado(ctx, d) {
  const cond = await obterCondominio(ctx).catch(() => ({ nome: ctx.condominioNome }));
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const OURO = [212, 175, 55];
  /* cabeçalho: logo (ou iniciais) + identificação */
  let temLogo = false;
  if (cond.logoUrl) {
    try {
      const blob = await (await fetch(cond.logoUrl)).blob();
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      doc.addImage(dataUrl, 17, 15, 16, 16); temLogo = true;
    } catch { /* sem logo no PDF */ }
  }
  if (!temLogo) {
    doc.setFillColor(10, 14, 26); doc.circle(25, 23, 8, "F");
    doc.setTextColor(...OURO); doc.setFontSize(10); doc.setFont("helvetica", "bold");
    doc.text((cond.nome || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(""), 25, 24.5, { align: "center" });
  }
  doc.setTextColor(26, 26, 26); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(cond.nome || "—", 38, 22);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
  doc.text([cond.cnpj && `CNPJ ${cond.cnpj}`, cond.endereco].filter(Boolean).join("  ·  "), 38, 28);
  doc.setDrawColor(...OURO); doc.setLineWidth(0.8); doc.line(17, 36, 193, 36);
  /* corpo */
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(158, 124, 20);
  doc.text(String(d.tipo || "Comunicado").toUpperCase(), 17, 46, { charSpace: 1 });
  doc.setFontSize(14); doc.setTextColor(26, 26, 26);
  doc.text(doc.splitTextToSize(d.titulo, 176), 17, 55);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(50, 50, 50);
  doc.text(doc.splitTextToSize(d.corpo, 176), 17, 68, { lineHeightFactor: 1.5 });
  /* rodapé */
  doc.setFontSize(9); doc.setTextColor(110, 110, 110);
  doc.text(`${d.rodape ? d.rodape + "   ·   " : ""}Emitido em ${new Date().toLocaleDateString("pt-BR")}`, 17, 250);
  doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.2); doc.line(70, 265, 140, 265);
  doc.text(`${cond.sindico || "Síndico"} — Síndico`, 105, 270, { align: "center" });
  doc.setFontSize(8); doc.text("Documento gerado pelo CondoMaster Pro", 105, 285, { align: "center" });
  return new File([doc.output("blob")], `timbrado-${Date.now()}.pdf`, { type: "application/pdf" });
}

/* Sobe o PDF timbrado e arquiva no módulo Documentos; devolve { url, id } */
async function arquivarPdfTimbrado(ctx, uid, { tipoDoc, titulo, unidadeId = null, arquivo }) {
  const [up] = await uploadArquivos(ctx, arquivo, "documentos-timbrados");
  const retencao = new Date(); retencao.setFullYear(retencao.getFullYear() + 5);
  const [docRow] = await q(supabase.from("documentos").insert({
    condominio_id: ctx.condominioId, tipo: tipoDoc, titulo, unidade_id: unidadeId,
    arquivo_url: up.url, hash_sha256: up.hash, template_versao: "v1",
    emitido_por: uid, retencao_ate: retencao.toISOString().slice(0, 10),
  }).select(), "documentos");
  return { url: up.url, id: docRow.id };
}

/* Popup "Novo documento timbrado" do módulo Documentos */
export async function criarDocumento(ctx, f) {
  const uid = precisaUsuario(ctx);
  const unidade = ctx.unidades.find((u) => u.id === f.unidade);
  const arquivo = await gerarPdfTimbrado(ctx, {
    tipo: f.tipo, titulo: f.titulo, corpo: f.corpo || f.titulo,
    rodape: unidade ? `Unidade ${unidade.label}` : "",
  });
  const { url } = await arquivarPdfTimbrado(ctx, uid, {
    tipoDoc: DOC_TIPO_ENUM[f.tipo] || "circular", titulo: f.titulo,
    unidadeId: f.unidade || null, arquivo,
  });
  return url;
}

/* Baixa a cobrança em PDF timbrado (botão Baixar do popup de QR da tela Cobranças) */
export async function baixarPdfCobranca(ctx, c) {
  const valor = fmtMoeda(c.valor, ctx.moeda);
  const arquivo = await gerarPdfTimbrado(ctx, {
    tipo: "Cobrança condominial",
    titulo: `Cobrança ${c.comp} — Unidade ${c.unidade}`,
    corpo: `Cobrança condominial da competência ${c.comp}, no valor de ${valor}, com vencimento em ${c.vencFull}. Situação atual: ${c.status}. ${c.tx && c.tx !== "—" ? `Transação Verum Pay: ${c.tx} — baixa automática confirmada.` : "O pagamento pode ser feito pelo QR Code disponível no portal do morador."}`,
    rodape: `Unidade ${c.unidade}${c.resp ? ` · Responsável: ${c.resp}` : ""}`,
  });
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = url; a.download = `cobranca-${c.competencia}-${c.unidade}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const COMUNIC_DOC_TIPO = { comunicado: "circular", convocacao: "convocacao", circular: "circular", aviso_manutencao: "circular", emergencia: "circular" };

export async function criarComunicado(ctx, f) {
  const uid = precisaUsuario(ctx);
  const canais = ["Portal", "E-mail", "WhatsApp", "Impressão"].filter((c) => f[`canal_${c}`])
    .map((c) => ({ Portal: "portal", "E-mail": "email", WhatsApp: "whatsapp", "Impressão": "portal" }[c]));
  const seg = f.segmento || "todas";
  const alvo = destinatariosDoSegmento(ctx, seg);
  const rotulo = rotuloSegmento(seg, ctx);
  const tipoEnum = COMUNIC_TIPO_ENUM[f.tipo] || "comunicado";

  /* versão timbrada em PDF, arquivada no módulo Documentos */
  let pdfUrl = null, documentoId = null;
  if (f.gerarPdf) {
    const arquivo = await gerarPdfTimbrado(ctx, { tipo: f.tipo, titulo: f.titulo, corpo: f.corpo || f.titulo, rodape: `Destinatários: ${rotulo}` });
    const arq = await arquivarPdfTimbrado(ctx, uid, { tipoDoc: COMUNIC_DOC_TIPO[tipoEnum] || "circular", titulo: f.titulo, arquivo });
    pdfUrl = arq.url; documentoId = arq.id;
  }

  const [com] = await q(supabase.from("comunicados").insert({
    condominio_id: ctx.condominioId, tipo: tipoEnum,
    titulo: f.titulo, corpo: f.corpo || f.titulo,
    segmento: { descricao: rotulo, filtro: seg, pdf_url: pdfUrl, documento_id: documentoId },
    canais: canais.length ? [...new Set(canais)] : ["portal"],
    publicado_em: new Date().toISOString(), publicado_por: uid,
  }).select(), "comunicados");
  if (alvo.length)
    await q(supabase.from("comunicado_destinatarios").insert(alvo.map((p) => ({ comunicado_id: com.id, pessoa_id: p.id }))).select(), "destinatários");
  return alvo.length;
}

export async function criarChamado(ctx, f) {
  const uid = precisaUsuario(ctx);
  const midias = await uploadArquivos(ctx, f.midias, "chamados");
  await q(supabase.from("chamados").insert({
    condominio_id: ctx.condominioId, numero: `OS-${ctx.maxOS + 1}`,
    categoria: CHAMADO_CAT_ENUM[f.categoria] || "area_comum", prioridade: PRIO_ENUM[f.prioridade] || "media",
    descricao: f.desc || "Sem descrição", status: "aberto", aberto_por: uid,
    unidade_id: f.unidadeId || null,
    responsavel_vinculo_id: f.responsavel || null, prazo: f.prazo || null,
    custo_estimado: f.custo ? parseBRL(f.custo) : null,
    midias: midias.length ? midias.map((m) => ({ url: m.url, tipo: m.mime, nome: m.nome })) : null,
  }).select(), "chamados");
}

/* ─────────── cadastro do condomínio (tela Cadastro do Condomínio) ───────────
   Sempre escopado pelo condominio_id do token — cada diretor só enxerga e
   edita o próprio prédio (política cond_select/cond_update do RLS). */
const COND_TIPO_LABEL = { residencial: "Residencial", comercial: "Comercial", misto: "Misto" };
const COND_TIPO_ENUM = Object.fromEntries(Object.entries(COND_TIPO_LABEL).map(([k, v]) => [v, k]));
const COND_PORTE_LABEL = { alto: "Alto padrão", medio: "Médio padrão", baixo: "Baixo padrão" };
const COND_PORTE_ENUM = Object.fromEntries(Object.entries(COND_PORTE_LABEL).map(([k, v]) => [v, k]));

export async function obterCondominio(ctx) {
  const [c] = await q(supabase.from("condominios").select("*").eq("id", ctx.condominioId), "condominios");
  if (!c) throw new Error("Condomínio não encontrado para esta conta.");
  const r = c.regras_internas || {}, g = r.gestao || {}, e = c.endereco || {};
  const pg = r.pagamentos || {}, bc = pg.banco || {}; // pg.cripto/pg.transferencia: formato antigo (texto livre)
  return {
    nome: c.nome_fantasia, razao: c.razao_social, cnpj: c.cnpj, inscricao: c.inscricao_municipal || "",
    tipo: COND_TIPO_LABEL[c.tipo] || "Residencial", porte: COND_PORTE_LABEL[c.porte] || "Médio padrão",
    endereco: e.texto || "", torres: e.torres || "", resumo: e.resumo_unidades || "",
    administradora: g.administradora || "", sindico: g.sindico || "", diretorAdm: g.diretor_adm || "",
    tesouraria: g.tesouraria || "", inicioGestao: g.inicio_gestao || "",
    silencio: r.silencio || "", mudancas: r.mudancas || "", obras: r.obras || "",
    visitantes: r.visitantes || "", animais: r.animais || "", areas: r.areas_comuns || "",
    moeda: r.moeda || "USD",
    verumWallet: pg.verum_wallet || pg.cripto || "",
    dinheiro: pg.dinheiro !== false, // padrão: aceita dinheiro
    bancoTitular: bc.titular || "", bancoNome: bc.banco || "", bancoPais: bc.pais || "",
    bancoIban: bc.iban || "", bancoSwift: bc.swift || "", bancoConta: bc.conta || "",
    bancoAgencia: bc.agencia || "", bancoObs: bc.obs || pg.transferencia || "",
    logoUrl: c.identidade_visual?.logo_url || null, cor: c.identidade_visual?.cor_primaria || "#D4AF37",
    atualizadoEm: c.atualizado_em,
  };
}

export async function salvarCondominio(ctx, f) {
  const identidade = await obterIdentidade(ctx); // preserva o logo já enviado
  await q(supabase.from("condominios").update({
    nome_fantasia: f.nome, razao_social: f.razao || f.nome, cnpj: f.cnpj,
    inscricao_municipal: f.inscricao || null,
    tipo: COND_TIPO_ENUM[f.tipo] || "residencial", porte: COND_PORTE_ENUM[f.porte] || "medio",
    endereco: { texto: f.endereco || "", torres: f.torres || "", resumo_unidades: f.resumo || "" },
    /* gestão descritiva vive dentro de regras_internas.gestao (sem migração de schema) */
    regras_internas: {
      silencio: f.silencio || "", mudancas: f.mudancas || "", obras: f.obras || "",
      visitantes: f.visitantes || "", animais: f.animais || "", areas_comuns: f.areas || "",
      moeda: f.moeda || "USD",
      /* meios de pagamento das cobranças: carteira Verum Wallet + dados bancários
         em campos separados (IBAN/SWIFT) para funcionar em qualquer país */
      pagamentos: {
        verum_wallet: f.verumWallet || "",
        dinheiro: f.dinheiro === "on", // checkbox: ausente = desativado
        banco: { titular: f.bancoTitular || "", banco: f.bancoNome || "", pais: f.bancoPais || "",
          iban: f.bancoIban || "", swift: f.bancoSwift || "", conta: f.bancoConta || "",
          agencia: f.bancoAgencia || "", obs: f.bancoObs || "" },
      },
      gestao: { administradora: f.administradora || "", sindico: f.sindico || "",
        diretor_adm: f.diretorAdm || "", tesouraria: f.tesouraria || "", inicio_gestao: f.inicioGestao || "" },
    },
    identidade_visual: { ...identidade, cor_primaria: f.cor || identidade.cor_primaria || "#D4AF37" },
  }).eq("id", ctx.condominioId).select(), "condominios");
}

/* Identidade visual do condomínio (jsonb em condominios.identidade_visual) */
export async function obterIdentidade(ctx) {
  const [c] = await q(supabase.from("condominios").select("identidade_visual").eq("id", ctx.condominioId), "condominios");
  return c?.identidade_visual || {};
}

/* Converte a URL pública do bucket de volta no caminho interno; apaga o arquivo.
   Falha no storage não interrompe o fluxo — o banco é a fonte de verdade do logo. */
async function apagarDoStorage(url) {
  const caminho = decodeURIComponent(String(url || "").split("/object/public/documentos/")[1] || "");
  if (!caminho) return;
  try { await supabase.storage.from("documentos").remove([caminho]); } catch { /* arquivo órfão fica no bucket */ }
}

export async function salvarLogoCondominio(ctx, arquivo) {
  const [logo] = await uploadArquivos(ctx, arquivo, "identidade");
  if (!logo) throw new Error("Escolha um arquivo de imagem.");
  const atual = await obterIdentidade(ctx);
  await q(supabase.from("condominios").update({ identidade_visual: { ...atual, logo_url: logo.url } })
    .eq("id", ctx.condominioId).select(), "condominios");
  if (atual.logo_url && atual.logo_url !== logo.url) await apagarDoStorage(atual.logo_url);
  return logo.url;
}

export async function removerLogoCondominio(ctx) {
  const atual = await obterIdentidade(ctx);
  const { logo_url, ...resto } = atual;
  await q(supabase.from("condominios").update({ identidade_visual: resto })
    .eq("id", ctx.condominioId).select(), "condominios");
  if (logo_url) await apagarDoStorage(logo_url);
}

/* Gestão do chamado (tela Manutenção): designar responsável depois de criado,
   mudar status (aberto → andamento → concluído), prazo, prioridade e custo. */
export async function atualizarChamado(ctx, id, f) {
  /* chamado concluído é registro histórico — não pode mais ser alterado */
  const [atual] = await q(supabase.from("chamados").select("status").eq("id", id), "chamados");
  if (atual?.status === "concluido")
    throw new Error("Este chamado já foi concluído e não pode mais ser editado.");
  await q(supabase.from("chamados").update({
    responsavel_vinculo_id: f.responsavel || null,
    status: f.status || "aberto",
    prioridade: PRIO_ENUM[f.prioridade] || "media",
    prazo: f.prazo || null,
    custo_realizado: f.custo ? parseBRL(f.custo) : null,
    fechado_em: f.status === "concluido" || f.status === "cancelado" ? new Date().toISOString() : null,
  }).eq("id", id).select(), "chamados");
}

/* Pré-autorização: gera um token cujo hash fica no banco — o QR carrega o
   token ("CM1|<token>") e a portaria valida comparando o hash. Devolve os
   dados para exibir o QR e enviar por e-mail ao visitante. */
export async function criarPreAutorizacao(ctx, f) {
  const uid = precisaUsuario(ctx);
  const dia = f.data || new Date().toISOString().slice(0, 10);
  const token = hex64();
  const [pa] = await q(supabase.from("pre_autorizacoes").insert({
    condominio_id: ctx.condominioId, tipo: PREAUT_TIPO_ENUM[f.tipo] || "visitante",
    nome: f.nome, unidade_id: f.unidade, autorizada_por: uid,
    valida_de: `${dia}T00:00:00-03:00`, valida_ate: `${dia}T23:59:59-03:00`,
    qr_token_hash: await sha256(token), veiculo_placa: f.placa || null,
  }).select(), "pre_autorizacoes");
  await q(supabase.from("acessos_portaria").insert({
    condominio_id: ctx.condominioId, tipo: "entrada", pre_autorizacao_id: pa.id,
    pessoa_nome: `${f.nome} (pré-autorizado)`,
    unidade_id: f.unidade, registrado_por: uid,
    detalhes: `Pré-autorização ${f.tipo || "visitante"} · janela ${f.janela || "dia todo"}${f.email ? ` · e-mail ${f.email}` : ""}`,
    ocorrido_em: new Date().toISOString(),
  }).select(), "acessos_portaria");
  return {
    codigo: `CM1|${token}`, nome: f.nome, email: f.email || "",
    unidade: ctx.unidades.find((u) => u.id === f.unidade)?.label || "—",
    janela: f.janela || "dia todo", geradoEm: new Date().toLocaleString("pt-BR"),
    validaAte: `${ddmmyyyy(dia)} 23:59`,
  };
}

/* Botão "Gerar QR de acesso": acesso imediato com janela de duração a partir
   de agora (1h–2h · 2h–5h · 6h–9h). */
const JANELA_QR_HORAS = { "1h-2h": 2, "2h-5h": 5, "6h-9h": 9 };
export async function gerarQrAcesso(ctx, f) {
  const uid = precisaUsuario(ctx);
  const agora = new Date();
  const ate = new Date(agora.getTime() + (JANELA_QR_HORAS[f.janela] || 2) * 3600e3);
  const token = hex64();
  await q(supabase.from("pre_autorizacoes").insert({
    condominio_id: ctx.condominioId, tipo: "visitante", nome: f.nome, unidade_id: f.unidade,
    autorizada_por: uid, valida_de: agora.toISOString(), valida_ate: ate.toISOString(),
    qr_token_hash: await sha256(token),
  }).select(), "pre_autorizacoes");
  return {
    codigo: `CM1|${token}`, nome: f.nome, email: f.email || "",
    unidade: ctx.unidades.find((u) => u.id === f.unidade)?.label || "—",
    janela: f.janela || "1h-2h", geradoEm: agora.toLocaleString("pt-BR"),
    validaAte: ate.toLocaleString("pt-BR"),
  };
}

/* Leitor da portaria: valida o código lido/digitado e identifica a permissão */
export async function validarQrAcesso(ctx, codigo) {
  const token = String(codigo || "").trim().replace(/^CM1\|/, "");
  if (!token) return { permitido: false, motivo: "Código vazio." };
  const pas = await q(supabase.from("pre_autorizacoes")
    .select("*, unidades(numero, blocos(nome))")
    .eq("condominio_id", ctx.condominioId).eq("qr_token_hash", await sha256(token)), "pre_autorizacoes");
  const pa = pas[0];
  if (!pa) return { permitido: false, motivo: "QR não encontrado para este condomínio." };
  const info = {
    id: pa.id, unidadeId: pa.unidade_id, nome: pa.nome, tipo: PREAUT_TIPO_LABEL_UI[pa.tipo] || pa.tipo,
    unidade: pa.unidades ? `${pa.unidades.numero}-${pa.unidades.blocos?.nome || "?"}` : "—",
    janela: `${new Date(pa.valida_de).toLocaleString("pt-BR")} → ${new Date(pa.valida_ate).toLocaleString("pt-BR")}`,
  };
  const agora = new Date();
  if (pa.usada_em && pa.tipo !== "recorrente")
    return { permitido: false, motivo: `QR já utilizado em ${new Date(pa.usada_em).toLocaleString("pt-BR")}.`, ...info };
  if (agora < new Date(pa.valida_de)) return { permitido: false, motivo: "Fora da janela: o acesso ainda não está liberado.", ...info };
  if (agora > new Date(pa.valida_ate)) return { permitido: false, motivo: "QR expirado.", ...info };
  return { permitido: true, ...info };
}
const PREAUT_TIPO_LABEL_UI = Object.fromEntries(Object.entries(PREAUT_TIPO_ENUM).map(([l, v]) => [v, l]));

/* Confirma a entrada validada: marca o QR como usado e registra o acesso */
export async function confirmarEntradaQr(ctx, v) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("pre_autorizacoes").update({ usada_em: new Date().toISOString() }).eq("id", v.id).select(), "pre_autorizacoes");
  await q(supabase.from("acessos_portaria").insert({
    condominio_id: ctx.condominioId, tipo: "entrada", pre_autorizacao_id: v.id,
    pessoa_nome: `${v.nome} (QR validado)`, unidade_id: v.unidadeId, registrado_por: uid,
    detalhes: "Entrada liberada por QR Code na portaria", ocorrido_em: new Date().toISOString(),
  }).select(), "acessos_portaria");
}

/* Ocorrências vistas pela portaria (título, descrição, quando ocorreu) */
export async function registrarOcorrencia(ctx, f) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("acessos_portaria").insert({
    condominio_id: ctx.condominioId, tipo: "ocorrencia", pessoa_nome: f.titulo,
    registrado_por: uid, detalhes: f.descricao || f.titulo,
    ocorrido_em: f.quando ? new Date(f.quando).toISOString() : new Date().toISOString(),
  }).select(), "acessos_portaria");
}

/* Entregas recebidas na portaria e repassadas à unidade */
export async function registrarEntrega(ctx, f) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("acessos_portaria").insert({
    condominio_id: ctx.condominioId, tipo: "entrega", pessoa_nome: f.morador,
    unidade_id: f.unidade || null, registrado_por: uid,
    detalhes: `Entrega recebida na portaria${f.obs ? ` · ${f.obs}` : ""}`,
    ocorrido_em: f.quando ? new Date(f.quando).toISOString() : new Date().toISOString(),
  }).select(), "acessos_portaria");
}

export async function gerarCobrancas(ctx, f) {
  const total = parseBRL(f.total);
  if (!total) throw new Error("Informe o valor da cobrança.");
  const competencia = f.competencia || new Date().toISOString().slice(0, 7);
  const vencimento = f.vencimento || `${competencia}-10`;

  /* cobrança direcionada: uma unidade específica, identificada pela pessoa responsável */
  if (f.unidade) {
    const u = ctx.unidades.find((x) => x.id === f.unidade);
    if (!u) throw new Error("Unidade não encontrada.");
    let responsavelId = u.responsavelId;
    if (!responsavelId && f.moradorNome) {
      /* usa o morador cadastrado em Gerenciar Acessos: acha (ou cria) a pessoa e vincula à unidade */
      const nome = f.moradorNome.trim();
      let pessoa = ctx.pessoas.find((p) => p.nome.toLowerCase() === nome.toLowerCase());
      if (!pessoa) {
        [pessoa] = await q(supabase.from("pessoas").insert({
          condominio_id: ctx.condominioId, nome, tipo_pessoa: "fisica",
          cpf_cnpj: `M-${Date.now().toString(36).toUpperCase()}`, // placeholder até completar o cadastro em Pessoas
        }).select(), "pessoas");
        await q(supabase.from("pessoa_vinculos").insert({
          condominio_id: ctx.condominioId, pessoa_id: pessoa.id, unidade_id: u.id,
          papel: "morador", inicio: new Date().toISOString().slice(0, 10),
        }).select(), "pessoa_vinculos");
      }
      responsavelId = pessoa.id;
      await q(supabase.from("unidades").update({ responsavel_financeiro_id: responsavelId }).eq("id", u.id).select(), "unidades");
    }
    if (!responsavelId)
      throw new Error("Esta unidade não tem responsável financeiro nem morador vinculado. Cadastre a pessoa na tela Pessoas ou o morador em Gerenciar Acessos.");
    await q(supabase.from("cobrancas").insert({
      condominio_id: ctx.condominioId, unidade_id: u.id, responsavel_id: responsavelId,
      competencia, tipo: "extra", valor_original: total, vencimento, status: "emitida",
    }).select(), "cobrancas");
    return 1;
  }

  /* rateio: todas as unidades com responsável financeiro.
     Base de cálculo: fração ideal (proporcional à área privativa) ou divisão
     igual — na igual, os centavos de resto vão para as primeiras unidades
     para a soma bater exatamente com o total. */
  const alvo = ctx.unidades.filter((u) => u.responsavelId);
  if (!alvo.length) throw new Error("Nenhuma unidade com responsável financeiro definido.");
  let valores;
  if (f.base === "igual") {
    const centavos = Math.round(total * 100);
    const cota = Math.floor(centavos / alvo.length);
    let resto = centavos - cota * alvo.length;
    valores = alvo.map(() => (cota + (resto-- > 0 ? 1 : 0)) / 100);
  } else {
    const somaFracao = alvo.reduce((s, u) => s + u.fracao, 0) || 1;
    valores = alvo.map((u) => Math.round((total * u.fracao / somaFracao) * 100) / 100);
  }
  const rows = alvo.map((u, i) => ({
    condominio_id: ctx.condominioId, unidade_id: u.id, responsavel_id: u.responsavelId,
    competencia, tipo: "ordinaria",
    valor_original: valores[i],
    vencimento, status: "emitida",
  }));
  const { error } = await supabase.from("cobrancas").insert(rows);
  if (error) {
    if (error.message.includes("uq_cobranca_ordinaria")) throw new Error(`Já existem cobranças ordinárias na competência ${compBR(competencia)}.`);
    throw new Error("cobranças: " + error.message);
  }
  return rows.length;
}
