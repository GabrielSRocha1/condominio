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

/* descobre o condomínio dono de uma subscription (metadata → banco) */
export async function condominioDaSub(supabase, sub) {
  if (sub.metadata?.condominio_id) return sub.metadata.condominio_id;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const { data } = await supabase.from("saas_assinaturas").select("condominio_id")
    .or(`stripe_subscription_id.eq.${sub.id}${customer ? `,stripe_customer_id.eq.${customer}` : ""}`)
    .limit(1).maybeSingle();
  return data?.condominio_id || null;
}

/* ── split e taxas das cobranças condominiais ──
   A plataforma retém 1% do valor de face (application fee, sempre).
   Com o repasse ativo, a "taxa de conveniência" somada ao checkout cobre a
   taxa Stripe do método + o 1% — o condomínio recebe o valor cheio.
   Percentuais de referência do Stripe Brasil; confirme os da sua conta no
   dashboard (Configurações → Tarifas) e ajuste aqui se divergirem. */
export const APP_FEE_PCT = 0.01;
export const TAXAS_METODO = {
  pix:  { pct: 0.0119, fixo: 0 },
  card: { pct: 0.0399, fixo: 0.39 },
};

/* total (em centavos) a cobrar do morador para o condomínio receber o valor
   líquido exato:  total = (valor·(1 + 1%) + fixo) / (1 − pct) */
export const totalComRepasse = (valor, metodo) => {
  const t = TAXAS_METODO[metodo] || TAXAS_METODO.card;
  return Math.round(((valor * (1 + APP_FEE_PCT) + t.fixo) / (1 - t.pct)) * 100);
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
