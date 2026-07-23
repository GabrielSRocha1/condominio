/* Camada de dados: lê e grava no Supabase e converte para o formato das telas. */
import { supabase } from "./supabase";

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
    supabase.from("condominios").select("id, nome_fantasia, saas_assinaturas(status, renovacao, saas_planos(nome, preco_mensal)), unidades(count)").order("criado_em"),
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
    q(supabase.from("penalidades").select("*, unidades(numero, blocos(nome)), pessoas(nome)").eq("condominio_id", cid).order("numero", { ascending: false }), "penalidades"),
    q(supabase.from("comunicados").select("*, comunicado_destinatarios(lido_em)").eq("condominio_id", cid).order("criado_em", { ascending: false }), "comunicados"),
    q(supabase.from("chamados").select("*, pessoa_vinculos(pessoas(nome))").eq("condominio_id", cid).order("criado_em", { ascending: false }), "chamados"),
    q(supabase.from("acessos_portaria").select("*, unidades(numero, blocos(nome))").eq("condominio_id", cid).order("ocorrido_em", { ascending: false }).limit(20), "acessos_portaria"),
    q(supabase.from("documentos").select("*, unidades(numero, blocos(nome))").eq("condominio_id", cid).is("deletado_em", null).order("criado_em", { ascending: false }), "documentos"),
    q(supabase.from("pagamentos").select("valor_pago, pago_em, cobrancas(unidades(numero, blocos(nome)))").eq("condominio_id", cid).order("pago_em", { ascending: false }).limit(3), "pagamentos"),
  ]);

  const uLabel = (u) => (u ? `${u.numero}-${u.blocos?.nome || "?"}` : "—");
  const unidadeById = Object.fromEntries(unidadesRaw.map((u) => [u.id, u]));

  /* unidades */
  const cobrPorUnidade = {};
  cobrRaw.forEach((c) => {
    if (c.status === "vencida") cobrPorUnidade[c.unidade_id] = (cobrPorUnidade[c.unidade_id] || 0) + num(c.valor_original) + num(c.encargos);
  });
  const unidades = unidadesRaw.map((u) => ({
    id: u.id, num: u.numero, bloco: u.blocos?.nome || "?", andar: u.andar,
    tipo: UNIDADE_TIPO_LABEL[u.tipo] || u.tipo, status: u.status,
    fracao: num(u.fracao_ideal), resp: u.pessoas?.nome || "—",
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
      unidade: v?.unidade_id ? uLabel(unidadeById[v.unidade_id]) : "—",
      doc: maskDoc(p.cpf_cnpj), tel: p.telefone || "—", status: "ativo",
    };
  });

  /* lançamentos */
  const lanc = lancRaw.map((l) => ({
    id: l.id, data: ddmm(l.data), tipo: l.tipo, cat: l.categorias_financeiras?.nome || "—",
    desc: l.descricao, valor: num(l.valor), status: LANC_STATUS_UI[l.status] || l.status,
    forma: FORMA_LABEL[l.forma_pagamento] || "—", competencia: l.competencia,
  }));

  /* cobranças */
  const cobr = cobrRaw.map((c) => ({
    id: c.id, comp: compBR(c.competencia), unidade: uLabel(c.unidades),
    resp: primeiroNome(c.pessoas?.nome), valor: num(c.valor_original),
    venc: ddmm(c.vencimento), vencFull: ddmmyyyy(c.vencimento),
    status: COBR_STATUS_UI[c.status] || c.status, tx: c.provider_charge_id || "—",
    unidadeId: c.unidade_id, competencia: c.competencia,
  }));

  /* multas */
  const multas = multasRaw.map((m) => {
    const anteriores = multasRaw.filter((x) => x.id !== m.id && x.unidade_id === m.unidade_id && x.ocorrida_em < m.ocorrida_em).length;
    const statusUI = m.tipo === "advertencia" ? "advertencia"
      : m.status === "em_defesa" || m.status === "registrada" ? "aguardando_defesa"
      : m.status === "aprovada" || m.status === "lancada" ? "aprovada" : m.status;
    return {
      id: m.id, num: m.numero, unidade: uLabel(m.unidades), infrator: m.pessoas?.nome || "Não identificado",
      categoria: m.categoria_infracao, data: ddmmyyyy(m.ocorrida_em), valor: num(m.valor),
      status: statusUI, prazo: m.prazo_defesa && statusUI === "aguardando_defesa" ? ddmm(m.prazo_defesa) : "—",
      reincidencia: anteriores, base: m.base_normativa, descricao: m.descricao,
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
    };
  });

  /* chamados */
  const chamados = chamadosRaw.map((c) => ({
    id: c.id, num: c.numero, cat: CHAMADO_CAT_LABEL[c.categoria] || c.categoria, desc: c.descricao,
    prio: c.prioridade, status: c.status,
    resp: primeiroNome(c.pessoa_vinculos?.pessoas?.nome) || "—",
    aberto: ddmm(c.criado_em), custo: num(c.custo_realizado) || num(c.custo_estimado),
  }));

  /* acessos */
  const acessos = acessosRaw.map((a) => ({
    id: a.id, hora: a.ocorrido_em ? a.ocorrido_em.slice(11, 16) : "—",
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

  /* atividade recente */
  const atividades = [
    ...pagamentosRaw.map((p) => [`Pagamento confirmado — ${uLabel(p.cobrancas?.unidades)} · R$ ${num(p.valor_pago).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, ddmm(p.pago_em)]),
    ...comunicRaw.slice(0, 1).map((c) => [`Comunicado "${c.titulo}" publicado`, ddmm(c.publicado_em || c.criado_em)]),
    ...chamadosRaw.slice(0, 1).map((c) => [`Chamado ${c.numero} — ${c.descricao}`, ddmm(c.criado_em)]),
  ].slice(0, 4);

  /* contexto para escritas */
  const ctx = {
    condominioId: cid, condominioNome: principal.nome_fantasia,
    usuarioId: usuarios[0]?.usuario_id || null,
    blocos, categorias,
    unidades: unidadesRaw.map((u) => ({ id: u.id, label: uLabel(u), responsavelId: u.responsavel_financeiro_id, fracao: num(u.fracao_ideal) })),
    pessoas: pessoasRaw.map((p) => ({ id: p.id, nome: p.nome })),
    operacionais: vinculos.filter((v) => v.papel === "funcionario" || v.papel === "prestador")
      .map((v) => ({ id: v.id, label: `${pessoasRaw.find((p) => p.id === v.pessoa_id)?.nome} (${PAPEL_LABEL[v.papel].toLowerCase()})` })),
    maxOS: Math.max(0, ...chamadosRaw.map((c) => Number((c.numero || "").replace(/\D/g, "")) || 0)),
    maxPenalidade: Math.max(0, ...multasRaw.map((m) => Number((m.numero || "").split("-")[1]) || 0)),
  };

  return { ctx, unidades, pessoas, lanc, cobr, multas, comunic, chamados, acessos, docs, tenants, boletos, fluxo, fluxoDiarioPorMes, mesAtualReal, despesasPorMes, inadim, pieReceitasPorMes, stats, atividades };
}

/* ─────────── escritas ─────────── */

/* Primeiro acesso com banco vazio: cria o condomínio e registra o diretor
   (pessoa + vínculo + usuário + perfil), destravando as demais gravações. */
export async function criarCondominio(f, diretor) {
  const TIPO = { Residencial: "residencial", Comercial: "comercial", Misto: "misto" };
  const PORTE = { "Alto padrão": "alto", "Médio padrão": "medio", "Baixo padrão": "baixo" };
  const [cond] = await q(supabase.from("condominios").insert({
    nome_fantasia: f.nome, razao_social: f.razao || f.nome, cnpj: f.cnpj,
    endereco: { texto: f.endereco }, tipo: TIPO[f.tipo] || "residencial", porte: PORTE[f.porte] || "medio",
  }).select(), "condominios");
  const [pessoa] = await q(supabase.from("pessoas").insert({
    condominio_id: cond.id, nome: diretor?.nome || "Diretor", tipo_pessoa: "fisica",
    cpf_cnpj: f.cpf, email: diretor?.email || null,
  }).select(), "pessoas");
  await q(supabase.from("pessoa_vinculos").insert({
    condominio_id: cond.id, pessoa_id: pessoa.id, papel: "diretor",
    inicio: new Date().toISOString().slice(0, 10),
  }).select(), "pessoa_vinculos");
  /* conta pré-gravada no cadastro (banco vazio): completa o vínculo com a
     pessoa; senão, cria o usuário agora */
  const emailDiretor = diretor?.email || `diretor+${Date.now()}@local`;
  const { data: preExistente } = await supabase.from("usuarios").select("id").eq("email", emailDiretor).maybeSingle();
  const [usuario] = preExistente
    ? await q(supabase.from("usuarios").update({ pessoa_id: pessoa.id }).eq("id", preExistente.id).select(), "usuarios")
    : await q(supabase.from("usuarios").insert({
        pessoa_id: pessoa.id, email: emailDiretor,
        senha_hash: await sha256(diretor?.senha || crypto.randomUUID()),
      }).select(), "usuarios");
  const perfil = await q(supabase.from("perfis").select("id").eq("nome", "diretor").single(), "perfis");
  await q(supabase.from("usuario_perfis").insert({
    usuario_id: usuario.id, condominio_id: cond.id, perfil_id: perfil.id,
  }).select(), "usuario_perfis");

  /* todo condomínio nasce com assinatura em "teste" no plano escolhido no
     cadastro — o acesso só é liberado depois que o pagamento a ativa */
  const planoNome = String(f.plano || "Essencial").split(" —")[0].trim();
  const { data: planoIni } = await supabase.from("saas_planos").select("id").eq("nome", planoNome).maybeSingle()
    .then(async (r) => r.data ? r : supabase.from("saas_planos").select("id").eq("nome", "Essencial").maybeSingle());
  if (planoIni) await supabase.from("saas_assinaturas").insert({
    condominio_id: cond.id, plano_id: planoIni.id, status: "teste",
    inicio: new Date().toISOString().slice(0, 10), forma_pagamento: "verum_pay",
  });
  return cond.id; // o App guarda na sessão — cada conta abre só o próprio prédio
}

/* Planos ativos do SaaS — usados no cadastro para a escolha da licença */
export async function listarPlanos() {
  const { data } = await supabase.from("saas_planos").select("nome, preco_mensal, limite_unidades").eq("ativo", true).order("preco_mensal");
  return data || [];
}

/* Cadastro do diretor na tela de login: grava a conta na tabela usuarios
   (pessoa + usuário + perfil de diretor). Se o banco ainda não tem condomínio,
   devolve null — nesse caso criarCondominio fará a gravação logo em seguida. */
export async function registrarDiretor({ nome, email, senha }) {
  const { data: existente, error: eBusca } = await supabase
    .from("usuarios").select("id").eq("email", email).maybeSingle();
  if (eBusca) throw new Error(eBusca.message);
  if (existente) throw new Error("Este e-mail já está cadastrado. Use a opção de entrar com e-mail e senha.");

  /* multi-tenant: a conta nasce SEM vínculo com condomínio nenhum — o
     condomínio DELA é criado no passo seguinte (criarCondominio), nunca
     aproveitando o prédio de outra conta */
  const { data: novo, error } = await supabase.from("usuarios")
    .insert({ email, senha_hash: await sha256(senha), pessoa_id: null }).select().single();
  if (error) throw new Error(error.message.includes("not-null")
    ? "O banco precisa de um ajuste: rode no Supabase (SQL Editor): alter table usuarios alter column pessoa_id drop not null;"
    : error.message);
  return { id: novo.id, pendente: true };
}

/* ─────────── acessos (Gerenciar Emails) — gravados na tabela usuarios ─────────── */

/* e-mail sintético para morador, que entra pelo nome e não tem e-mail próprio */
const emailMorador = (nome, condominioId) =>
  `morador+${nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".")}@${condominioId.slice(0, 8)}.local`;

/* Cria um acesso (sindico, tesouraria, administradora ou morador):
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
  if (ehMorador) {
    const un = ctx.unidades.find((u) => u.label === f.unidade || u.id === f.unidade);
    await q(supabase.from("pessoa_vinculos").insert({
      condominio_id: ctx.condominioId, pessoa_id: pessoa.id, unidade_id: un?.id || null,
      papel: "morador", inicio: new Date().toISOString().slice(0, 10),
    }).select(), "pessoa_vinculos");
  }
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

/* Login dos demais perfis pela tabela usuarios. Morador entra pelo nome;
   os outros, pelo e-mail. Retorna null quando não confere. */
export async function loginUsuario(role, { email, nome, senha }) {
  const hash = await sha256(senha);
  if (role === "morador") {
    const rows = await q(supabase.from("usuarios")
      .select("senha_hash, pessoas!inner(nome, pessoa_vinculos(papel, unidades(numero, blocos(nome)))), usuario_perfis(condominio_id, perfis(nome))")
      .ilike("pessoas.nome", (nome || "").trim()), "usuarios");
    const conta = rows.find((r) => r.senha_hash === hash &&
      (r.usuario_perfis || []).some((up) => up.perfis?.nome === "morador"));
    if (!conta) return null;
    const vinc = (conta.pessoas?.pessoa_vinculos || []).find((v) => v.papel === "morador");
    return {
      nome: conta.pessoas.nome,
      unidade: vinc?.unidades ? `${vinc.unidades.numero}-${vinc.unidades.blocos?.nome || "?"}` : null,
      condominioId: (conta.usuario_perfis || []).find((up) => up.perfis?.nome === "morador")?.condominio_id || null,
    };
  }
  const { data } = await supabase.from("usuarios")
    .select("id, senha_hash, usuario_perfis(condominio_id, perfis(nome))")
    .eq("email", (email || "").trim().toLowerCase()).maybeSingle();
  if (!data || data.senha_hash !== hash) return null;
  const vinculo = (data.usuario_perfis || []).find((up) => up.perfis?.nome === role);
  if (!vinculo) return null;
  return { id: data.id, condominioId: vinculo.condominio_id || null };
}

/* "Já tem prédio cadastrado": confere e-mail e senha na tabela usuarios
   e exige que a conta tenha o perfil de diretor em algum condomínio. */
export async function loginDiretor(email, senha) {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, email, senha_hash, pessoas(nome), usuario_perfis(condominio_id, perfis(nome))")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.senha_hash !== (await sha256(senha))) return null;
  /* conta sem perfil ainda = cadastro recém-feito, aguardando a criação do
     condomínio dela — também é diretor */
  const vinculoDiretor = (data.usuario_perfis || []).find((up) => up.perfis?.nome === "diretor");
  if ((data.usuario_perfis || []).length && !vinculoDiretor) return null;
  return {
    nome: data.pessoas?.nome || "Diretor", email: data.email, senha,
    condominioId: vinculoDiretor?.condominio_id || null, // null = ainda vai criar o prédio
  };
}

/* Checkout Commet: pede ao backend (/api/commet/checkout) o link de pagamento.
   A chave secreta do Commet fica só no servidor; o front recebe apenas a URL. */
export async function pagarComCommet(cobrancaId) {
  let r;
  try {
    r = await fetch("/api/commet/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cobrancaId }),
    });
  } catch {
    throw new Error("Não foi possível falar com o backend de pagamentos.");
  }
  let corpo = null; try { corpo = await r.json(); } catch { /* sem JSON */ }
  if (!r.ok) throw new Error(corpo?.error || (r.status === 404
    ? "Backend de pagamentos ainda não publicado — as funções /api sobem no deploy (Vercel/Netlify), não no npm run dev."
    : `Erro ${r.status} ao criar o pagamento.`));
  return corpo.checkoutUrl;
}

/* Licença SaaS: pede ao backend (/api/commet/assinatura) o checkout da
   assinatura recorrente da mensalidade do CondoMaster para um condomínio. */
export async function assinarLicencaCommet(condominioId) {
  let r;
  try {
    r = await fetch("/api/commet/assinatura", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condominioId }),
    });
  } catch {
    throw new Error("Não foi possível falar com o backend de pagamentos.");
  }
  let corpo = null; try { corpo = await r.json(); } catch { /* sem JSON */ }
  if (!r.ok) throw new Error(corpo?.error || (r.status === 404
    ? "Backend de pagamentos ainda não publicado — as funções /api sobem no deploy (Vercel/Netlify), não no npm run dev."
    : `Erro ${r.status} ao criar a assinatura.`));
  return corpo.checkoutUrl;
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
  let bloco = ctx.blocos.find((b) => b.nome.toLowerCase() === String(f.bloco || "").trim().toLowerCase());
  if (!bloco) bloco = (await q(supabase.from("blocos").insert({ condominio_id: ctx.condominioId, nome: String(f.bloco || "A").trim() }).select(), "blocos"))[0];

  let numeros = [String(f.numero).trim()];
  const ate = String(f.numeroAte || "").trim();
  if (ate) {
    /* aceita letras junto com o número (ex.: 1D até 4D → 1D, 2D, 3D, 4D; ou A1 até A10) */
    const m1 = String(f.numero).trim().match(/^(\D*)(\d+)(\D*)$/);
    const m2 = ate.match(/^(\D*)(\d+)(\D*)$/);
    if (!m1 || !m2) throw new Error("Para criar um intervalo, use um número com ou sem letras (ex.: 1 até 100, ou 1D até 4D).");
    const [, prefixo, n1, sufixo] = m1;
    const [, p2, n2, s2] = m2;
    if ((p2 && p2 !== prefixo) || (s2 && s2 !== sufixo))
      throw new Error("As letras do início e do fim do intervalo devem ser iguais (ex.: 1D até 4D).");
    const ini = parseInt(n1, 10), fim = parseInt(n2, 10);
    if (fim < ini) throw new Error("O número final deve ser maior ou igual ao inicial.");
    if (fim - ini + 1 > 500) throw new Error("Máximo de 500 unidades por vez.");
    const pad = n1.startsWith("0") ? n1.length : 0; // preserva zeros à esquerda (ex.: 001 a 010)
    numeros = Array.from({ length: fim - ini + 1 }, (_, i) => `${prefixo}${String(ini + i).padStart(pad, "0")}${sufixo}`);
  }

  const jaExistem = await q(
    supabase.from("unidades").select("numero").eq("condominio_id", ctx.condominioId).eq("bloco_id", bloco.id).in("numero", numeros),
    "unidades"
  );
  const existentes = new Set(jaExistem.map((u) => u.numero));
  const novos = numeros.filter((n) => !existentes.has(n));
  if (!novos.length) throw new Error(numeros.length === 1
    ? `A unidade ${numeros[0]} já existe neste bloco.`
    : "Todas as unidades desse intervalo já existem neste bloco.");

  const base = {
    condominio_id: ctx.condominioId, bloco_id: bloco.id,
    tipo: UNIDADE_TIPO_ENUM[f.tipo] || "apartamento", andar: f.andar ? Number(f.andar) : null,
    status: UNIDADE_STATUS_ENUM[f.status] || "vaga", fracao_ideal: parseBRL(f.fracao),
  };
  await q(supabase.from("unidades").insert(novos.map((numero) => ({ ...base, numero }))).select(), "unidades");
  return novos.length;
}

export async function criarPessoa(ctx, f) {
  const [p] = await q(supabase.from("pessoas").insert({
    condominio_id: ctx.condominioId, nome: f.nome,
    tipo_pessoa: String(f.doc || "").replace(/\D/g, "").length > 11 ? "juridica" : "fisica",
    cpf_cnpj: f.doc, telefone: f.tel || null, email: f.email || null,
  }).select(), "pessoas");
  await q(supabase.from("pessoa_vinculos").insert({
    condominio_id: ctx.condominioId, pessoa_id: p.id,
    unidade_id: f.unidade || null, papel: PAPEL_ENUM[f.papel] || "morador",
    inicio: f.inicio || new Date().toISOString().slice(0, 10),
  }).select(), "pessoa_vinculos");
}

export async function criarLancamento(ctx, f) {
  const uid = precisaUsuario(ctx);
  const tipo = f.tipo === "Receita" ? "receita" : "despesa";
  let cat = ctx.categorias.find((c) => c.nome.toLowerCase() === String(f.categoria).toLowerCase());
  if (!cat) cat = (await q(supabase.from("categorias_financeiras").insert({ condominio_id: ctx.condominioId, nome: f.categoria, tipo }).select(), "categorias"))[0];
  await q(supabase.from("lancamentos").insert({
    condominio_id: ctx.condominioId, tipo, categoria_id: cat.id,
    descricao: f.desc || f.categoria, valor: parseBRL(f.valor),
    data: f.data || new Date().toISOString().slice(0, 10),
    competencia: f.competencia || new Date().toISOString().slice(0, 7),
    centro_custo: f.centro || null, forma_pagamento: FORMA_ENUM[f.forma] || null,
    status: "aguardando_aprovacao", lancado_por: uid,
  }).select(), "lancamentos");
}

export async function criarPenalidade(ctx, f) {
  const uid = precisaUsuario(ctx);
  const tipo = String(f.tipo || "").startsWith("Multa") ? "multa" : "advertencia";
  const ano = new Date().getFullYear();
  await q(supabase.from("penalidades").insert({
    condominio_id: ctx.condominioId, numero: `${ano}-${String(ctx.maxPenalidade + 1).padStart(3, "0")}`,
    tipo, unidade_id: f.unidade, categoria_infracao: f.categoria,
    descricao: f.desc || f.categoria, base_normativa: f.base || "Regimento interno",
    ocorrida_em: f.data ? new Date(f.data).toISOString() : new Date().toISOString(),
    valor: tipo === "multa" ? parseBRL(f.valor) : null,
    prazo_defesa: f.prazo || null,
    status: tipo === "multa" ? "em_defesa" : "registrada", registrada_por: uid,
  }).select(), "penalidades");
}

export async function decidirPenalidade(ctx, id, aprovar) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("penalidades").update({
    status: aprovar ? "aprovada" : "cancelada", decidida_por: uid,
    parecer: aprovar ? "Aprovada pelo síndico via painel." : "Cancelada pelo síndico via painel.",
  }).eq("id", id).select(), "penalidades");
}

export async function criarComunicado(ctx, f) {
  const uid = precisaUsuario(ctx);
  const canais = ["Portal", "E-mail", "WhatsApp", "Impressão"].filter((c) => f[`canal_${c}`])
    .map((c) => ({ Portal: "portal", "E-mail": "email", WhatsApp: "whatsapp", "Impressão": "portal" }[c]));
  const [com] = await q(supabase.from("comunicados").insert({
    condominio_id: ctx.condominioId, tipo: COMUNIC_TIPO_ENUM[f.tipo] || "comunicado",
    titulo: f.titulo, corpo: f.corpo || f.titulo, segmento: { descricao: f.segmento || "Todas as unidades" },
    canais: canais.length ? [...new Set(canais)] : ["portal"],
    publicado_em: new Date().toISOString(), publicado_por: uid,
  }).select(), "comunicados");
  if (ctx.pessoas.length)
    await q(supabase.from("comunicado_destinatarios").insert(ctx.pessoas.map((p) => ({ comunicado_id: com.id, pessoa_id: p.id }))).select(), "destinatários");
}

export async function criarChamado(ctx, f) {
  const uid = precisaUsuario(ctx);
  await q(supabase.from("chamados").insert({
    condominio_id: ctx.condominioId, numero: `OS-${ctx.maxOS + 1}`,
    categoria: CHAMADO_CAT_ENUM[f.categoria] || "area_comum", prioridade: PRIO_ENUM[f.prioridade] || "media",
    descricao: f.desc || "Sem descrição", status: "aberto", aberto_por: uid,
    responsavel_vinculo_id: f.responsavel || null, prazo: f.prazo || null,
    custo_estimado: f.custo ? parseBRL(f.custo) : null,
  }).select(), "chamados");
}

export async function criarPreAutorizacao(ctx, f) {
  const uid = precisaUsuario(ctx);
  const dia = f.data || new Date().toISOString().slice(0, 10);
  await q(supabase.from("pre_autorizacoes").insert({
    condominio_id: ctx.condominioId, tipo: PREAUT_TIPO_ENUM[f.tipo] || "visitante",
    nome: f.nome, unidade_id: f.unidade, autorizada_por: uid,
    valida_de: `${dia}T00:00:00-03:00`, valida_ate: `${dia}T23:59:59-03:00`,
    qr_token_hash: hex64(), veiculo_placa: f.placa || null,
  }).select(), "pre_autorizacoes");
  await q(supabase.from("acessos_portaria").insert({
    condominio_id: ctx.condominioId, tipo: "entrada", pessoa_nome: `${f.nome} (pré-autorizado)`,
    unidade_id: f.unidade, registrado_por: uid,
    detalhes: `Pré-autorização ${f.tipo || "visitante"} · janela ${f.janela || "dia todo"}`,
    ocorrido_em: new Date().toISOString(),
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
      /* usa o morador cadastrado em Gerenciar Emails: acha (ou cria) a pessoa e vincula à unidade */
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
      throw new Error("Esta unidade não tem responsável financeiro nem morador vinculado. Cadastre a pessoa na tela Pessoas ou o morador em Gerenciar Emails.");
    await q(supabase.from("cobrancas").insert({
      condominio_id: ctx.condominioId, unidade_id: u.id, responsavel_id: responsavelId,
      competencia, tipo: "extra", valor_original: total, vencimento, status: "emitida",
    }).select(), "cobrancas");
    return 1;
  }

  /* rateio: todas as unidades com responsável financeiro */
  const alvo = ctx.unidades.filter((u) => u.responsavelId);
  if (!alvo.length) throw new Error("Nenhuma unidade com responsável financeiro definido.");
  const somaFracao = alvo.reduce((s, u) => s + u.fracao, 0) || 1;
  const rows = alvo.map((u) => ({
    condominio_id: ctx.condominioId, unidade_id: u.id, responsavel_id: u.responsavelId,
    competencia, tipo: "ordinaria",
    valor_original: Math.round((total * u.fracao / somaFracao) * 100) / 100,
    vencimento, status: "emitida",
  }));
  const { error } = await supabase.from("cobrancas").insert(rows);
  if (error) {
    if (error.message.includes("uq_cobranca_ordinaria")) throw new Error(`Já existem cobranças ordinárias na competência ${compBR(competencia)}.`);
    throw new Error("cobranças: " + error.message);
  }
  return rows.length;
}
