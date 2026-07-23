# Integração Commet — recebimento e confirmação de pagamentos

O CondoMaster Pro usa o **Commet** (commet.co) como conta de recebimento do SaaS.
O fluxo implementado:

1. O síndico/morador clica em **Pagar online** → o front chama `POST /api/commet/checkout`.
2. A função de backend cria um link de pagamento (`commet.payments.create`) com o valor
   da cobrança em centavos e `metadata.cobrancaId`, e devolve a `checkoutUrl`.
3. O cliente paga na página hospedada do Commet (qualquer cartão).
4. O Commet chama `POST /api/commet/webhook` com o evento **`payment.received`** —
   a assinatura HMAC-SHA256 (header `commet-signature`) é validada com o
   `COMMET_WEBHOOK_SECRET` e a cobrança é **confirmada**: status vira `paga`
   (ou `paga_em_atraso`) e o pagamento é registrado na tabela `pagamentos`
   (idempotente via `provider_event_id`).

## Passo a passo para ativar

1. **Credenciais** — crie a conta em https://commet.co e preencha no `.env`
   (e nas variáveis de ambiente do deploy):
   - `COMMET_API_KEY` — `ck_sandbox_...` para testes, `ck_live_...` em produção
     (a chave define o ambiente; não há flag extra).
   - `COMMET_WEBHOOK_SECRET` — `whsec_...`, gerado ao criar o webhook (passo 3).
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` — usados pelas funções de
     backend para dar baixa nas cobranças. **Nunca** prefixe nada disso com `VITE_`.

2. **Deploy** — as funções em `/api` sobem automaticamente na Vercel (ou Netlify
   com adaptação). Em `npm run dev` local elas **não** rodam; para testar use
   `vercel dev` ou o encaminhador do Commet: `commet listen 3000`.

3. **Webhook** — com a CLI (`npm i -g commet`, depois `commet login`):
   ```bash
   commet webhooks create --url https://SEU-DOMINIO/api/commet/webhook \
     --events '["payment.received","payment.failed"]'
   ```
   Guarde o `whsec_...` devolvido em `COMMET_WEBHOOK_SECRET`.

4. **Payouts (receber na sua conta bancária)** — também pela CLI:
   ```bash
   # 1. KYC da conta (pessoa física ou empresa)
   commet payouts complete-verification
   # 2. Conta bancária de destino
   commet payouts add-bank-account --set-default
   # 3. Saque (valor em centavos; mínimo 1000)
   commet payouts request --amount 50000 --description "Saque semanal"
   ```

## Arquivos da integração

- `api/commet/checkout.js` — cria o link de pagamento (usa a API key secreta).
- `api/commet/webhook.js` — confirma o pagamento e dá baixa no Supabase.
- `src/lib/api.js` → `pagarComCommet()` — chamada do front (só recebe a URL).
- Botões "Pagar online": modal de QR da tela Cobranças e modal de pagamento
  do portal do morador.

## Observações

- Moeda padrão `brl` (`COMMET_CURRENCY` no `.env`).
- A cobrança direcionada guarda o `provider_charge_id` (`pay_...`) — o webhook
  encontra a cobrança por `metadata.cobrancaId` ou por esse id.
- **Assinaturas SaaS (implementado)** — a mensalidade dos condomínios clientes
  usa `api/commet/assinatura.js`: cria/reaproveita o plano no Commet (code
  `condomaster_<plano>`, preço mensal em centavos), o cliente (externalId =
  `condominio_id`) e a assinatura recorrente, devolvendo a `checkoutUrl`.
  O acesso ao sistema é **bloqueado por paywall**: qualquer perfil do
  condomínio (exceto a administradora, dona do SaaS) só entra com a
  assinatura `ativa` — caso contrário cai na tela "Assinatura pendente",
  que abre o checkout e verifica a confirmação em `api/commet/licenca.js`
  (consulta direta ao Commet, funciona mesmo sem o webhook — útil em dev).
  Todo condomínio criado no primeiro acesso nasce com assinatura `teste`
  no plano Essencial. O webhook trata
  `subscription.activated/reactivated` e `trial.converted` (→ `ativa`, atualiza
  `renovacao`), `subscription.past_due` (→ `inadimplente`) e
  `subscription.canceled` (→ `cancelada`) na tabela `saas_assinaturas`.
  Inclua esses eventos ao registrar o webhook.
