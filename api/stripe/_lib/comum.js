/* Utilidades compartilhadas dos endpoints /api/stripe/*.
   O prefixo "_" impede esta pasta de virar rota — tanto na Vercel quanto no
   plugin apiDev do Vite (que só resolve api/<rota>.js a partir da URL). */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
export const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };

export const supabaseAdmin = () => createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

/* null quando STRIPE_SECRET_KEY não está configurada — o handler responde 503 */
export const stripeClient = () => {
  const chave = envVal("STRIPE_SECRET_KEY");
  return chave ? new Stripe(chave) : null;
};

export const corpoJson = (req) => (typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}));

/* corpo bruto para validar a assinatura do webhook (stripe-signature exige o
   payload exato). Em dev o plugin apiDev já injeta req.body como string. */
export const lerCorpoBruto = (req) =>
  new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

/* claims do JWT caseiro (mesmo formato assinado em api/auth/*) — null se
   ausente/expirado/adulterado. Todos os endpoints Stripe exigem sessão. */
export const lerClaims = (req) => {
  const secret = envVal("SUPABASE_JWT_SECRET");
  if (!secret) return null;
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const [h, p, sig] = String(token || "").split(".");
    const esperada = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(esperada))) return null;
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (claims.exp && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch { return null; }
};

export const dataISO = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);
export const hojeISO = () => new Date().toISOString().slice(0, 10);
export const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
export const lookupKey = (nomePlano, ciclo) => `condomaster_${slug(nomePlano)}_${ciclo === "anual" ? "anual" : "mensal"}_brl`;

/* ── licença SaaS: espelha uma subscription da Stripe no status local ──
   Mapeia o ESTADO VIVO (não o delta do evento) — imune a eventos fora de
   ordem e a reentregas. "cancelada" local é terminal (.neq), como sempre. */
const MAPA_STATUS = {
  trialing: "teste", active: "ativa",
  past_due: "inadimplente", unpaid: "inadimplente",
  canceled: "cancelada", incomplete_expired: "cancelada",
};
export async function sincronizarLicenca(supabase, sub, condominioId) {
  const status = MAPA_STATUS[sub.status];
  if (!status || !condominioId) return null; // incomplete/paused: checkout em andamento — não toca
  /* na API atual da Stripe o fim do período vive no item da assinatura */
  const fimPeriodo = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
  const novo = { status, stripe_subscription_id: sub.id };
  if (typeof sub.customer === "string") novo.stripe_customer_id = sub.customer;
  if (status === "teste" && sub.trial_end) novo.teste_fim = dataISO(sub.trial_end);
  if (status === "ativa") {
    novo.bloqueada_em = null;
    if (fimPeriodo) novo.renovacao = dataISO(fimPeriodo);
  }
  const { error } = await supabase.from("saas_assinaturas").update(novo)
    .eq("condominio_id", condominioId).neq("status", "cancelada");
  if (error) console.error("[stripe] licença não atualizada:", error.message);

  /* aviso de cancelamento agendado da tela Planos (acesso segue até o fim
     do período; a data do pedido só é gravada uma vez) */
  if (status === "ativa" || status === "teste") {
    if (sub.cancel_at_period_end) {
      const fimAcesso = dataISO(sub.cancel_at) || dataISO(fimPeriodo) || dataISO(sub.trial_end);
      await supabase.from("saas_assinaturas").update({ acesso_ate: fimAcesso })
        .eq("condominio_id", condominioId).neq("status", "cancelada");
      await supabase.from("saas_assinaturas").update({ cancelamento_agendado_em: hojeISO() })
        .eq("condominio_id", condominioId).neq("status", "cancelada")
        .is("cancelamento_agendado_em", null);
    } else {
      await supabase.from("saas_assinaturas").update({ cancelamento_agendado_em: null, acesso_ate: null })
        .eq("condominio_id", condominioId).neq("status", "cancelada");
    }
  }
  return status;
}

/* descobre o condomínio dono de uma subscription (metadata → banco).
   Os ids entram num filtro .or() interpolado do PostgREST — só passam se
   tiverem o formato exato da Stripe (nada de vírgula/parêntese injetável). */
const ID_STRIPE = /^(sub|cus)_[A-Za-z0-9]{8,64}$/;
export async function condominioDaSub(supabase, sub) {
  if (sub.metadata?.condominio_id) return sub.metadata.condominio_id;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const subOk = ID_STRIPE.test(String(sub.id || ""));
  const cusOk = ID_STRIPE.test(String(customer || ""));
  if (!subOk && !cusOk) return null;
  const filtros = [];
  if (subOk) filtros.push(`stripe_subscription_id.eq.${sub.id}`);
  if (cusOk) filtros.push(`stripe_customer_id.eq.${customer}`);
  const { data } = await supabase.from("saas_assinaturas").select("condominio_id")
    .or(filtros.join(",")).limit(1).maybeSingle();
  return data?.condominio_id || null;
}

/* ── países onde a Stripe abre conta conectada MERCHANT para uma plataforma
   brasileira (direct charges). PY/AR/BO/CO ficam de fora por limite da
   própria Stripe (lá só existe "cross-border payouts", indisponível para
   plataformas fora de US/UK/EEA/CA/CH). Habilite os países desejados também
   em Dashboard → Connect → Configurações (onboarding por país). */
export const PAISES_CONNECT = {
  BR: { nome: "Brasil", moeda: "BRL" },
  US: { nome: "Estados Unidos", moeda: "USD" },
  CA: { nome: "Canadá", moeda: "CAD" },
  MX: { nome: "México", moeda: "MXN" },
  PT: { nome: "Portugal", moeda: "EUR" },
  ES: { nome: "Espanha", moeda: "EUR" },
  FR: { nome: "França", moeda: "EUR" },
  DE: { nome: "Alemanha", moeda: "EUR" },
  IT: { nome: "Itália", moeda: "EUR" },
  NL: { nome: "Holanda", moeda: "EUR" },
  BE: { nome: "Bélgica", moeda: "EUR" },
  AT: { nome: "Áustria", moeda: "EUR" },
  IE: { nome: "Irlanda", moeda: "EUR" },
  LU: { nome: "Luxemburgo", moeda: "EUR" },
  FI: { nome: "Finlândia", moeda: "EUR" },
  GR: { nome: "Grécia", moeda: "EUR" },
  CY: { nome: "Chipre", moeda: "EUR" },
  MT: { nome: "Malta", moeda: "EUR" },
  SK: { nome: "Eslováquia", moeda: "EUR" },
  SI: { nome: "Eslovênia", moeda: "EUR" },
  EE: { nome: "Estônia", moeda: "EUR" },
  LV: { nome: "Letônia", moeda: "EUR" },
  LT: { nome: "Lituânia", moeda: "EUR" },
  HR: { nome: "Croácia", moeda: "EUR" },
  GB: { nome: "Reino Unido", moeda: "GBP" },
  CH: { nome: "Suíça", moeda: "CHF" },
  DK: { nome: "Dinamarca", moeda: "DKK" },
  SE: { nome: "Suécia", moeda: "SEK" },
  NO: { nome: "Noruega", moeda: "NOK" },
  PL: { nome: "Polônia", moeda: "PLN" },
  CZ: { nome: "Tchéquia", moeda: "CZK" },
  HU: { nome: "Hungria", moeda: "HUF" },
  RO: { nome: "Romênia", moeda: "RON" },
  BG: { nome: "Bulgária", moeda: "BGN" },
  AU: { nome: "Austrália", moeda: "AUD" },
  NZ: { nome: "Nova Zelândia", moeda: "NZD" },
  JP: { nome: "Japão", moeda: "JPY" },
  SG: { nome: "Singapura", moeda: "SGD" },
  HK: { nome: "Hong Kong", moeda: "HKD" },
  MY: { nome: "Malásia", moeda: "MYR" },
  TH: { nome: "Tailândia", moeda: "THB" },
  AE: { nome: "Emirados Árabes", moeda: "AED" },
};

/* menor unidade por moeda (lista zero-decimal oficial da Stripe) — o resto
   do app trabalha em decimais; a fronteira com a API converte aqui */
const ZERO_DECIMAIS = new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]);
export const paraMenorUnidade = (valor, moeda) =>
  Math.round(Number(valor) * (ZERO_DECIMAIS.has(String(moeda || "").toUpperCase()) ? 1 : 100));
export const deMenorUnidade = (inteiro, moeda) =>
  Number(inteiro || 0) / (ZERO_DECIMAIS.has(String(moeda || "").toUpperCase()) ? 1 : 100);

/* ── split e taxas das cobranças condominiais ──
   A plataforma retém 1% do valor de face com TETO de 1 unidade da moeda da
   cobrança (application fee = min(1% × valor, 1): R$ 50 → R$ 0,50;
   R$ 100+ → R$ 1,00; mesma regra em US$/€/¥).
   Com o repasse ativo, a "taxa de conveniência" somada ao checkout cobre a
   taxa Stripe + a taxa da plataforma — o condomínio recebe o valor cheio.
   BRL: percentuais por método (Pix/cartão) da tabela Stripe Brasil.
   Demais moedas: aproximação pela taxa de CARTÃO da região (teto — com
   métodos dinâmicos o método só se conhece no checkout). Confira as tarifas
   da conta no dashboard (Configurações → Planos e tarifas) se divergirem. */
export const APP_FEE_PCT = 0.01;  // 1% do valor de face…
export const APP_FEE_FIXO = 1;    // …limitado a 1 unidade da moeda da cobrança
export const appFee = (valor) => Math.min(Number(valor) * APP_FEE_PCT, APP_FEE_FIXO);
export const TAXAS_METODO = {
  pix:  { pct: 0.0119, fixo: 0 },
  card: { pct: 0.0399, fixo: 0.39 },
};
export const TAXA_CARTAO_POR_MOEDA = {
  USD: { pct: 0.029, fixo: 0.30 },
  CAD: { pct: 0.029, fixo: 0.30 },
  MXN: { pct: 0.036, fixo: 3.00 },
  EUR: { pct: 0.015, fixo: 0.25 },
  GBP: { pct: 0.015, fixo: 0.20 },
  CHF: { pct: 0.029, fixo: 0.30 },
  DKK: { pct: 0.015, fixo: 1.80 },
  SEK: { pct: 0.015, fixo: 1.80 },
  NOK: { pct: 0.024, fixo: 2.00 },
  PLN: { pct: 0.015, fixo: 1.00 },
  CZK: { pct: 0.015, fixo: 6.50 },
  HUF: { pct: 0.015, fixo: 85 },
  RON: { pct: 0.015, fixo: 1.00 },
  BGN: { pct: 0.015, fixo: 0.50 },
  AUD: { pct: 0.0175, fixo: 0.30 },
  NZD: { pct: 0.027, fixo: 0.30 },
  JPY: { pct: 0.036, fixo: 0 },
  SGD: { pct: 0.034, fixo: 0.50 },
  HKD: { pct: 0.034, fixo: 2.35 },
  MYR: { pct: 0.03, fixo: 1.00 },
  THB: { pct: 0.0365, fixo: 10 },
  AED: { pct: 0.029, fixo: 1.00 },
};

/* total (na MENOR UNIDADE da moeda) a cobrar do morador para o condomínio
   receber o valor líquido exato: total = (valor + appFee(valor) + fixo) / (1 − pct) */
export const totalComRepasse = (valor, metodo, moeda = "BRL") => {
  const m = String(moeda).toUpperCase();
  const t = m === "BRL"
    ? (TAXAS_METODO[metodo] || TAXAS_METODO.card)
    : (TAXA_CARTAO_POR_MOEDA[m] || { pct: 0.029, fixo: 0.30 });
  return paraMenorUnidade((valor + appFee(valor) + t.fixo) / (1 - t.pct), m);
};

/* linha "conta conectada" do condomínio (provedor stripe) — null se não há */
export async function integracaoStripe(supabase, condominioId) {
  const { data, error } = await supabase.from("integracoes_pagamento")
    .select("id, credenciais, ativa")
    .eq("condominio_id", condominioId).eq("provedor", "stripe")
    .limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}
