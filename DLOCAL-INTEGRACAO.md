# Integração dLocal Go — CondoMaster Pro

> **ESTADO: FASE 0 — parada na ativação da conta dLocal (09/10/2026).** As
> credenciais live funcionam e todas as leituras respondem 200, mas
> `POST /v1/payments` devolve **403 / 3003** em todos os 12 países: a conta
> está com `kyc_level_status: PENDING` e `is_in_fraud_review: true`. Enquanto
> a dLocal não liberar, **a matriz país × moeda não pode ser levantada** e o
> gate da fase não fecha. Nada em produção: não existe `api/dlocal/*`,
> nenhuma tabela, nenhum enum novo — a Stripe segue intocada e é o único
> provedor ativo. Plano completo em
> `~/.claude/plans/dlocal-go-latam-roteamento-por-pais.md`.

**Por que existe:** de toda a América Latina, `PAISES_CONNECT`
(`api/stripe/_lib/comum.js:121`) contém só **BR e MX** — a Stripe não abre
conta de recebedor nos outros países para uma plataforma brasileira. Hoje
Argentina, Bolívia, Chile, Colômbia, Costa Rica, Equador, Guatemala, Peru,
Paraguai e Uruguai **não têm pagamento online nenhum**: só os meios manuais
(carteira Verum, transferência com comprovante, dinheiro).

**Desenho:** a Stripe fica com BR e MX (condomínio como merchant of record,
split nativo, Pix/OXXO); a dLocal Go atende os 10 países restantes via
**Split Payments** (a parte do condomínio cai na conta dLocal **dele** — a
plataforma nunca retém dinheiro alheio). O roteamento é uma função
`provedorDoPais()` com override por env.

---

## 1. Chaves e ambientes

| Valor | Papel | Onde obter |
|---|---|---|
| **API Key** | 1ª metade do Bearer; entra também na mensagem do HMAC | painel → **Integrations → API Integration** |
| **Secret Key** | 2ª metade do Bearer; é a **chave** do HMAC das notificações | mesma tela |

O header é literalmente `Authorization: Bearer <API_KEY>:<SECRET_KEY>` — as
duas concatenadas por dois-pontos, **sem Base64**.

| Ambiente | Base URL | Painel |
|---|---|---|
| Sandbox | `https://api-sbx.dlocalgo.com` | `dashboard-sbx.dlocalgo.com` — **conta de teste SEPARADA**, criada em `/signup` |
| Live | `https://api.dlocalgo.com` | `dashboard.dlocalgo.com/payment-integration?details=API` |

**A Fase 0 está sendo feita contra a conta LIVE**, porque não foi possível
criar a conta de teste. O arranjo do `.env` preserva a convenção do projeto
(a mesma da `STRIPE_SECRET_KEY_LIVE`):

| Variável | Quem lê | Valor hoje |
|---|---|---|
| `DLOCAL_API_KEY_LIVE` / `DLOCAL_SECRET_KEY_LIVE` | **só** `scripts/testar-dlocal.mjs --live` | chaves live |
| `DLOCAL_API_KEY` / `DLOCAL_SECRET_KEY` | dev server e funções de `/api` | **placeholder** → handlers respondem 503 |
| `DLOCAL_AMBIENTE` | base URL dos handlers | `sandbox` |

Ou seja: o `npm run dev` **não tem** como falar com a dLocal live — nenhum
handler lê os nomes com sufixo. `GET /api/auth/diag` reporta
presença/placeholder das duas chaves do servidor e o ambiente.

**Redação de log (feito):** as chaves da dLocal não têm formato `sk_`/`whsec_`
e vazariam em log. `api/_lib/seguranca.js` passou a (a) incluir `:` na regra
do `Bearer` — sem isso a 2ª metade do par sobrava no log — e (b) redigir
segredos **pelo próprio valor** lido do ambiente (`SEGREDOS_ENV`), que é a
única forma de cobrir chaves sem formato reconhecível.

---

## 2. Fase 0 — o que a documentação oficial já fechou

Três correções ao plano original, todas verificadas na doc da dLocal:

1. **`/v1/me`**: a página *Authentication* mostra `POST` e o *Getting started*
   mostra `GET`. Resolvido contra a conta real na seção 3 — é **GET**.
2. **Não existe `POST /v1/collaborations`.** A doc de Split Payments é
   explícita: convite e **percentual de comissão** são do painel. Logo o
   onboarding do condomínio **fica com 2 ações humanas** (ele cria a conta e
   aceita o convite) — a tela de ativação precisa ser de 4 passos, não o
   botão único da Stripe. Automatizável: só a leitura.
3. **`GET /v1/collaborations`** devolve
   `{ id, code, name, role, collaborator_commission, category, status }`
   (`status: "ACTIVE"` = aceito). Existe também
   `GET /v1/collaborations/{code}/seller-status`, **só** quando a colaboração
   está ACTIVE. Atenção: o `split_code` do `POST /v1/payments` é o
   **Integrator Code** da tabela de contratos do painel — pode **não** ser o
   `code` da colaboração; a sonda compara os dois.

Mais dois achados que mudam a Fase 1:

- **`order_id` duplicado é erro `5009` (400).** Usar `order_id = cobranca.id`
  quebra o 2º checkout da mesma cobrança (morador que abandona e tenta de
  novo). A Fase 1 precisa de `order_id` **por tentativa**, com a cobrança
  recuperável a partir dele.
- **A assinatura de exemplo do doc não corresponde ao vetor de exemplo do
  doc.** `HMAC_SHA256(key=SecretKey, msg=ApiKey+payload)` sobre
  `MyMerchantApiKey{"payment_id":"DP-283"}` dá
  `67ba82a93deddefd9dfb8cfb36b3248d336ae1924a79dd07bb69c7e238a5aae7`, e não o
  `b7171263…` que aparece no header de exemplo. Não depure contra esse valor.

Confirmado e inalterado em relação ao plano: `amount` é **decimal**
(`500` = 500,00 — nada de centavos), a resposta traz **`redirect_url`**
(checkout hospedado, GET), a notificação é só `{"payment_id":"…"}` (obriga
re-buscar `GET /v1/payments/:id`), retry da notificação **a cada 10 min por 30
dias**, rate limit **100 req/min por IP por endpoint** (429 / código 6000),
status `PENDING|PAID|REJECTED|CANCELLED|EXPIRED` com `status_detail` e
`approved_date`. Cartões de teste do sandbox: `4111 1111 1111 1111` e
`4242 4242 4242 4242` (sucesso).

## 3. Fase 0 — o que a conta live já respondeu (09/10/2026, sondas de leitura)

- **Credenciais válidas.** `GET /v1/me` → 200. **`POST /v1/me` → 500** — a
  página *Authentication* do doc, que mostra POST, está errada; o verbo é GET.
- **Esta API não devolve 405.** Rota inexistente → **404** limpo
  (`{"error":"Not Found","path":…}`); método não suportado numa rota
  **mapeada** → **500 com `code: 7000 internal_server_error`**. Vale para
  `POST /v1/me`, `POST /v1/collaborations` e `PUT /v1/collaborations`. Duas
  consequências: (a) um 500/7000 da dLocal **não** é necessariamente falha
  deles — pode ser verbo errado nosso; (b) qualquer sonda que conclua
  "a rota existe" a partir de um 500 conclui o oposto do certo — por isso a
  sonda compara com uma rota inexistente antes de decidir.
- **Confirmado que não há API de convite ao split** (`POST /v1/collaborations`
  = 500/7000 contra 404 da rota inexistente), como a doc afirma. O onboarding
  fica com 2 ações humanas. A conta tem **0 colaborações** hoje — nenhum
  contrato de split existe ainda, então `split_code` não pôde ser testado.
- **Não existe endpoint de métodos por país**: `/v1/payments-methods?country=`,
  `/v1/payment-methods?country=` e `/v1/countries` dão 404. A matriz sai de
  `POST /v1/payments`, como planejado.
- **O gate não fechou: `POST /v1/payments` → 403 `3003 Merchant has no
  authorization to use this API` nos 12 países, BR incluído.** Como o Brasil
  é certamente coberto pela dLocal, isso **não** é limite de país. O
  `GET /v1/me` dá o motivo:

  ```json
  {"merchant_id":239511,"kyc_level":2,"kyc_level_status":"PENDING",
   "is_limit_exceeded":false,"is_in_fraud_review":true,"currency":"USD",
   "current_balance":0,"available_balance":0,"in_transit_balance":0}
  ```

  **KYC nível 2 PENDENTE** e a conta **em revisão de fraude**. E
  `GET /v1/payments` responde **200**: dá para *ler* pagamentos, só não
  *criar*. Ou seja — credencial certa, produto presente, **conta não
  ativada**. A sonda virou uma verificação nomeada (`conta ativada: KYC
  concluído e fora de revisão de fraude`), para o 3003 nunca mais ser lido
  como cobertura de país. Resolver é com a dLocal: concluir o KYC nível 2 e
  sair da revisão de fraude.
- **A conta liquida em `USD`** (`currency` do `/v1/me`, saldo 0). Fica
  anotado para o desenho do split: a comissão da plataforma cai em USD,
  enquanto a parte do condomínio cai na conta dele, na moeda dele.
- **`GET /v1/currency-exchanges`** (plural, e **fora** de `/payments` — o
  caminho que eu havia suposto, `/v1/payments/currency-exchange`, dá 400/5000)
  devolve 200 com **31 moedas** habilitadas na conta, incluindo as **11
  moedas locais** dos países-alvo: ARS, BOB, BRL, CLP, COP, CRC, GTQ, MXN,
  PEN, PYG, UYU. É o sinal de cobertura mais barato desta API — nenhum
  pagamento criado. `source_currency` é sempre USD, então USD não aparece
  como destino: **a cobertura do Equador só se conclui pela matriz**. Esse
  endpoint também serve à Fase 3 (licença SaaS em moeda local).

## 4. Fase 0 — o que só a API responde (sonda)

```
node scripts/testar-dlocal.mjs                            # sandbox (precisa da conta de teste)
node scripts/testar-dlocal.mjs --live                     # live, só sondas de LEITURA
node scripts/testar-dlocal.mjs --live --criar-pagamentos   # live, matriz completa
node scripts/testar-dlocal.mjs --live --json fase0.json    # grava os achados
```

**Rodar a matriz em live é seguro, e por quê:** `POST /v1/payments` devolve um
pagamento `PENDING` — é um **link de checkout**, não um débito; ninguém é
cobrado sem abrir o link e pagar. Ainda assim a sonda manda
`expiration_type: MINUTES / expiration_value: 10` e descrição
`[SONDA FASE 0 - NAO PAGAR]`, e **quem roda é você** (`! node scripts/…`):
escrita em infra live é bloqueada pelo classificador, igual aos scripts live
da Stripe. Os ~15 registros que aparecem no painel
de produção expiram em 10 minutos e nenhum link pagável fica vivo. Sem
`--criar-pagamentos`, `--live` não cria nada.

A sonda roda **sem chave** o bloco A (tabelas de moeda do app, redação de
log, fixture do HMAC) e, com as chaves de sandbox, levanta:

- credenciais válidas e verbo aceito em `/v1/me`;
- forma real de `GET /v1/collaborations` e ausência de `POST`;
- existência (ou não) de endpoint que liste métodos/moedas por país — não há
  nada documentado, então a matriz sai de `POST /v1/payments`;
- **matriz país × moeda**: `POST /v1/payments` nos 12 países, com o
  `redirect_url` e o `amount` devolvidos (é o **gate** da Fase 0);
- o teste dos 100×: `amount` volta decimal inclusive em ARS, CLP e PYG, que
  a Stripe trata como zero-decimal (`ZERO_DECIMAIS`, `comum.js:168`);
- `order_id` duplicado, `GET /v1/payments/:id`, `payer` com documento e
  `split_code`.

**Moedas da LATAM — RESOLVIDO em 09/10/2026, antes da Fase 1.** O bloco A
expôs que 7 das 12 moedas (BOB, CLP, COP, CRC, GTQ, PEN, UYU) não existiam no
`<select>` `MOEDAS`, em `MOEDA_POR_PAIS` (`api/_lib/geo.js`) nem no
`LOCALE_MOEDA` — e, como um `<select>` sem a `<option>` correspondente salva
a primeira opção, **um condomínio chileno virava USD em silêncio** ao salvar
configurações. Era bug corrente, independente da dLocal, e foi corrigido:
`MOEDA_POR_PAIS` passou a cobrir BO/CL/CO/CR/EC/GT/PE/UY (EC em USD), as 7
opções entraram no seletor, e o `LOCALE_MOEDA` — que existia **duplicado**
(9 moedas em `src/lib/api.js`, 24 no `CondoMasterPro.jsx`, divergentes) —
virou **fonte única** exportada da lib e importada pelo jsx, agora com 31
moedas. A sonda guarda as duas coisas: a cobertura e a não-duplicação.

## 5. O que bloqueia a Fase 1 (nada disso é código)

**1. Ativar a conta dLocal** — KYC nível 2 concluído e saída da revisão de
fraude (ver seção 3). É o que destrava `POST /v1/payments` e, com ele, a
matriz país × moeda que define `PAISES_DLOCAL`. Reconferir com
`node scripts/testar-dlocal.mjs --live`: a sonda "conta ativada" vira ✅
sozinha quando a dLocal liberar.

**2. Enviar o primeiro convite de split** no painel — sem uma colaboração
aceita não existe `split_code`, e é ele que prova o modelo de dinheiro (a
conta tem **0 colaborações** hoje).

**3. Qual percentual fixo de comissão** nos países dLocal. O split é só
percentual e é definido no painel, no convite. A taxa atual é
`min(1% × valor, 1 unidade)` — um **teto**: numa cobrança de 500 a plataforma
cobra hoje 0,2%, e 1% fixo cobraria 5× mais. A escolha também torna falsa a
divulgação em `CondoMasterPro.jsx:1403` ("retém 1%, limitado a 1 {moeda}")
nesses países — string que entra na lista de tradução dos 15 idiomas.

## 6. Produção (Vercel) — quando a Fase 1 entrar

Nada disso vale agora: sem `api/dlocal/*`, as variáveis em produção não têm
efeito nenhum. A lista fica aqui para o deploy da Fase 1:

| Variável na Vercel | Valor |
|---|---|
| `DLOCAL_API_KEY` | API Key **live** |
| `DLOCAL_SECRET_KEY` | Secret Key **live** |
| `DLOCAL_AMBIENTE` | `live` |

As `*_LIVE` **não** vão para a Vercel — são só do script local, como a
`STRIPE_SECRET_KEY_LIVE`. Diferente da Stripe, **não existe script de
webhook**: a `notification_url` vai em cada `POST /v1/payments`, então basta
que o host de produção esteja correto na requisição — nada a registrar no
painel, nada equivalente ao `recriar-webhooks-live.mjs`. Antes de liberar:
`GET /api/auth/diag` com as duas chaves presentes e um smoke test de valor
mínimo num país dLocal, conferindo o crédito do split nas duas contas.

## 7. LGPD

Hoje o checkout da Stripe recebe só número de unidade e competência — nenhum
dado pessoal. A dLocal recebe **nome, e-mail e documento (CPF/DNI)** do
morador. `pessoas.consentimentos jsonb` (`supabase-schema.sql:155`) existe
para isso. Não é bloqueador técnico, mas é base legal nova.
