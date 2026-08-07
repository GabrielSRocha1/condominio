/* POST /api/commet/assinatura  { condominioId }
   Cria (ou reaproveita) o plano e o cliente no Commet e abre uma ASSINATURA
   recorrente da licença SaaS do condomínio — devolve { checkoutUrl }.
   A confirmação chega depois pelo webhook (subscription.activated). */
import { Commet } from "@commet/node";
import { createClient } from "@supabase/supabase-js";

/* variáveis ainda com o placeholder do .env contam como não preenchidas */
const envVal = (k) => { const v = (process.env[k] || "").trim(); return v && !v.startsWith("COLE_AQUI") ? v : undefined; };
const supabase = createClient(
  envVal("SUPABASE_URL") || process.env.VITE_SUPABASE_URL,
  envVal("SUPABASE_SERVICE_ROLE_KEY") || process.env.VITE_SUPABASE_ANON_KEY
);

/* o SDK ora devolve { success, data, error }, ora o objeto direto — normaliza */
const dado = (r) => (r && typeof r === "object" && "data" in r ? r.data : r);
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.COMMET_API_KEY || process.env.COMMET_API_KEY.startsWith("COLE_AQUI"))
    return res.status(503).json({ error: "COMMET_API_KEY não configurada no .env do servidor." });

  try {
    const { condominioId, ciclo } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!condominioId) return res.status(400).json({ error: "Informe condominioId." });

    const { data: ass, error } = await supabase
      .from("saas_assinaturas")
      .select("id, status, condominios(id, nome_fantasia, cnpj), saas_planos(id, nome, preco_mensal, preco_anual)")
      .eq("condominio_id", condominioId)
      .neq("status", "cancelada")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ass) return res.status(404).json({ error: "Condomínio sem assinatura cadastrada." });
    if (ass.status === "ativa") return res.status(409).json({ error: "A licença deste condomínio já está ativa." });

    const commet = new Commet({ apiKey: process.env.COMMET_API_KEY });
    const plano = ass.saas_planos;
    /* cobrança sempre em dólar (USD): a conta Commet deve estar configurada em USD.
       O sufixo _usd separa estes planos dos antigos criados com preço em real. */
    const codigo = `condomaster_${slug(plano.nome)}_usd`;
    /* o nome também precisa ser único: já existe um "CondoMaster <plano>" antigo (em BRL)
       na Commet, e ela recusa dois planos com o mesmo nome */
    const nomeCommet = `CondoMaster ${plano.nome} (USD)`;
    const anual = ciclo === "anual" && Number(plano.preco_anual) > 0;
    const intervalo = anual ? "yearly" : "monthly";

    /* plano no Commet: reaproveita pelo code ou pelo nome; cria com os preços mensal e anual se não existir */
    const planos = dado(await commet.plans.list({ includePrivate: true })) || [];
    let planoCommet = planos.find((p) => p.code === codigo || p.name === nomeCommet);
    if (!planoCommet) {
      planoCommet = dado(await commet.plans.create({ name: nomeCommet, code: codigo, isPublic: false }));
      if (!planoCommet?.id) return res.status(502).json({ error: "Commet não criou o plano." });
      await commet.plans.addPrice({
        id: planoCommet.id,
        billingInterval: "monthly",
        price: Math.round(Number(plano.preco_mensal) * 100), // centavos de dólar
        isDefault: true,
      });
      if (Number(plano.preco_anual) > 0) {
        await commet.plans.addPrice({
          id: planoCommet.id,
          billingInterval: "yearly",
          price: Math.round(Number(plano.preco_anual) * 100), // centavos de dólar
        });
      }
    }

    /* cliente no Commet: 1 por condomínio, identificado pelo externalId */
    const cond = ass.condominios;
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("email, pessoas!inner(condominio_id)")
      .eq("pessoas.condominio_id", condominioId)
      .limit(1)
      .maybeSingle();

    let cliente = dado(await commet.customers.get({ id: condominioId }).catch(() => null));
    if (!cliente?.id) {
      cliente = dado(await commet.customers.create({
        externalId: condominioId,
        fullName: cond.nome_fantasia,
        taxDocument: cond.cnpj || undefined,
        email: usuario?.email || `licenca+${condominioId.slice(0, 8)}@condomaster.app`,
        metadata: { condominioId },
      }));
    }
    if (!cliente?.id) return res.status(502).json({ error: "Commet não criou o cliente." });

    const origem = req.headers.origin || `https://${req.headers.host}`;
    const resposta = await commet.subscriptions.create({
      planId: planoCommet.id,
      customerId: cliente.id,
      billingInterval: intervalo,
      skipTrial: true,
      name: `Licença CondoMaster · ${cond.nome_fantasia}`,
      successUrl: `${origem}/?licenca=ok`,
    });
    if (resposta?.error) return res.status(502).json({ error: `Commet: ${resposta.error.message || resposta.error}` });
    const assinatura = dado(resposta);
    const urlCheckout = assinatura?.checkoutUrl || assinatura?.url;
    if (!urlCheckout) return res.status(502).json({ error: "Commet não devolveu a URL de checkout da assinatura." });

    return res.status(200).json({ checkoutUrl: urlCheckout, subscriptionId: assinatura.id });
  } catch (e) {
    console.error("[commet/assinatura]", e);
    return res.status(500).json({ error: e.message || "Erro ao criar a assinatura." });
  }
}
