# Integração dLocal Go — CondoMaster Pro

> **ESTADO: FASE 0 (descoberta) — nada em produção.** Não existe `api/dlocal/*`,
> nenhuma tabela, nenhum enum novo. A Stripe segue intocada e é o único
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

1. **`/v1/me` é `POST`** na página *Authentication* e `GET` no *Getting
   started* — a doc divergia; a sonda testa os dois verbos e registra qual a
   API aceita.
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

## 3. Fase 0 — o que só a API responde (sonda)

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
`[SONDA FASE 0 - NAO PAGAR]`, então os ~15 registros que aparecem no painel
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

**Estado vulnerável que o bloco A já expõe** (é de propósito, vira trabalho
obrigatório da Fase 1): das 12 moedas da dLocal, **7 não existem** no
`<select>` de moeda de gestão (`MOEDAS`), em `MOEDA_POR_PAIS`
(`api/_lib/geo.js`) nem nos **dois** `LOCALE_MOEDA` (`CondoMasterPro.jsx:75` e
`src/lib/api.js:59`) — BOB, CLP, COP, CRC, GTQ, PEN e UYU. Como um `<select>`
sem a `<option>` correspondente salva a primeira opção, **um condomínio
chileno vira USD em silêncio** ao salvar configurações. Isso já é bug hoje.

## 4. Decisão de negócio pendente (bloqueia a Fase 1)

**Qual percentual fixo de comissão** nos países dLocal. O split é só
percentual e é definido no painel, no convite. A taxa atual é
`min(1% × valor, 1 unidade)` — um **teto**: numa cobrança de 500 a plataforma
cobra hoje 0,2%, e 1% fixo cobraria 5× mais. A escolha também torna falsa a
divulgação em `CondoMasterPro.jsx:1403` ("retém 1%, limitado a 1 {moeda}")
nesses países — string que entra na lista de tradução dos 15 idiomas.

## 5. Produção (Vercel) — quando a Fase 1 entrar

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

## 6. LGPD

Hoje o checkout da Stripe recebe só número de unidade e competência — nenhum
dado pessoal. A dLocal recebe **nome, e-mail e documento (CPF/DNI)** do
morador. `pessoas.consentimentos jsonb` (`supabase-schema.sql:155`) existe
para isso. Não é bloqueador técnico, mas é base legal nova.
