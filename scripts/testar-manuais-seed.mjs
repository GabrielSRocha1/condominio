/* TEMPORÁRIO — monta o cenário de teste do fluxo de pagamentos manuais:
   diretor + condomínio (via API do dev server), licença ativada por código
   (send_invoice), moeda USD, carteira cripto = destinatário de uma
   transferência USDC REAL da Ethereum (permite testar a baixa automática
   on-chain sem gastar nada), bloco/unidade/morador com login e 4 cobranças:
     #1 = valor da USDC real (cripto auto-baixa)
     #2 = 100.00 (transferência com valor exato → informado)
     #3 = 120.00 (transferência com valor errado → divergente)
     #4 = 50.00  (dinheiro — botão do gestor) */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test")) { console.error("Chave Stripe não é de teste — abortado."); process.exit(1); }
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const BASE = "http://localhost:5173";
const SENHA = "teste123";
const EMAIL_DIRETOR = "diretor.manuais@teste.condomaster.dev";
const NOME_MORADOR = "Morador Manuais";

const api = async (rota, body, token) => {
  const r = await fetch(`${BASE}/api/${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};

/* 0) dev server de pé? */
for (let i = 0; ; i++) {
  try { await fetch(BASE); break; }
  catch { if (i > 20) { console.error("dev server não respondeu em localhost:5173"); process.exit(1); } await new Promise((r) => setTimeout(r, 2000)); }
}

/* 1) transferência USDC real na Ethereum (10–5000 USDC, últimos blocos) */
const rpc = async (method, params) => {
  const r = await fetch("https://ethereum-rpc.publicnode.com", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
};
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const alto = parseInt(await rpc("eth_blockNumber", []), 16);
const logs = await rpc("eth_getLogs", [{ address: USDC, topics: [TOPIC],
  fromBlock: "0x" + (alto - 20).toString(16), toBlock: "0x" + alto.toString(16) }]);
const escolhida = (logs || []).map((l) => ({
  tx: l.transactionHash, para: "0x" + l.topics[2].slice(-40), quantia: Number(BigInt(l.data)) / 1e6,
})).find((l) => l.quantia >= 10 && l.quantia <= 5000);
if (!escolhida) { console.error("Nenhuma transferência USDC 10–5000 nos últimos blocos — rode de novo."); process.exit(1); }
const valorCripto = Math.round(escolhida.quantia * 100) / 100;
console.log(`USDC real: ${escolhida.quantia} USDC → ${escolhida.para}\n  tx ${escolhida.tx}`);

/* 2) diretor + condomínio via API (como o navegador faria) */
let r = await api("auth/registrar", { nome: "Diretor Manuais", email: EMAIL_DIRETOR, senha: SENHA });
if (r.status === 409) r = await api("auth/login", { perfil: "diretor", email: EMAIL_DIRETOR, senha: SENHA });
if (!r.token) { console.error("registro/login do diretor falhou:", r); process.exit(1); }
let token = r.token, condominioId = r.conta?.condominioId || null;

if (!condominioId) {
  const c = await api("auth/condominio", {
    nome: "Condominio TESTE Manuais", cnpj: "99.888.777/0001-55", cpf: "000.000.002-72",
    endereco: "Rua do Teste, 123", tipo: "Residencial", porte: "Médio padrão", plano: "Essencial",
  }, token);
  if (!c.condominioId) { console.error("criação do condomínio falhou:", c); process.exit(1); }
  condominioId = c.condominioId; token = c.token;
}
console.log(`condomínio: ${condominioId}`);

/* 3) licença ativa por código de pagamento manual (send_invoice) */
const { data: assin } = await supabase.from("saas_assinaturas")
  .select("status").eq("condominio_id", condominioId).maybeSingle();
if (assin?.status !== "ativa") {
  const CUPOM = "condomaster-ativacao-100";
  if (!(await stripe.coupons.retrieve(CUPOM).catch(() => null)))
    await stripe.coupons.create({ id: CUPOM, percent_off: 100, duration: "forever", name: "Código de ativação (pagamento manual)" });
  const codigo = `TESTE-MAN-${Date.now().toString(36).toUpperCase()}`;
  await stripe.promotionCodes.create({ promotion: { type: "coupon", coupon: CUPOM }, code: codigo });
  const a = await api("stripe/assinatura", { condominioId, ciclo: "mensal", codigo }, token);
  console.log(`licença: ${a.ativado ? "ativada por código (send_invoice)" : JSON.stringify(a)}`);
} else console.log("licença: já ativa");

/* 4) config do condomínio: moeda USD + meios manuais (carteira = destinatário da USDC real) */
const { data: condRow } = await supabase.from("condominios").select("regras_internas").eq("id", condominioId).single();
await supabase.from("condominios").update({
  regras_internas: {
    ...(condRow?.regras_internas || {}),
    moeda: "USD",
    pagamentos: {
      ...(condRow?.regras_internas?.pagamentos || {}),
      verum_wallet: escolhida.para, dinheiro: true,
      banco: { banco: "Banco Teste", titular: "Condominio TESTE Manuais", iban: "US00 TEST 0000 1234", swift: "TESTUS33", conta: "12345-6", agencia: "0001" },
    },
  },
}).eq("id", condominioId);

/* 5) bloco/unidade/morador (com login) */
const umDe = async (tabela, filtro, criar) => {
  const { data } = await filtro.limit(1).maybeSingle();
  if (data) return data;
  const { data: novo, error } = await criar.select().single();
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return novo;
};
const bloco = await umDe("blocos",
  supabase.from("blocos").select("id").eq("condominio_id", condominioId).eq("nome", "A"),
  supabase.from("blocos").insert({ condominio_id: condominioId, nome: "A" }));
const unidade = await umDe("unidades",
  supabase.from("unidades").select("id").eq("condominio_id", condominioId).eq("numero", "101"),
  supabase.from("unidades").insert({
    condominio_id: condominioId, bloco_id: bloco.id, numero: "101", tipo: "apartamento",
    andar: 1, status: "ocupada", fracao_ideal: 1, area_privativa_m2: 100,
  }));
const pessoa = await umDe("pessoas",
  supabase.from("pessoas").select("id").eq("condominio_id", condominioId).eq("nome", NOME_MORADOR),
  supabase.from("pessoas").insert({
    condominio_id: condominioId, nome: NOME_MORADOR, tipo_pessoa: "fisica",
    cpf_cnpj: "000.000.001-91", email: "morador.manuais@teste.condomaster.dev",
  }));
const { data: vinc } = await supabase.from("pessoa_vinculos").select("id")
  .eq("pessoa_id", pessoa.id).eq("papel", "morador").limit(1).maybeSingle();
if (!vinc) await supabase.from("pessoa_vinculos").insert({
  condominio_id: condominioId, pessoa_id: pessoa.id, unidade_id: unidade.id,
  papel: "morador", inicio: new Date().toISOString().slice(0, 10),
});
await supabase.from("unidades").update({ responsavel_financeiro_id: pessoa.id }).eq("id", unidade.id);

const { data: uMor } = await supabase.from("usuarios").select("id")
  .eq("email", "morador.manuais@teste.condomaster.dev").maybeSingle();
let usuarioMorador = uMor;
if (!usuarioMorador) {
  const { data: novo, error } = await supabase.from("usuarios").insert({
    email: "morador.manuais@teste.condomaster.dev",
    senha_hash: createHash("sha256").update(SENHA).digest("hex"), pessoa_id: pessoa.id,
  }).select("id").single();
  if (error) throw new Error(error.message);
  usuarioMorador = novo;
  const { data: perfilMorador } = await supabase.from("perfis").select("id").eq("nome", "morador").single();
  await supabase.from("usuario_perfis").insert({
    usuario_id: usuarioMorador.id, condominio_id: condominioId, perfil_id: perfilMorador.id,
  });
}

/* 6) as 4 cobranças do roteiro */
const competencia = new Date().toISOString().slice(0, 7);
const vencimento = `${competencia}-28`;
const { data: jaTem } = await supabase.from("cobrancas").select("id").eq("condominio_id", condominioId).limit(1).maybeSingle();
if (!jaTem) {
  const valores = [valorCripto, 100, 120, 50];
  for (const v of valores) {
    const { error } = await supabase.from("cobrancas").insert({
      condominio_id: condominioId, unidade_id: unidade.id, responsavel_id: pessoa.id,
      competencia, tipo: "extra", valor_original: v, vencimento, status: "emitida",
    });
    if (error) throw new Error(`cobrancas: ${error.message}`);
  }
  console.log(`4 cobranças emitidas (US$ ${valores.join(" / ")})`);
} else console.log("cobranças: já existem — mantidas");

console.log(`\n══════════ CENÁRIO PRONTO ══════════
Diretor : ${EMAIL_DIRETOR} / ${SENHA}
Morador : nome "${NOME_MORADOR}" / ${SENHA}  (unidade 101-A)
Cripto  : cobrança de US$ ${valorCripto} ← hash ${escolhida.tx}
Roteiro : US$ ${valorCripto} = cripto auto-baixa · 100 = transferência ok ·
          120 = transferência divergente (informe 110) · 50 = dinheiro`);
