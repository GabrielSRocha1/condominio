/* POST /api/commet/checkout  { cobrancaId }
   Cria um link de pagamento Commet para a cobrança e devolve { checkoutUrl }.
   Roda no servidor (Vercel/Netlify functions) — é aqui que a COMMET_API_KEY
   secreta é usada; ela nunca chega ao navegador. */
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => (process.env[k] && !process.env[k].startsWith("COLE_AQUI") ? process.env[k] : undefined);
const supabase = createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

/* o SDK ora devolve { success, data, error }, ora o objeto direto — normaliza */
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.COMMET_API_KEY || process.env.COMMET_API_KEY.startsWith("COLE_AQUI"))
    return res.status(503).json({ error: "COMMET_API_KEY não configurada no .env do servidor." });

  try {
    const { cobrancaId } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!cobrancaId) return res.status(400).json({ error: "Informe cobrancaId." });

    const { data: cob, error } = await supabase
      .from("cobrancas")
      .select("id, valor_original, encargos, competencia, status, provider_charge_id, unidades(numero, blocos(nome)), pessoas(nome, email)")
      .eq("id", cobrancaId)
      .single();
    if (error || !cob) return res.status(404).json({ error: "Cobrança não encontrada." });
    if (cob.status === "paga" || cob.status === "paga_em_atraso")
      return res.status(409).json({ error: "Esta cobrança já está paga." });

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    const valor = Number(cob.valor_original || 0) + Number(cob.encargos || 0);
    const unidade = cob.unidades ? `${cob.unidades.numero}-${cob.unidades.blocos?.nome || ""}` : "";
    const origem = req.headers.origin || `https://${req.headers.host}`;

    const resposta = await commet.payments.create({
      amount: Math.round(valor * 100), // Commet trabalha em centavos
      currency: process.env.COMMET_CURRENCY || "brl",
      description: `Condomínio ${cob.competencia} · unidade ${unidade}`.trim(),
      successUrl: `${origem}/?pagamento=ok`,
      metadata: { cobrancaId: cob.id },
    });
    if (resposta?.error) return res.status(502).json({ error: `Commet: ${resposta.error.message || resposta.error}` });
    const pagamento = dado(resposta);
    /* SDKs antigos devolvem checkoutUrl; o 7.x devolve url */
    const urlCheckout = pagamento?.checkoutUrl || pagamento?.url;
    if (!urlCheckout) return res.status(502).json({ error: "Commet não devolveu a URL de checkout." });

    /* guarda o id do pagamento na cobrança — o webhook usa isso para dar baixa */
    await supabase.from("cobrancas").update({ provider_charge_id: pagamento.id }).eq("id", cob.id);

    return res.status(200).json({ checkoutUrl: urlCheckout, paymentId: pagamento.id });
  } catch (e) {
    console.error("[commet/checkout]", e);
    return res.status(500).json({ error: e.message || "Erro ao criar o pagamento." });
  }
}
