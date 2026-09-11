# Integração Stripe — CondoMaster Pro

A Stripe cobre os **dois fluxos de dinheiro** do sistema:

| Fluxo | Produto Stripe | Quem recebe | Moeda |
|---|---|---|---|
| **Licença SaaS** (mensal/anual do condomínio-cliente) | Billing + Checkout | Conta da **plataforma** (Stripe Brasil, CNPJ) | BRL (cliente estrangeiro paga na moeda local via Adaptive Pricing) |
| **Cobranças condominiais** (morador → condomínio) | Connect (direct charge) + Checkout | Conta **conectada do condomínio** (país à escolha entre os ~40 suportados; `PAISES_CONNECT`); a plataforma retém **1% com teto de 1 unidade da moeda** (application fee) | Moeda da conta conectada (BRL, USD, EUR…) — a moeda de gestão do condomínio precisa ser a mesma |

O condomínio escolhe o **país da conta** no seletor da seção "Pagamento
online" (imutável após criar; BR recebe por Pix e cartão, os demais países
por cartão + métodos locais dinâmicos). Os meios manuais (carteira Verum
Wallet, transferência bancária, dinheiro) continuam existindo — e são a
única via nos países onde a Stripe NÃO abre conta de recebedor (Paraguai,
Argentina, Bolívia e Colômbia: lá só existe "cross-border payouts", produto
indisponível para plataformas fora de US/UK/EEA/CA/CH).

---

## 1. Fluxo de dinheiro

```
LICENÇA SAAS
  Diretor → Stripe Checkout (subscription, BRL, trial 30d com cartão)
          → conta da plataforma
          → webhook /api/stripe/webhook → saas_assinaturas.status
  Código de ativação (ex.: PAGOMANUAL) = PAGAMENTO MANUAL: sem checkout e sem
  cartão — assinatura nasce ativa no valor cheio em modo send_invoice (fatura
  por e-mail a cada ciclo; baixa manual; vencida → bloqueio automático)

COBRANÇAS CONDOMINIAIS
  Morador → /api/stripe/checkout-cobranca → Checkout (payment; contas BRL:
    Pix|cartão explícito; demais moedas: métodos dinâmicos do país)
    criado NA conta conectada ({ stripeAccount }) + application_fee_amount =
    min(1% do valor, 1 unidade da moeda)
    → condomínio = merchant of record (recibo no nome dele, taxa Stripe dele)
    → a taxa da plataforma cai na conta da plataforma
  → webhook /api/stripe/webhook-connect → RPC registrar_pagamento_stripe():
    INSERT pagamentos (idempotente por payment intent)
    + cobranca → paga | paga_em_atraso
    + INSERT lancamentos receita 'pago' ("Entrada" no caixa — soma no saldo)
```

## 2. Arquivos

| Caminho | Papel |
|---|---|
| `api/stripe/_lib/comum.js` | utilidades: env, clients, JWT, corpo bruto, sync de licença, taxas/gross-up |
| `api/stripe/assinatura.js` | checkout da licença (trial, promotion code, troca de plano) |
| `api/stripe/licenca.js` | verificação ativa ("Já paguei") + sync |
| `api/stripe/plano.js` | grava o plano escolhido em saas_assinaturas |
| `api/stripe/cancelar-assinatura.js` | cancelamento agendado (cancel_at_period_end) |
| `api/stripe/portal.js` | Billing Portal (trocar cartão, faturas) |
| `api/stripe/webhook.js` | eventos da conta própria → status da licença |
| `api/stripe/connect/onboarding.js` | cria a conta conectada (país do seletor, `PAISES_CONNECT`) + Account Link |
| `api/stripe/connect/status.js` | flags da conta (charges/payouts/pendências) |
| `api/stripe/webhook-connect.js` | account.updated + baixa das cobranças pagas |
| `api/stripe/checkout-cobranca.js` | checkout de cobrança (direct charge + 1% c/ teto) |
| `api/stripe/cobranca-status.js` | polling do retorno + baixa (mesma RPC) |
| `scripts/preparar-stripe-producao.mjs` | products/prices BRL, PAGOMANUAL, webhooks |
| `supabase-schema.sql` | enums, colunas e RPC da Stripe (migração absorvida) |

## 3. Variáveis de ambiente (`.env` local + Vercel)

```
STRIPE_SECRET_KEY=sk_test_...            # sk_live_ em produção
STRIPE_WEBHOOK_SECRET=whsec_...          # endpoint /api/stripe/webhook
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...  # endpoint /api/stripe/webhook-connect
```

Sem chave publicável: todo pagamento usa o Checkout hospedado (sem Stripe.js
no front, sem escopo PCI). Diagnóstico: `GET /api/auth/diag`.

## 4. Passo a passo de ativação

> **Status (11/set/2026): PRODUÇÃO ATIVA.** Catálogo live provisionado
> (products/prices conferem com `saas_planos`), 2 webhooks live registrados,
> conta da plataforma com charges+payouts habilitados e a Vercel rodando com
> `sk_live_` — primeira assinatura live criada em 09/09 (código de ativação,
> `send_invoice`). O `.env` local permanece em TEST (dev não toca dinheiro
> real; scripts admin usam `--live`). Pendências: confirmar na dashboard as
> entregas 200 dos webhooks live; Pix da conta da plataforma ainda
> "indisponível" (exige solicitação); 1 conta conectada live com onboarding
> incompleto (`charges_enabled: false` — cliente precisa concluir o KYC).

1. **Banco** — o schema atual (`supabase-schema.sql`) já traz enums, colunas
   e RPC da Stripe. Confira os **preços BRL** dos planos em `saas_planos`
   (seed do schema) antes do passo 3.
2. **Conta Stripe** — crie a conta Stripe Brasil (CNPJ da plataforma), copie a
   `sk_test_` para o `.env`.
3. **Catálogo** — `node scripts/preparar-stripe-producao.mjs --executar`
   (cria products/prices com lookup_key `condomaster_<plano>_<ciclo>_brl`,
   o código de ativação `PAGOMANUAL`, e registra os 2 webhooks — guarde os
   `whsec_` impressos).
4. **Dashboard** —
   - Pagamentos → Métodos: ativar cartões e **Pix** (conta BR exige solicitação);
   - Billing → Portal do cliente: salvar a configuração padrão;
   - Connect → completar o **platform profile** e o branding do onboarding;
   - Connect → Configurações: **habilitar o onboarding por país** para os
     países de `PAISES_CONNECT` que a plataforma quiser atender (test e live).
5. **Deploy** — envs na Vercel; os webhooks apontam para
   `https://condomaster.servenowglobal.com/api/stripe/webhook` e
   `/api/stripe/webhook-connect` (este com "eventos de contas conectadas").

### Dev local (webhooks não alcançam localhost)

```
stripe login
stripe listen --forward-to localhost:5173/api/stripe/webhook \
              --forward-connect-to localhost:5173/api/stripe/webhook-connect
# copie os whsec_ impressos para o .env (variáveis acima)
```

Sem o CLI, o sistema ainda funciona: o paywall e o portal do morador fazem
polling (`/api/stripe/licenca` e `/api/stripe/cobranca-status`) e dão a baixa
pelo mesmo caminho idempotente do webhook.

## 5. Mapa de eventos

**`/api/stripe/webhook`** (conta própria):

| Evento | Ação |
|---|---|
| `checkout.session.completed` (subscription) | grava customer/subscription id + sync |
| `customer.subscription.created/updated/deleted` | re-busca a subscription e espelha o estado vivo: `trialing`→teste (+teste_fim), `active`→ativa (+renovacao), `past_due`/`unpaid`→inadimplente, `canceled`→cancelada; `cancel_at_period_end` seta/limpa aviso de cancelamento |
| `invoice.payment_failed` | log (o subscription.updated já bloqueia) |

**`/api/stripe/webhook-connect`** (contas conectadas):

| Evento | Ação |
|---|---|
| `account.updated` | sincroniza charges/payouts/pendências em integracoes_pagamento |
| `checkout.session.completed` (paid) | RPC registrar_pagamento_stripe |
| `checkout.session.async_payment_succeeded` | idem (preparado p/ boleto futuro) |
| `checkout.session.async_payment_failed` | log — cobrança segue em aberto |

## 6. Pagamento manual (código de ativação · send_invoice)

Para clientes indicados que pagam em dinheiro:

1. **Crie um código de uso único por cliente**:
   `node scripts/criar-codigo-ativacao.mjs PAGO-JOAO26 30` (30 = dias de
   validade se não for usado; opcional). O `PAGOMANUAL` criado pelo
   preparador também funciona, mas é consumido no primeiro uso — prefira um
   código por indicado.
2. O cliente informa o código em "Tenho um código de ativação" no paywall.
   O backend valida, **desativa o código na hora** (uso único) e cria a
   assinatura **no valor cheio, sem cartão**, em `collection_method:
   send_invoice` com vencimento em `STRIPE_DIAS_VENCIMENTO_FATURA` dias
   (padrão 10). A primeira fatura é enviada por e-mail imediatamente.
3. **Quando o dinheiro entrar**: dashboard → Faturas → fatura do cliente →
   "Marcar como paga fora da Stripe" (fica o histórico contábil de cada
   ciclo). A assinatura segue `active`.
4. **Se não pagar**: a fatura vence → a Stripe marca a assinatura `past_due`
   → o webhook grava `inadimplente` → o paywall bloqueia sozinho. Configure
   em Configurações → Faturamento → Assinaturas e e-mails o que fazer com
   faturas vencidas (ex.: cancelar a assinatura após N dias — o webhook
   então grava `cancelada`).
5. O cupom `condomaster-ativacao-100` existe só porque a API exige um cupom
   por trás de cada promotion code — **ele nunca é aplicado como desconto**
   (e o checkout normal não aceita códigos digitados, de propósito).

## 7. Automações (Stripe Workflows)

O [Stripe Workflows](https://docs.stripe.com/workflows) (Dashboard → Workflows,
builder visual) automatiza a camada **operacional** que o app deixa manual de
propósito. Gatilhos em qualquer evento — da conta própria **ou das contas
conectadas** —, condições/ramos, ações da API e e-mail interno à equipe, com
sandbox, versionamento, idempotência e retries nativos. Grátis até 10.000
passos/mês (US$ 0,018/passo depois).

**Por que é seguro sem código:** mudanças de estado feitas por workflows
(ex.: cancelar assinatura) chegam ao app pelos webhooks já existentes
(`customer.subscription.*` → sincronização da licença) — o sistema permanece
consistente por construção.

### Regras de ouro

- A ação de e-mail dos workflows é **interna** (membros da conta Stripe) —
  e-mail ao cliente continua sendo do Billing (recibos/lembretes) ou do app.
- **Não existe passo de espera** ("após N dias") — prazos ficam nas
  automações de Billing (Smart Retries; lembretes e ação sobre faturas
  vencidas em Configurações → Faturamento), que complementam os workflows.
- **NUNCA usar "pausar cobrança" (pause_collection)**: a assinatura continua
  `active` e o paywall NÃO bloqueia. Para revogar acesso, cancele — o
  webhook marca `cancelada`.
- Sandbox e live são ambientes separados: crie/teste no sandbox e replique
  no live. Limite: 50 workflows por conta.

### Receitas recomendadas

**Conta própria (licença SaaS):**

| # | Receita | Gatilho + condição | Ações |
|---|---|---|---|
| 1 | Licença inadimplente | `invoice.payment_failed` | E-mail à equipe (cliente, valor, tentativa) + Update customer: metadata `situacao=inadimplente` |
| 2 | Fatura manual vencida (PAGOMANUAL) | `customer.subscription.updated` com campo alterado `status = past_due` E `collection_method = send_invoice` (`invoice.overdue` não existe como gatilho) | E-mail à equipe: "cliente de pagamento manual não pagou — cobrar ou cancelar" |
| 3 | Novo assinante | `checkout.session.completed` com `mode = subscription` | E-mail à equipe + Update customer: metadata `origem=checkout` |
| 4 | Churn | `customer.subscription.deleted` | E-mail à equipe (quem, plano, desde quando) |
| 7 | Fraude (Radar) | `radar.early_fraud_warning.created` | Retrieve charge → se valor ≤ R$ 80,00 (≈ taxa de disputa; a condição NÃO converte moeda — usar BRL): refund automático; senão: e-mail à equipe ([template oficial](https://docs.stripe.com/workflows/use-cases) `fraud_warning_refund`). **Atenção ao recriar no live:** o template preenche "Instructions email" no Create a refund com `Charge | Receipt email` — a API recusa esse parâmetro em cartão e o run falha; limpar o campo antes de publicar. |

**Contas conectadas (cobranças condominiais)** — no gatilho, selecionar a
fonte "contas conectadas":

| # | Receita | Gatilho + condição | Ações |
|---|---|---|---|
| 5 | KYC do condomínio pendente | `account.updated` com `charges_enabled = false` | E-mail à equipe: "condomínio X com recebimento suspenso — regularizar cadastro" |
| 6 | Disputa em cobrança condominial | `charge.dispute.created` | Retrieve charge (valor/contexto) → e-mail urgente à equipe |

As receitas 1, 2, 5 e 6 são as de maior valor imediato. Cada execução fica
auditável em Dashboard → Workflows → runs (caminho percorrido + erros).

**Status:** as 7 receitas estão criadas, **ativas no sandbox (test mode)** e
**testadas com run "Concluída"** em cada uma (set/2026) — incluindo a
metadata `situacao=inadimplente` aplicada pelo nº 1 e o refund automático
executado pelo nº 7 (cartão de teste `4000 0000 0000 5423` gera o early
fraud warning). Observação do teste: cancelar uma assinatura `incomplete`
(vira `incomplete_expired`) NÃO acionou o nº 4 — o gatilho de churn dispara
no cancelamento de assinaturas ativas. As mesmas 7 receitas foram
**recriadas e ativadas no modo live** (workflows não migram entre
ambientes; live criado em set/2026, ainda sem execuções).

**Complementos de Billing configurados no live** (Configurações →
Faturamento, set/2026): e-mails ao cliente (lembrete 7 dias antes do fim
do trial — exigência das bandeiras —, expiração de cartão, falha de
pagamento), mensagem "teste encerrado" no descritor do extrato,
atualização de pagamento via página hospedada da Stripe, link por e-mail
para confirmar pagamentos com 3D Secure, Smart Retries (padrão: até 8
tentativas em 2 semanas; esgotadas → cancela a assinatura, o webhook marca
`cancelada`), faturas send_invoice com envio automático + lembretes de não
pagas (vencidas ficam `past_due` — decisão manual, alertada pelo workflow
nº 2) e Portal do cliente com configuração padrão salva (faturas, dados,
formas de pagamento, cancelamento no fim do período com coleta de motivo;
troca de plano/quantidade desativada — é pelo app).

## 8. Taxas e split

- **Taxa da plataforma**: `application_fee_amount` = **1% do valor de face
  com teto de 1 unidade da moeda** (`appFee(valor) = min(valor × 1%, 1)`:
  R$ 50 → R$ 0,50 · R$ 100 ou mais → R$ 1,00; mesma regra em US$/€/¥),
  sempre — independe de quem paga a taxa Stripe.
- **Taxa Stripe**: debitada da conta conectada (direct charge). O diretor
  escolhe na aba *Meios de pagamento* se ela é repassada ao morador:
  - **repasse ativo** → linha "Taxa de conveniência" no checkout com gross-up
    `total = (valor + appFee(valor) + fixo) / (1 − pct)` — o condomínio
    recebe o valor cheio;
  - **repasse inativo** → o condomínio recebe o valor menos taxas.
- Percentuais de referência em `api/stripe/_lib/comum.js` (`TAXAS_METODO`):
  Pix 1,19% + R$ 0 · cartão 3,99% + R$ 0,39. **Conferido em set/2026 contra
  a tabela pública da Stripe Brasil (stripe.com/br/pricing) — valores
  idênticos; a conta está no plano padrão (sem negociação custom).** Se um
  dia houver negociação, ajuste as constantes. Outras tarifas relevantes da
  tabela: cartão internacional +2% (o gross-up não cobre — moradores são
  BR); disputa R$ 55,00 recebida + R$ 55,00 de refutação (devolvida se
  ganhar) — embasa o limiar de R$ 80 do workflow nº 7; Billing 0,7% do
  volume de assinaturas e Invoicing 0,4% por fatura paga (custos da
  plataforma, fora do gross-up); Connect menciona 0,25% de "tarifa de
  entrada" para plataformas que monetizam pagamentos — confirmar com a
  Stripe se se aplica ao nosso application fee fixo.
- Contabilidade: `lancamentos.valor` = valor de face da cobrança;
  `pagamentos.valor_pago` = total bruto pago pelo morador (com conveniência).

## 9. Teste ponta a ponta (test mode)

1. Cadastro novo → paywall → "Iniciar teste gratuito" → cartão `4242 4242
   4242 4242` → licença `teste` com `teste_fim` +30d.
2. Dashboard → test clock/avanço: fim do trial cobra e ativa (`ativa`).
3. Cartão `4000 0000 0000 0341` (falha na cobrança) → `inadimplente` → paywall.
4. Código `PAGOMANUAL` → assinatura ativa sem checkout, fatura enviada
   (dashboard → Faturas); o código fica inativo (uso único). Marcar a fatura
   como paga fora da Stripe mantém `ativa`; deixá-la vencer → `past_due` →
   `inadimplente` → paywall.
5. Planos → troca com licença ativa → invoice de diferença → `trocaAplicada`.
6. Cancelar assinatura → aviso com `acesso_ate`; fim do período → `cancelada`.
7. Condomínio (moeda BRL) → *Meios de pagamento* → país "Brasil" → "Ativar
   recebimento online" → onboarding de teste → status ativo.
8. Gerar cobrança → portal do morador → "Pix (pagamento online)" → pagamento
   de teste → cobrança `paga`, linha em `pagamentos`, receita "Entrada" no
   caixa, application fee (1% c/ teto de R$ 1) na conta da plataforma.
   Replay do webhook não duplica.
9. Pagar após o vencimento → `paga_em_atraso`. Condomínio com moeda de
   gestão ≠ moeda da conta → opção online não aparece e o endpoint recusa
   (409 com a moeda esperada).
10. **Global**: condomínio com moeda USD → país "Estados Unidos" → onboarding
    de teste → cobrança → botão único "Pagar online (cartão e métodos
    locais)" → checkout em USD com métodos dinâmicos → `paga` + application
    fee de min(1%, US$ 1); com repasse ativo, gross-up pela taxa de cartão US.

## 10. Limitações conhecidas (v1) e próximos passos

- **Boleto**: fora do v1 (async de dias, expiração própria). O webhook já
  trata `async_payment_succeeded` — habilitar depois é adicionar o método no
  checkout e uma taxa em `TAXAS_METODO`.
- **Reembolsos/disputas**: tratamento manual no dashboard da Stripe; o status
  `pagamento_divergente` de `cobrancas` é o gancho para automação futura
  (`charge.refunded` / `charge.dispute.*`).
- **Franquia de unidades**: apenas aviso visual — a cobrança de excedente via
  Billing Meters fica para uma fase futura.
- **Países sem Stripe** (PY/AR/BO/CO): condomínios seguem com meios manuais —
  a Stripe não abre conta de recebedor nesses países (são "cross-border
  payouts only", produto restrito a plataformas em US/UK/EEA/CA/CH; a nossa é
  BR). Caminho futuro: Mercado Pago para AR/CO (o seletor de país da seção
  "Pagamento online" foi desenhado para virar roteador de provedores) ou
  entidade US/UE da plataforma.
- **Repasse fora do BRL**: com métodos dinâmicos o método só se conhece no
  checkout, então o gross-up usa a taxa de CARTÃO da região
  (`TAXA_CARTAO_POR_MOEDA`, aproximada) como teto — o condomínio nunca recebe
  menos que o valor de face; confira as tarifas locais reais no dashboard.
- **i18n**: os textos novos ainda estão só em PT (o fallback exibe a chave em
  português nos outros 14 idiomas) — traduzir em `src/lib/i18n.js` e
  `src/lib/langs/*` quando fechar o wording.
- **Workflows → backend**: fase futura — custom action (função remota) dos
  Workflows chamando um endpoint interno (`/api/stripe/automacao`, autenticado
  por segredo compartilhado) para gravar no Supabase, ex.: aviso interno
  automático quando a licença ficar inadimplente ou o KYC pender.

## 11. Segurança

- `integracoes_pagamento` (account id recebedor) e as escritas em
  `saas_assinaturas` ficaram **sem policy client-side** (exceções no
  supabase-rls.sql) — só a service role dos endpoints toca nelas.
- Todos os endpoints `/api/stripe/*` exigem o Bearer da sessão (JWT caseiro)
  e conferem `condominio_id`/perfil; os webhooks validam `stripe-signature`
  com corpo bruto.
- O estado da conta Stripe NUNCA vai em `regras_internas` (o form do diretor
  reescreve esse JSONB inteiro a cada save) — só o flag `stripe_repasse`.
