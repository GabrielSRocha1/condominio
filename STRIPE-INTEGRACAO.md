# Integração Stripe — CondoMaster Pro

A Stripe cobre os **dois fluxos de dinheiro** do sistema:

| Fluxo | Produto Stripe | Quem recebe | Moeda |
|---|---|---|---|
| **Licença SaaS** (mensal/anual do condomínio-cliente) | Billing + Checkout | Conta da **plataforma** (Stripe Brasil, CNPJ) | BRL |
| **Cobranças condominiais** (morador → condomínio) | Connect (direct charge) + Checkout | Conta **conectada do condomínio**; a plataforma retém **1%** (application fee) | BRL |

Os meios manuais (carteira Verum Wallet, transferência bancária, dinheiro)
continuam existindo e são a única via para condomínios fora do Brasil — a
Stripe não opera contas de empresas em Paraguai, Argentina, Bolívia e
Colômbia, e o Connect transfronteiriço não alcança a América Latina.

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
  Morador → /api/stripe/checkout-cobranca → Checkout (payment, Pix|cartão)
    criado NA conta conectada ({ stripeAccount }) + application_fee_amount = 1%
    → condomínio = merchant of record (recibo no nome dele, taxa Stripe dele)
    → 1% cai na conta da plataforma
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
| `api/stripe/connect/onboarding.js` | cria a conta conectada BR + Account Link |
| `api/stripe/connect/status.js` | flags da conta (charges/payouts/pendências) |
| `api/stripe/webhook-connect.js` | account.updated + baixa das cobranças pagas |
| `api/stripe/checkout-cobranca.js` | checkout de cobrança (direct charge + 1%) |
| `api/stripe/cobranca-status.js` | polling do retorno + baixa (mesma RPC) |
| `scripts/preparar-stripe-producao.mjs` | products/prices BRL, PAGOMANUAL, webhooks |
| `supabase-stripe.sql` | migração (enums, colunas, RLS, RPC) |

## 3. Variáveis de ambiente (`.env` local + Vercel)

```
STRIPE_SECRET_KEY=sk_test_...            # sk_live_ em produção
STRIPE_WEBHOOK_SECRET=whsec_...          # endpoint /api/stripe/webhook
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...  # endpoint /api/stripe/webhook-connect
```

Sem chave publicável: todo pagamento usa o Checkout hospedado (sem Stripe.js
no front, sem escopo PCI). Diagnóstico: `GET /api/auth/diag`.

## 4. Passo a passo de ativação

1. **Banco** — no SQL Editor do Supabase, rode o `supabase-stripe.sql` em
   DUAS execuções (RUN 1 = enums; depois RUN 2). Antes do RUN 2, descomente e
   defina os **preços BRL** dos planos (seção F).
2. **Conta Stripe** — crie a conta Stripe Brasil (CNPJ da plataforma), copie a
   `sk_test_` para o `.env`.
3. **Catálogo** — `node scripts/preparar-stripe-producao.mjs --executar`
   (cria products/prices com lookup_key `condomaster_<plano>_<ciclo>_brl`,
   o código de ativação `PAGOMANUAL`, e registra os 2 webhooks — guarde os
   `whsec_` impressos).
4. **Dashboard** —
   - Pagamentos → Métodos: ativar cartões e **Pix** (conta BR exige solicitação);
   - Billing → Portal do cliente: salvar a configuração padrão;
   - Connect → completar o **platform profile** e o branding do onboarding.
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

## 7. Taxas e split

- **1% da plataforma**: `application_fee_amount` = 1% do **valor de face** da
  cobrança, sempre — independe de quem paga a taxa Stripe.
- **Taxa Stripe**: debitada da conta conectada (direct charge). O diretor
  escolhe na aba *Meios de pagamento* se ela é repassada ao morador:
  - **repasse ativo** → linha "Taxa de conveniência" no checkout com gross-up
    `total = (valor × 1,01 + fixo) / (1 − pct)` — o condomínio recebe o valor
    cheio;
  - **repasse inativo** → o condomínio recebe o valor menos taxas.
- Percentuais de referência em `api/stripe/_lib/comum.js` (`TAXAS_METODO`):
  Pix 1,19% + R$ 0 · cartão 3,99% + R$ 0,39. **Confirme as tarifas da sua
  conta no dashboard e ajuste as constantes se divergirem.**
- Contabilidade: `lancamentos.valor` = valor de face da cobrança;
  `pagamentos.valor_pago` = total bruto pago pelo morador (com conveniência).

## 8. Teste ponta a ponta (test mode)

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
7. Condomínio (moeda BRL) → *Meios de pagamento* → "Ativar recebimento
   online" → onboarding de teste → status ativo.
8. Gerar cobrança → portal do morador → "Pix (pagamento online)" → pagamento
   de teste → cobrança `paga`, linha em `pagamentos`, receita "Entrada" no
   caixa, 1% na conta da plataforma. Replay do webhook não duplica.
9. Pagar após o vencimento → `paga_em_atraso`. Condomínio com moeda ≠ BRL →
   opção online não aparece e o endpoint recusa.

## 9. Limitações conhecidas (v1) e próximos passos

- **Boleto**: fora do v1 (async de dias, expiração própria). O webhook já
  trata `async_payment_succeeded` — habilitar depois é adicionar o método no
  checkout e uma taxa em `TAXAS_METODO`.
- **Reembolsos/disputas**: tratamento manual no dashboard da Stripe; o status
  `pagamento_divergente` de `cobrancas` é o gancho para automação futura
  (`charge.refunded` / `charge.dispute.*`).
- **Franquia de unidades**: apenas aviso visual — a cobrança de excedente via
  Billing Meters fica para uma fase futura.
- **Países sem Stripe** (PY/AR/BO/CO): condomínios seguem com meios manuais.
  Caminho futuro para AR/CO: Global Payouts (exige entidade US/UK e análise
  de compliance — plataforma vira responsável pelos fundos).
- **i18n**: os textos novos ainda estão só em PT (o fallback exibe a chave em
  português nos outros 14 idiomas) — traduzir em `src/lib/i18n.js` e
  `src/lib/langs/*` quando fechar o wording.

## 10. Segurança

- `integracoes_pagamento` (account id recebedor) e as escritas em
  `saas_assinaturas` ficaram **sem policy client-side** (supabase-stripe.sql,
  seção C) — só a service role dos endpoints toca nelas.
- Todos os endpoints `/api/stripe/*` exigem o Bearer da sessão (JWT caseiro)
  e conferem `condominio_id`/perfil; os webhooks validam `stripe-signature`
  com corpo bruto.
- O estado da conta Stripe NUNCA vai em `regras_internas` (o form do diretor
  reescreve esse JSONB inteiro a cada save) — só o flag `stripe_repasse`.
