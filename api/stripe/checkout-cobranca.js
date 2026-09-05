/* POST /api/stripe/checkout-cobranca  { cobrancaId, metodo: "pix"|"card"|"auto" }
   (Authorization: Bearer — qualquer perfil do condomínio da cobrança)
   Abre o Stripe Checkout de UMA cobrança condominial como DIRECT CHARGE na
   conta conectada do condomínio (merchant of record = condomínio; recibo no
   nome dele) com application_fee_amount = 1% do valor de face com teto de
   1 unidade da moeda (min(1%, R$ 1/US$ 1…)) para a plataforma. Exige conta conectada ativa E moeda de gestão IGUAL à moeda da
   conta Stripe (a cobrança é cobrada na mesma moeda; sem conversão) — nos
   demais casos os meios manuais continuam valendo.
   Conta BRL: metodo explícito (pix|card) com taxas específicas. Demais
   moedas: métodos dinâmicos da Stripe (cartão, wallets, débitos locais) e,
   com o repasse ativo, gross-up pela taxa de CARTÃO da região (teto).
   Com o repasse ativo (regras_internas.pagamentos.stripe_repasse), a taxa
   vira a linha "Taxa de conveniência" e o condomínio recebe o valor cheio.
   Devolve { checkoutUrl, total, taxa }. */
import { stripeClient, supabaseAdmin, corpoJson, lerClaims, integracaoStripe, totalComRepasse, appFee, paraMenorUnidade, deMenorUnidade } from "./_lib/comum.js";

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

    const integ = await integracaoStripe(supabase, condominioId);
    const accountId = integ?.credenciais?.account_id;
    if (!accountId || !integ?.credenciais?.charges_enabled)
      return res.status(409).json({ error: "O condomínio ainda não ativou o recebimento online — use os meios de pagamento informados." });

    const contaMoeda = String(integ.credenciais.moeda || "BRL").toUpperCase();
    if (moeda !== contaMoeda)
      return res.status(409).json({ error: `O pagamento online exige a moeda de gestão igual à da conta de recebimento (${contaMoeda}) — use os meios de pagamento informados pelo condomínio.` });
    const ehBRL = contaMoeda === "BRL";
    if (!ehBRL && metodo === "pix")
      return res.status(409).json({ error: "Pix está disponível apenas para contas do Brasil." });

    const valor = Number(cobranca.valor_original);
    const baseCentavos = paraMenorUnidade(valor, contaMoeda);
    const repasse = cond?.regras_internas?.pagamentos?.stripe_repasse === true;
    const taxaCentavos = repasse ? Math.max(0, totalComRepasse(valor, metodo, contaMoeda) - baseCentavos) : 0;

    const unidade = cobranca.unidades
      ? `${cobranca.unidades.numero}${cobranca.unidades.blocos?.nome ? `-${cobranca.unidades.blocos.nome}` : ""}` : "";
    const compBR = `${cobranca.competencia.slice(5, 7)}/${cobranca.competencia.slice(0, 4)}`;

    const line_items = [{
      price_data: {
        currency: contaMoeda.toLowerCase(),
        product_data: { name: `Taxa condominial ${compBR}${unidade ? ` · Unidade ${unidade}` : ""}` },
        unit_amount: baseCentavos,
      },
      quantity: 1,
    }];
    if (taxaCentavos > 0) line_items.push({
      price_data: {
        currency: contaMoeda.toLowerCase(),
        product_data: { name: "Taxa de conveniência (pagamento online)" },
        unit_amount: taxaCentavos,
      },
      quantity: 1,
    });

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      /* BRL mantém o método explícito (botões Pix/Cartão com taxas próprias);
         nas demais moedas a Stripe decide os métodos do país (dinâmicos) */
      ...(ehBRL ? { payment_method_types: [metodo] } : {}),
      line_items,
      payment_intent_data: {
        /* taxa da plataforma: 1% do valor de face, teto de 1 unidade da moeda */
        application_fee_amount: paraMenorUnidade(appFee(valor), contaMoeda),
        description: `Cobrança condominial ${compBR} · ${cond?.nome_fantasia || ""}`.trim(),
      },
      metadata: { cobranca_id: cobranca.id, condominio_id: condominioId },
      ...(ehBRL && metodo === "pix" ? { payment_method_options: { pix: { expires_after_seconds: 3600 } } } : {}),
      success_url: `${origem}/?pagamento=ok&cobranca=${cobranca.id}`,
      cancel_url: `${origem}/`,
    }, { stripeAccount: accountId });

    /* rastro para a tela Cobranças (coluna "Transação") — o webhook troca
       pelo charge id definitivo quando o pagamento confirmar */
    await supabase.from("cobrancas").update({ provider_charge_id: session.id }).eq("id", cobranca.id);

    return res.status(200).json({
      checkoutUrl: session.url,
      total: deMenorUnidade(baseCentavos + taxaCentavos, contaMoeda),
      taxa: deMenorUnidade(taxaCentavos, contaMoeda),
    });
  } catch (e) {
    console.error("[stripe/checkout-cobranca]", e);
    return res.status(500).json({ error: e.message || "Erro ao abrir o pagamento da cobrança." });
  }
}
