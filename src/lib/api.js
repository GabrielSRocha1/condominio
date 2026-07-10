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
export async function loadAll() {
  const tenantsRaw = await q(
    supabase.from("condominios").select("id, nome_fantasia, saas_assinaturas(status, renovacao, saas_planos(nome, preco_mensal)), unidades(count)").order("criado_em"),
    "condominios"
  );
  if (!tenantsRaw.length) return { vazio: true }; // banco em branco: o app mostra o fluxo de primeiro acesso
  /* condomínio principal = o que tem mais unidades cadastradas */
  const principal = [...tenantsRaw].sort((a, b) => (b.unidades?.[0]?.count ?? 0) - (a.unidades?.[0]?.count ?? 0))[0];
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
    q(supabase.from("usuarios").select("id, pessoa_id").order("criado_em").limit(1), "usuarios"),
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
      id: c.id, tipo: COMUNIC_TIPO_LABEL[c.tipo] || c.tipo, titulo: c.titulo,
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
    usuarioId: usuarios[0]?.id || null,
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
  const [usuario] = await q(supabase.from("usuarios").insert({
    pessoa_id: pessoa.id, email: diretor?.email || `diretor+${Date.now()}@local`,
    senha_hash: await sha256(diretor?.senha || crypto.randomUUID()),
  }).select(), "usuarios");
  const perfil = await q(supabase.from("perfis").select("id").eq("nome", "diretor").single(), "perfis");
  await q(supabase.from("usuario_perfis").insert({
    usuario_id: usuario.id, condominio_id: cond.id, perfil_id: perfil.id,
  }).select(), "usuario_perfis");
}

/* "Já tem prédio cadastrado": confere e-mail e senha na tabela usuarios
   e exige que a conta tenha o perfil de diretor em algum condomínio. */
export async function loginDiretor(email, senha) {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, email, senha_hash, pessoas(nome), usuario_perfis(perfis(nome))")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.senha_hash !== (await sha256(senha))) return null;
  const ehDiretor = (data.usuario_perfis || []).some((up) => up.perfis?.nome === "diretor");
  if (!ehDiretor) return null;
  return { nome: data.pessoas?.nome || "Diretor", email: data.email, senha };
}

const precisaUsuario = (ctx) => {
  if (!ctx.usuarioId) throw new Error("Nenhum usuário cadastrado no banco (rode o seed).");
  return ctx.usuarioId;
};

export async function criarUnidade(ctx, f) {
  let bloco = ctx.blocos.find((b) => b.nome.toLowerCase() === String(f.bloco || "").trim().toLowerCase());
  if (!bloco) bloco = (await q(supabase.from("blocos").insert({ condominio_id: ctx.condominioId, nome: String(f.bloco || "A").trim() }).select(), "blocos"))[0];
  await q(supabase.from("unidades").insert({
    condominio_id: ctx.condominioId, bloco_id: bloco.id, numero: f.numero,
    tipo: UNIDADE_TIPO_ENUM[f.tipo] || "apartamento", andar: f.andar ? Number(f.andar) : null,
    status: UNIDADE_STATUS_ENUM[f.status] || "vaga", fracao_ideal: parseBRL(f.fracao),
  }).select(), "unidades");
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
  const alvo = ctx.unidades.filter((u) => u.responsavelId);
  if (!alvo.length) throw new Error("Nenhuma unidade com responsável financeiro definido.");
  const total = parseBRL(f.total);
  if (!total) throw new Error("Informe o valor total a ratear.");
  const somaFracao = alvo.reduce((s, u) => s + u.fracao, 0) || 1;
  const competencia = f.competencia || new Date().toISOString().slice(0, 7);
  const rows = alvo.map((u) => ({
    condominio_id: ctx.condominioId, unidade_id: u.id, responsavel_id: u.responsavelId,
    competencia, tipo: "ordinaria",
    valor_original: Math.round((total * u.fracao / somaFracao) * 100) / 100,
    vencimento: f.vencimento || `${competencia}-10`, status: "emitida",
  }));
  const { error } = await supabase.from("cobrancas").insert(rows);
  if (error) {
    if (error.message.includes("uq_cobranca_ordinaria")) throw new Error(`Já existem cobranças ordinárias na competência ${compBR(competencia)}.`);
    throw new Error("cobranças: " + error.message);
  }
  return rows.length;
}
