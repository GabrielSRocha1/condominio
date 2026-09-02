/* POST /api/stripe/checkout-cobranca  { cobrancaId, metodo: "pix" | "card" }
   (Authorization: Bearer — qualquer perfil do condomínio da cobrança)
   Abre o Stripe Checkout de UMA cobrança condominial como DIRECT CHARGE na
   conta conectada do condomínio (merchant of record = condomínio; recibo no
   nome dele) com application_fee_amount = 1% do valor de face para a
   plataforma. Só funciona com a conta conectada ativa E moeda de gestão BRL
   (Pix/cartão da Stripe Brasil são em reais) — nos demais casos os meios
   manuais (Verum Wallet / transferência / dinheiro) continuam valendo.
   Com o repasse ativo (regras_internas.pagamentos.stripe_repasse), a taxa do
   método vira a linha "Taxa de conveniência" e o condomínio recebe o valor
   cheio. Devolve { checkoutUrl }. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, integracaoStripe, totalComRepasse, APP_FEE_PCT } from "./_lib/comum.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "STRIPE_SECRET_KEY não configurada no .env do servidor." });
  const supabase = supabaseAdmin();

  try {
    const { cobrancaId } = corpoJson(req);
    const metodo = corpoJson(req).metodo === "pix" ? "pix" : "card";
    if (!cobrancaId) return res.status(400).json({ error: "Informe cobrancaId." });
    const claims = lerClaims(req);
    if (!claims?.condominio_id) return res.status(401).json({ error: "Sessão inválida — entre de novo." });
    const condominioId = claims.condominio_id;

    const { data: cobranca, error } = await supabase.from("cobrancas")
      .select("id, condominio_id, competencia, valor_original, vencimento, status, unidades(numero, blocos(nome))")
      .eq("id", cobrancaId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!cobranca || cobranca.condominio_id !== condominioId)
      return res.status(404).json({ error: "Cobrança não encontrada." });
    if (["paga", "paga_em_atraso"].includes(cobranca.status))
      return res.status(409).json({ error: "Esta cobrança já está paga." });
    if (!["emitida", "vencida", "rascunho"].includes(cobranca.status))
      return res.status(409).json({ error: "Esta cobrança não está aberta para pagamento." });

    const { data: cond } = await supabase.from("condominios")
      .select("nome_fantasia, regras_internas").eq("id", condominioId).maybeSingle();
    const moeda = cond?.regras_internas?.moeda || "USD";
    if (moeda !== "BRL")
      return res.status(409).json({ error: "O pagamento online exige moeda de gestão em reais (BRL) — use os meios de pagamento informados pelo condomínio." });

    const integ = await integracaoStripe(supabase, condominioId);
    const accountId = integ?.credenciais?.account_id;
    if (!accountId || !integ?.credenciais?.charges_enabled)
      return res.status(409).json({ error: "O condomínio ainda não ativou o recebimento online — use os meios de pagamento informados." });

    const valor = Number(cobranca.valor_original);
    const baseCentavos = Math.round(valor * 100);
    const repasse = cond?.regras_internas?.pagamentos?.stripe_repasse === true;
    const taxaCentavos = repasse ? Math.max(0, totalComRepasse(valor, metodo) - baseCentavos) : 0;

    const unidade = cobranca.unidades
      ? `${cobranca.unidades.numero}${cobranca.unidades.blocos?.nome ? `-${cobranca.unidades.blocos.nome}` : ""}` : "";
    const compBR = `${cobranca.competencia.slice(5, 7)}/${cobranca.competencia.slice(0, 4)}`;

    const line_items = [{
      price_data: {
        currency: "brl",
        product_data: { name: `Taxa condominial ${compBR}${unidade ? ` · Unidade ${unidade}` : ""}` },
        unit_amount: baseCentavos,
      },
      quantity: 1,
    }];
    if (taxaCentavos > 0) line_items.push({
      price_data: {
        currency: "brl",
        product_data: { name: "Taxa de conveniência (pagamento online)" },
        unit_amount: taxaCentavos,
      },
      quantity: 1,
    });

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: [metodo],
      line_items,
      payment_intent_data: {
        /* o 1% da plataforma incide sempre sobre o valor de face */
        application_fee_amount: Math.round(baseCentavos * APP_FEE_PCT),
        description: `Cobrança condominial ${compBR} · ${cond?.nome_fantasia || ""}`.trim(),
      },
      metadata: { cobranca_id: cobranca.id, condominio_id: condominioId },
      ...(metodo === "pix" ? { payment_method_options: { pix: { expires_after_seconds: 3600 } } } : {}),
      success_url: `${origem}/?pagamento=ok&cobranca=${cobranca.id}`,
      cancel_url: `${origem}/`,
    }, { stripeAccount: accountId });

    /* rastro para a tela Cobranças (coluna "Transação") — o webhook troca
       pelo charge id definitivo quando o pagamento confirmar */
    await supabase.from("cobrancas").update({ provider_charge_id: session.id }).eq("id", cobranca.id);

    return res.status(200).json({ checkoutUrl: session.url, total: (baseCentavos + taxaCentavos) / 100, taxa: taxaCentavos / 100 });
  } catch (e) {
    console.error("[stripe/checkout-cobranca]", e);
    return res.status(500).json({ error: e.message || "Erro ao abrir o pagamento da cobrança." });
  }
}
