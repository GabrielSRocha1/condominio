/* FASE 0 da dLocal Go — sonda de descoberta. NÃO é código de produção:
   nada em api/ é tocado, nenhuma tabela é criada. O objetivo é responder
   contra a API REAL (sandbox) o que o plano deixou em aberto:

     1. as credenciais valem?            → /v1/me (o doc divergia no verbo)
     2. existe POST /v1/collaborations?  → decide se o onboarding tem 1 ou 2
                                           passos manuais
     3. qual a forma de GET /v1/collaborations (campo do código, do
        percentual, do status de aceite)
     4. matriz país × moeda: quais dos 12 países a SUA conta aceita de fato
        em POST /v1/payments, e o redirect_url vem na resposta?
     5. o valor volta DECIMAL (1000.00) e não em centavos (100000)?
     6. o order_id duplicado é recusado? (afeta cobrança reaberta)
     7. um split_code é aceito no POST /v1/payments?

   As sondas do bloco A rodam SEM chave nenhuma (são de código local) — e
   mostram de propósito o estado VULNERÁVEL das tabelas de moeda antes da
   Fase 1. O bloco B precisa de um par de chaves no .env:

     sandbox: DLOCAL_API_KEY / DLOCAL_SECRET_KEY          (conta de teste,
              criada em https://dashboard-sbx.dlocalgo.com/signup)
     live:    DLOCAL_API_KEY_LIVE / DLOCAL_SECRET_KEY_LIVE  (--live)

   CONTRA A CONTA LIVE: por padrão só as sondas de LEITURA rodam. Com
   --criar-pagamentos a matriz também roda em live, e aí vale saber que um
   pagamento criado nasce PENDING — é um link de checkout, não uma cobrança:
   ninguém é debitado sem abrir o link e pagar. Mesmo assim a sonda manda
   expiração de 10 minutos e descrição "NAO PAGAR", para não deixar link
   pagável vivo no painel.

   Uso: node scripts/testar-dlocal.mjs
        node scripts/testar-dlocal.mjs --json fase0-dlocal.json
        node scripts/testar-dlocal.mjs --live                      (só leitura)
        node scripts/testar-dlocal.mjs --live --criar-pagamentos    (matriz) */
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { MOEDA_POR_PAIS, IDIOMA_POR_PAIS } from "../api/_lib/geo.js";
import { logSeguro } from "../api/_lib/seguranca.js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
/* placeholder do .env conta como ausente — mesma regra do envVal() da API */
const val = (k) => {
  const v = String(process.env[k] ?? env[k] ?? "").trim();
  return v && !v.startsWith("COLE_AQUI") ? v : undefined;
};

const LIVE = process.argv.includes("--live");
/* em live, criar pagamento exige pedido explícito (ver cabeçalho) */
const CRIAR = !LIVE || process.argv.includes("--criar-pagamentos");
const iJson = process.argv.indexOf("--json");
const JSON_OUT = iJson > -1 ? process.argv[iJson + 1] : null;

const API_KEY = LIVE ? val("DLOCAL_API_KEY_LIVE") : val("DLOCAL_API_KEY");
const SECRET = LIVE ? val("DLOCAL_SECRET_KEY_LIVE") : val("DLOCAL_SECRET_KEY");
const BASE = LIVE ? "https://api.dlocalgo.com" : "https://api-sbx.dlocalgo.com";

/* 12 países da dLocal Go. O valor de teste fica na casa de US$ 10–25 em
   moeda local: alto o bastante para passar de mínimos por método, baixo o
   bastante para não parecer transação real. BR e MX entram só como
   referência — hoje são da Stripe e continuam sendo. */
const PAISES = [
  { pais: "AR", moeda: "ARS", valor: 10000, nome: "Argentina" },
  { pais: "BO", moeda: "BOB", valor: 100, nome: "Bolívia" },
  { pais: "BR", moeda: "BRL", valor: 60, nome: "Brasil", stripe: true },
  { pais: "CL", moeda: "CLP", valor: 10000, nome: "Chile" },
  { pais: "CO", moeda: "COP", valor: 50000, nome: "Colômbia" },
  { pais: "CR", moeda: "CRC", valor: 6000, nome: "Costa Rica" },
  { pais: "EC", moeda: "USD", valor: 15, nome: "Equador" },
  { pais: "GT", moeda: "GTQ", valor: 100, nome: "Guatemala" },
  { pais: "MX", moeda: "MXN", valor: 250, nome: "México", stripe: true },
  { pais: "PE", moeda: "PEN", valor: 50, nome: "Peru" },
  { pais: "PY", moeda: "PYG", valor: 100000, nome: "Paraguai" },
  { pais: "UY", moeda: "UYU", valor: 500, nome: "Uruguai" },
];
const MOEDAS_DLOCAL = [...new Set(PAISES.map((p) => p.moeda))];

let falhas = 0, puladas = 0;
const achados = {
  ambiente: LIVE ? "live" : "sandbox", base: BASE,
  rodado_em: new Date().toISOString(), paises: {}, endpoints: {}, moeda_app: {},
};
const ok = (nome, passou, extra = "") => {
  console.log(`${passou ? "✅" : "❌"} ${nome}${extra ? " — " + extra : ""}`);
  if (!passou) falhas++;
};
const pula = (nome, motivo) => { puladas++; console.log(`⏭️  ${nome} — ${motivo}`); };
const info = (nome, dado) => console.log(`ℹ️  ${nome} — ${dado}`);

const chamar = async (metodo, rota, corpo) => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${rota}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}:${SECRET}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(25000),
    });
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* resposta não-JSON */ }
    return { http: r.status, corpo: json, texto: txt.slice(0, 300), ms: Date.now() - t0 };
  } catch (e) {
    return { http: 0, corpo: null, texto: String(e?.message || e), ms: Date.now() - t0 };
  }
};
const erroDlocal = (r) => (r.corpo?.code ? `${r.corpo.code} ${r.corpo.message || ""}` : r.texto).slice(0, 120);

/* ════════ A · código local (vale antes de qualquer chave) ════════ */
console.log(`━━ A · tabelas de moeda e idioma do app (${MOEDAS_DLOCAL.length} moedas / ${PAISES.length} países dLocal) ━━`);

const jsx = readFileSync(new URL("../CondoMasterPro.jsx", import.meta.url), "utf8");
const bloco = (txt, inicio, fim = "];") => txt.slice(txt.indexOf(inicio), txt.indexOf(fim, txt.indexOf(inicio)));
const noSeletor = new Set([...bloco(jsx, "const MOEDAS = [").matchAll(/\["([A-Z]{3})",/g)].map((m) => m[1]));
const faltaSeletor = MOEDAS_DLOCAL.filter((m) => !noSeletor.has(m));
achados.moeda_app.selector_faltando = faltaSeletor;
ok("o <select> de moeda de gestão cobre as 12 moedas dLocal", faltaSeletor.length === 0,
  faltaSeletor.length ? `faltam ${faltaSeletor.join(", ")} → o form salva a 1ª option (USD) em silêncio` : `${noSeletor.size} moedas`);

const faltaGeo = PAISES.filter((p) => MOEDA_POR_PAIS[p.pais] !== p.moeda);
achados.moeda_app.geo_faltando = faltaGeo.map((p) => `${p.pais}:${MOEDA_POR_PAIS[p.pais] || "ausente"}≠${p.moeda}`);
ok("MOEDA_POR_PAIS (api/_lib/geo.js) semeia a moeda certa nos 12 países", faltaGeo.length === 0,
  faltaGeo.length ? achados.moeda_app.geo_faltando.join(" ") : "");

const faltaIdioma = PAISES.filter((p) => !IDIOMA_POR_PAIS[p.pais]);
ok("IDIOMA_POR_PAIS cobre os 12 países", faltaIdioma.length === 0,
  faltaIdioma.map((p) => p.pais).join(", "));

/* LOCALE_MOEDA vivia duplicado (jsx + lib) e as duas cópias divergiram —
   agora a lib é fonte única e o jsx importa. A 2ª sonda guarda isso. */
const libApi = readFileSync(new URL("../src/lib/api.js", import.meta.url), "utf8");
const temLocale = new Set([...bloco(libApi, "LOCALE_MOEDA = {", "}").matchAll(/([A-Z]{3}):\s*"/g)].map((m) => m[1]));
const faltaLocale = MOEDAS_DLOCAL.filter((m) => !temLocale.has(m));
achados.moeda_app.locale_faltando = faltaLocale;
ok("LOCALE_MOEDA (src/lib/api.js) formata as 12 moedas", faltaLocale.length === 0,
  faltaLocale.length ? `faltam ${faltaLocale.join(", ")} → caem em en-US (CLP sai "CLP 1,000" em vez de "$1.000")` : `${temLocale.size} moedas`);
const copiaNoJsx = /const\s+LOCALE_MOEDA\s*=/.test(jsx);
ok("LOCALE_MOEDA é fonte única (o jsx importa, não redeclara)", !copiaNoJsx,
  copiaNoJsx ? "CondoMasterPro.jsx voltou a ter cópia própria — é assim que as duas divergem"
    : "importado de src/lib/api.js");

/* redação do segredo em log: a DLOCAL_SECRET_KEY não tem formato sk_/whsec_ */
const capturar = (fn) => {
  const orig = console.error; let saida = "";
  console.error = (...a) => { saida += a.map(String).join(" "); };
  try { fn(); } finally { console.error = orig; }
  return saida;
};
const segredoFalso = "dlk_FALSO_api_123:dls_FALSO_secret_456";
const logado = capturar(() => logSeguro("[sonda]", new Error(`falhou com Authorization: Bearer ${segredoFalso}`)));
ok("logSeguro redige o par Bearer <api>:<secret> da dLocal", !logado.includes("dls_FALSO_secret_456"),
  logado.includes("dls_FALSO_secret_456") ? "VAZOU em log — acrescente a regra em api/_lib/seguranca.js" : "redigido");

/* fixture do HMAC das notificações: HMAC_SHA256(key=SECRET, msg=API_KEY+corpo) */
const assinar = (apiKey, secret, corpoBruto) => createHmac("sha256", secret).update(apiKey + corpoBruto).digest("hex");
const vetor = assinar("MyMerchantApiKey", "MyMerchantSecretKey", '{"payment_id":"DP-283"}');
info("assinatura do vetor do doc (ApiKey+Payload, chave=SecretKey)", vetor);
info("atenção", 'o header de exemplo do doc ("b7171263…") NÃO é a assinatura desse vetor — não depure contra ele');

/* ════════ B · API da dLocal Go ════════ */
console.log(`\n━━ B · API ${achados.ambiente} (${BASE}) ━━`);
if (!API_KEY || !SECRET) {
  const sufixo = LIVE ? "_LIVE" : "";
  console.log(`\n⚠️  DLOCAL_API_KEY${sufixo} / DLOCAL_SECRET_KEY${sufixo} ausentes no .env — bloco B inteiro pulado.\n`);
  if (LIVE) {
    console.log("   Como obter as chaves LIVE:");
    console.log("   1. entre em https://dashboard.dlocalgo.com/payment-integration?details=API");
    console.log("   2. copie API Key e Secret Key");
    console.log("   3. cole no .env em DLOCAL_API_KEY_LIVE e DLOCAL_SECRET_KEY_LIVE (os nomes com");
    console.log("      sufixo são lidos SÓ por este script — o dev server nunca os vê)\n");
  } else {
    console.log("   Como obter as de SANDBOX (são de uma conta de TESTE, separada da live):");
    console.log("   1. crie a conta de teste em https://dashboard-sbx.dlocalgo.com/signup");
    console.log("   2. no painel: Integrations → API Integration → copie Sandbox API Key e Sandbox Secret Key");
    console.log("   3. cole no .env em DLOCAL_API_KEY e DLOCAL_SECRET_KEY e rode esta sonda de novo");
    console.log("   Sem conseguir criar a conta de teste? rode contra a live:");
    console.log("      node scripts/testar-dlocal.mjs --live                    (só leitura)");
    console.log("      node scripts/testar-dlocal.mjs --live --criar-pagamentos (matriz)\n");
  }
  for (const n of ["/v1/me", "GET /v1/collaborations", "POST /v1/collaborations", "matriz país × moeda",
    "valor decimal (sem ×100)", "order_id duplicado", "GET /v1/payments/:id", "split_code"])
    pula(n, "sem chave");
} else {
  /* B1 · credenciais. O doc usa POST em "Authentication" e GET no "Getting
     started" — sondar os dois e registrar qual a API aceita. */
  const mePost = await chamar("POST", "/v1/me", {});
  const meGet = await chamar("GET", "/v1/me");
  achados.endpoints["/v1/me"] = { POST: mePost.http, GET: meGet.http };
  ok("credenciais válidas em /v1/me", mePost.http === 200 || meGet.http === 200,
    `POST ${mePost.http} · GET ${meGet.http}${mePost.http === 403 || meGet.http === 403 ? " (403/3001 = credenciais inválidas)" : ""}`);
  info("verbo aceito em /v1/me", [mePost.http === 200 && "POST", meGet.http === 200 && "GET"].filter(Boolean).join(" e ") || "nenhum");
  /* imprimir a resposta de SUCESSO, não a primeira que existir: o POST
     devolve 500 com corpo, e era ele que aparecia aqui — escondendo o
     estado do merchant, que é o diagnóstico mais útil da conta */
  const meOk = [meGet, mePost].find((r) => r.http === 200);
  if (meOk?.corpo) info("estado do merchant (/v1/me)", JSON.stringify(meOk.corpo).slice(0, 400));
  achados.me = meOk?.corpo || null;

  /* B1b · O GATE REAL DA FASE 0. Credencial válida não é conta ativada: com
     kyc_level_status PENDING ou is_in_fraud_review=true, todas as leituras
     respondem 200 e POST /v1/payments devolve 403/3003. Sem esta sonda, o
     3003 parece (e eu li assim no 1º run) limite de cobertura por país. */
  const st = achados.me || {};
  const kyc = String(st.kyc_level_status || "").toUpperCase();
  const contaPronta = !!kyc && kyc !== "PENDING" && kyc !== "REJECTED" && st.is_in_fraud_review !== true;
  achados.conta_pronta = contaPronta;
  ok("conta ativada: KYC concluído e fora de revisão de fraude", contaPronta,
    `kyc_level=${st.kyc_level ?? "?"} status=${kyc || "?"} fraud_review=${st.is_in_fraud_review ?? "?"}` +
    (contaPronta ? "" : " → POST /v1/payments responde 403/3003 até isso ser resolvido pela dLocal"));
  if (st.currency) info("moeda de liquidação da conta", `${st.currency} (saldo ${st.available_balance ?? "?"})`);

  /* B2 · colaborações (split): forma do objeto e quais estão ACTIVE */
  const colabs = await chamar("GET", "/v1/collaborations");
  achados.endpoints["GET /v1/collaborations"] = colabs.http;
  const lista = Array.isArray(colabs.corpo) ? colabs.corpo : (colabs.corpo?.data || colabs.corpo?.collaborations || []);
  ok("GET /v1/collaborations responde", colabs.http === 200, `${colabs.http} · ${lista.length} colaboração(ões)`);
  if (lista.length) {
    achados.colaboracao_campos = Object.keys(lista[0]);
    info("campos de uma colaboração", achados.colaboracao_campos.join(", "));
    for (const c of lista.slice(0, 5))
      info(`colaboração ${c.id ?? "?"}`, `code=${c.code} role=${c.role} comissão=${c.collaborator_commission} status=${c.status}`);
  } else if (colabs.http === 200) {
    info("nenhuma colaboração", "esperado antes do 1º convite — o percentual e o convite são do painel");
  }
  const ativa = lista.find((c) => String(c.status).toUpperCase() === "ACTIVE");

  /* B3 · existe API para CONVIDAR? (o doc diz que não — confirmar na API)
     Cuidado na leitura: esta API NÃO devolve 405. Rota inexistente dá 404
     limpo ({"error":"Not Found","path":…}), mas método não suportado numa
     rota MAPEADA dá 500 com code 7000 — o mesmo que POST /v1/me devolve,
     tendo GET /v1/me 200. Por isso a baseline abaixo: sem ela, o 500 seria
     lido como "a rota existe e quebrou", que é a conclusão oposta. */
  const baseline = await chamar("POST", "/v1/zzz-rota-que-nao-existe", { a: 1 });
  const criarColab = await chamar("POST", "/v1/collaborations",
    { name: "sonda-fase0", email: "sonda-fase0@example.com", commission: 1 });
  achados.endpoints["POST /v1/collaborations"] = criarColab.http;
  achados.endpoints["POST /v1/<rota inexistente> (baseline)"] = baseline.http;
  const metodoNaoSuportado = criarColab.http === 500 && criarColab.corpo?.code === 7000 && baseline.http === 404;
  const semApiConvite = [404, 405, 501].includes(criarColab.http) || metodoNaoSuportado;
  ok("não há API para CONVIDAR ao split (onboarding fica com 2 passos humanos)", semApiConvite,
    `POST ${criarColab.http} · rota inexistente ${baseline.http}` +
    (metodoNaoSuportado ? " → 500/7000 = método não suportado, não rota quebrada" : "") +
    (semApiConvite ? "" : ` — INESPERADO: ${erroDlocal(criarColab)} (se criou algo, remova no painel)`));

  /* B4 · status do vendedor, quando a plataforma é a colaboradora */
  if (ativa?.code) {
    const ss = await chamar("GET", `/v1/collaborations/${encodeURIComponent(ativa.code)}/seller-status`);
    achados.endpoints["GET /v1/collaborations/:code/seller-status"] = ss.http;
    ok("seller-status da colaboração ACTIVE responde", ss.http === 200, `${ss.http} ${JSON.stringify(ss.corpo || {}).slice(0, 140)}`);
  } else pula("seller-status", "nenhuma colaboração ACTIVE ainda");

  /* B5 · existe endpoint que liste MÉTODOS por país? (nada documentado — se
     não houver, a matriz do plano sai de POST /v1/payments, abaixo) */
  for (const rota of ["/v1/payments-methods?country=AR", "/v1/payment-methods?country=AR", "/v1/countries"]) {
    const r = await chamar("GET", rota);
    achados.endpoints[`GET ${rota}`] = r.http;
    info(`descoberta ${rota}`, r.http === 200 ? `200 → ${r.texto.slice(0, 160)}` : `${r.http}`);
  }

  /* B5b · moedas que a conta transaciona, SEM criar pagamento: a tabela de
     câmbio (GET /v1/currency-exchanges — plural, fora de /payments) lista um
     par USD→moeda por moeda habilitada. É o sinal de cobertura mais baixo
     custo que existe nesta API. */
  const cambio = await chamar("GET", "/v1/currency-exchanges");
  achados.endpoints["GET /v1/currency-exchanges"] = cambio.http;
  const linhasCambio = Array.isArray(cambio.corpo) ? cambio.corpo : (cambio.corpo?.data || []);
  const moedasConta = new Set(linhasCambio.map((l) => String(l.target_currency || "").toUpperCase()));
  achados.moedas_da_conta = [...moedasConta].sort();
  /* USD é a moeda BASE da tabela (source_currency é sempre USD), então nunca
     aparece como target: a cobertura do Equador — que transaciona em USD —
     não se conclui daqui, só da matriz de POST /v1/payments. */
  const semCambio = MOEDAS_DLOCAL.filter((m) => m !== "USD" && !moedasConta.has(m));
  ok("a tabela de câmbio da conta cobre as 11 moedas locais da dLocal (USD é a base)",
    cambio.http === 200 && semCambio.length === 0,
    cambio.http !== 200 ? `HTTP ${cambio.http}` : (semCambio.length ? `faltam ${semCambio.join(", ")} de ${moedasConta.size} moedas` : `${moedasConta.size} moedas na conta`));
  if (moedasConta.size) info("moedas da conta", achados.moedas_da_conta.join(" "));

  /* B5c · ler a lista de pagamentos separa credencial de ativação: 200 aqui
     com 403/3003 no POST significa que a chave está certa e é o ESTADO da
     conta que barra a criação (ver B1b) — não o produto estar ausente. */
  const listaPag = await chamar("GET", "/v1/payments");
  achados.endpoints["GET /v1/payments"] = listaPag.http;
  ok("a conta consegue LER pagamentos (credencial ok; criar depende de B1b)", listaPag.http === 200,
    `GET /v1/payments → ${listaPag.http} ${listaPag.http === 200 ? "" : erroDlocal(listaPag)}`);

  /* B6 · matriz país × moeda — a sonda que vale o gate da Fase 0 */
  if (!CRIAR) {
    const motivo = "--live sem --criar-pagamentos (nenhum link de checkout é criado na conta real)";
    for (const n of ["matriz país × moeda", "valor decimal (sem ×100)", "order_id duplicado",
      "GET /v1/payments/:id", "payer com documento", "split_code"]) pula(n, motivo);
  } else {
    const RUN = Date.now().toString(36).toUpperCase();
    /* em live o pagamento nasce PENDING (link de checkout, não débito), mas
       ainda assim expira em 10 min e se anuncia como sonda — nenhum link
       pagável fica vivo no painel de produção */
    const guarda = LIVE ? { expiration_type: "MINUTES", expiration_value: 10 } : {};
    const marca = LIVE ? " [SONDA FASE 0 - NAO PAGAR]" : "";
    if (LIVE) console.log("\n  ⚠️  conta LIVE: 15 pagamentos PENDING vão aparecer no painel, expirando em 10 min");
    const pagar = (p, extra = {}) => chamar("POST", "/v1/payments", {
      amount: p.valor, currency: p.moeda, country: p.pais,
      order_id: `F0-${RUN}-${p.pais}`, description: `Fase 0 CondoMaster ${p.pais}${marca}`.slice(0, 100),
      notification_url: "https://example.com/notifications",
      success_url: "https://example.com/success", back_url: "https://example.com/",
      ...guarda, ...extra,
    });
    console.log("\n  país moeda    valor  http  id            amount devolvido  redirect_url");
    const linhas = [];
    for (const p of PAISES) {
      const r = await pagar(p);
      const c = r.corpo || {};
      achados.paises[p.pais] = {
        moeda: p.moeda, http: r.http, id: c.id || null, status: c.status || null,
        amount: c.amount ?? null, redirect: !!c.redirect_url, erro: r.http === 200 ? null : erroDlocal(r),
      };
      linhas.push({ p, r, c });
      console.log(`  ${p.pais}   ${p.moeda}  ${String(p.valor).padStart(7)}  ${String(r.http).padStart(4)}  ` +
        `${String(c.id || "—").padEnd(12)}  ${String(c.amount ?? "—").padStart(16)}  ` +
        (c.redirect_url ? "ok" : erroDlocal(r)));
    }
    const aceitos = linhas.filter(({ r }) => r.http === 200);
    const novos = aceitos.filter(({ p }) => !p.stripe);
    /* 3003 em TODOS os países (inclusive BR, que a dLocal cobre com certeza)
       é bloqueio de CONTA, não cobertura — e nesse caso nada abaixo pode ser
       concluído. Dar ❌ em "não traz redirect_url" ou ✅ em "o valor não foi
       multiplicado" seria inventar resultado a partir de zero resposta. */
    const bloqueio = linhas.length > 0 && linhas.every(({ r }) => r.http === 403 && r.corpo?.code === 3003);
    achados.bloqueio_3003 = bloqueio;
    if (bloqueio) {
      console.log("\n  ⛔ 3003 em todos os países, inclusive BR: a conta NÃO está autorizada a");
      console.log("     usar a API de pagamentos. As leituras (/v1/me, /v1/collaborations,");
      console.log("     /v1/currency-exchanges) respondem 200 — as chaves estão certas; falta");
      console.log("     habilitação do lado da dLocal. Ação: pedir ao suporte/comercial a");
      console.log("     liberação da Integration API (Payments) e confirmar se a ativação da");
      console.log("     conta (KYC/contrato) está concluída. Não é problema de país nem de código.");
    }
    ok("os 10 países sem pagamento online hoje são aceitos em POST /v1/payments", novos.length === 10,
      bloqueio ? "0/10 — bloqueio de conta (3003), cobertura INDETERMINADA"
        : `${novos.length}/10 → ${novos.map(({ p }) => p.pais).join(" ") || "nenhum"}`);
    if (bloqueio) {
      pula("redirect_url no retorno", "nenhum pagamento foi criado (3003)");
      pula("valor decimal (sem ×100)", "nenhum pagamento foi criado (3003)");
    } else {
      ok("todo pagamento aceito traz redirect_url (checkout hospedado por GET)",
        aceitos.length > 0 && aceitos.every(({ c }) => !!c.redirect_url),
        `${aceitos.filter(({ c }) => c.redirect_url).length}/${aceitos.length}`);
      if (aceitos.length) info("redirect_url de exemplo", aceitos[0].c.redirect_url);

      /* B7 · o risco de cobrar 100× — o amount devolvido tem de ser o decimal
         enviado, inclusive nas moedas que a Stripe trata como zero-decimal */
      const erradas = aceitos.filter(({ p, c }) => Number(c.amount) !== Number(p.valor));
      ok("o amount devolvido é o decimal enviado (nada de centavos)",
        aceitos.length > 0 && erradas.length === 0,
        erradas.map(({ p, c }) => `${p.moeda} ${p.valor}→${c.amount}`).join(" ")
          || (aceitos.length ? "conferido em ARS, CLP e PYG" : "nenhum pagamento aceito"));
    }

    /* B8 · order_id duplicado (erro 5009): a cobrança reaberta precisa de
       order_id novo, senão o 2º checkout do morador toma 400 */
    const primeiro = aceitos[0];
    if (primeiro) {
      const dup = await pagar(primeiro.p);
      achados.order_id_duplicado = { http: dup.http, erro: erroDlocal(dup) };
      ok("order_id repetido é recusado (Fase 1 precisa de order_id por tentativa)",
        dup.http === 400 || dup.corpo?.code === 5009, `HTTP ${dup.http} ${erroDlocal(dup)}`);

      /* B9 · GET /v1/payments/:id — a fonte autoritativa do webhook e do poll */
      const lido = await chamar("GET", `/v1/payments/${encodeURIComponent(primeiro.c.id)}`);
      const l = lido.corpo || {};
      achados.retrieve_campos = Object.keys(l);
      ok("GET /v1/payments/:id devolve status e order_id", lido.http === 200 && !!l.status,
        `${lido.http} status=${l.status} status_detail=${l.status_detail} order_id=${l.order_id}`);
      ok("a resposta tem approved_date (hora real do pagamento, não 'agora')",
        "approved_date" in l, `approved_date=${l.approved_date ?? "ausente"} (PENDING ainda não pagou)`);
      info("campos de GET /v1/payments/:id", achados.retrieve_campos.join(", "));
      info("assinatura que o webhook da Fase 1 tem de calcular",
        `V2-HMAC-SHA256, Signature: ${assinar(API_KEY, SECRET, JSON.stringify({ payment_id: l.id || primeiro.c.id }))}`);
    } else pula("order_id duplicado / GET /v1/payments/:id", "nenhum pagamento foi aceito");

    /* B10 · payer com documento — o morador vai sempre com nome, e-mail e
       CPF/DNI (é o que a LGPD obriga a declarar) */
    if (bloqueio) pula("payer com documento", "conta sem autorização para pagamentos (3003)");
    else {
      const comPayer = await pagar({ pais: "BR", moeda: "BRL", valor: 60 }, {
        order_id: `F0-${RUN}-PAYER`,
        payer: { name: "Morador Teste", email: "morador.teste@example.com", document: "12345678909", document_type: "CPF" },
      });
      achados.payer = { http: comPayer.http, erro: comPayer.http === 200 ? null : erroDlocal(comPayer) };
      ok("payer{name,email,document,document_type} é aceito", comPayer.http === 200,
        `${comPayer.http} ${erroDlocal(comPayer)}`);
    }

    /* B11 · split_code. O doc diz que o valor é o "Integrator Code" da tabela
       de contratos do painel — que pode NÃO ser o code de /v1/collaborations. */
    const split = val("DLOCAL_SPLIT_CODE") || ativa?.code;
    if (bloqueio) pula("split_code", "conta sem autorização para pagamentos (3003)");
    else if (!split) pula("split_code", "defina DLOCAL_SPLIT_CODE no .env (Integrator Code do painel) ou aceite um convite");
    else {
      const comSplit = await pagar({ pais: "AR", moeda: "ARS", valor: 10000 },
        { order_id: `F0-${RUN}-SPLIT`, split_code: split });
      achados.split = { code_usado: split, origem: val("DLOCAL_SPLIT_CODE") ? "DLOCAL_SPLIT_CODE" : "collaborations.code", http: comSplit.http };
      ok("POST /v1/payments aceita o split_code", comSplit.http === 200,
        `${comSplit.http} ${erroDlocal(comSplit)}${comSplit.http !== 200 ? " → o Integrator Code do painel difere do code da colaboração" : ""}`);
    }
  }
  pula("rate limit (100 req/min por IP por endpoint)", "não é sondado de propósito — queimaria o IP por 1 minuto");
}

/* ════════ fecho ════════ */
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(achados, null, 2)); console.log(`\n📄 achados em ${JSON_OUT}`); }
console.log("\n━━ o que estes achados decidem ━━");
console.log("  · países aceitos  → PAISES_DLOCAL de api/_lib/paises.js (Fase 1)");
console.log("  · moedas faltando → MOEDAS, LOCALE_MOEDA (×2) e MOEDA_POR_PAIS no MESMO commit");
console.log("  · POST /v1/collaborations ausente → tela de ativação com 4 passos, não botão único");
console.log("  · order_id duplicado → order_id por TENTATIVA, não por cobrança");
console.log("  · percentual da comissão → decisão de contrato, fora do código (painel da dLocal)");
console.log("  (as falhas do bloco A são ESPERADAS até a Fase 1 — são o estado de hoje, não uma regressão)");
console.log(falhas
  ? `\n❌ ${falhas} sonda(s) falharam${puladas ? ` · ${puladas} pulada(s)` : ""}`
  : `\n🌎 FASE 0 OK${puladas ? ` · ${puladas} sonda(s) pulada(s)` : ""}`);
process.exit(falhas ? 1 : 0);
