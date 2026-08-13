# Integração Commet — licença SaaS (assinatura do plano do condomínio)

O CondoMaster Pro usa o **Commet** (commet.co) SOMENTE para cobrar a licença
SaaS dos condomínios clientes (as cobranças condominiais são pagas pelos meios
cadastrados no próprio condomínio). O fluxo implementado:

1. O painel (tela Planos ou Paywall) chama `POST /api/commet/assinatura`.
2. A função de backend cria/reaproveita o plano e o cliente no Commet e abre
   uma assinatura recorrente, devolvendo a `checkoutUrl` da página hospedada.
3. O cliente paga na página do Commet (qualquer cartão internacional).
4. O Commet chama `POST /api/commet/webhook` — a assinatura HMAC-SHA256
   (header `commet-signature`) é validada com o `COMMET_WEBHOOK_SECRET` e o
   status da licença é sincronizado em `saas_assinaturas`
   (`subscription.activated` → `ativa`, etc.).

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
     --events '["subscription.activated","subscription.reactivated","subscription.plan_changed","trial.started","trial.will_end","trial.expired","trial.converted","subscription.past_due","subscription.canceled"]'
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

- `api/commet/assinatura.js` — cria/reaproveita plano e cliente no Commet e
  abre o checkout da assinatura (também faz upgrade/downgrade via `changePlan`).
- `api/commet/webhook.js` — sincroniza o status da licença em `saas_assinaturas`.
- `api/commet/licenca.js` — verificação ativa ("Já paguei — verificar").
- `api/commet/plano.js` — troca o plano da assinatura no Supabase.
- `api/commet/cancelar-assinatura.js` — cancelamento pelo cliente (agendado:
  acesso até o fim do período pago; o webhook marca "cancelada" ao terminar).
- `api/commet/estender-teste.js` — extensão única do teste gratuito (+30 dias).
- `src/lib/api.js` → `assinarLicencaCommet()`, `trocarPlanoLicenca()`,
  `verificarLicencaCommet()` — chamadas do front.

## Teste gratuito — 30 dias com cartão antecipado

- Todo condomínio novo nasce com `saas_assinaturas.status = 'teste'` e
  `teste_fim = NULL`. O paywall pede a ativação do teste: o checkout do Commet
  **salva o cartão sem cobrar** (trial de 30 dias configurado nos preços dos
  planos via `trialDays`) e o webhook `trial.started` grava `teste_fim` — é
  essa data que libera o acesso no app.
- Ao fim do teste o Commet **cobra o cartão automaticamente** e dispara
  `trial.expired` → licença `ativa`.
- **Extensão única de +30 dias** (self-service do diretor, tela Planos):
  `api/commet/estender-teste.js`. O Commet não tem API para mover o fim de um
  trial em andamento, então o endpoint cancela a assinatura em teste (reason
  `extensao_teste_30d`, ignorado pelo webhook) e recria outra com
  `customTrialDays = dias restantes + 30` (SDK ≥ 9), reaproveitando o cartão
  salvo. `teste_estendido = true` trava a segunda extensão.
- Troca de plano durante o teste é bloqueada (o `changePlan` do Commet
  converte o trial e cobra na hora).
- Quem já iniciou um teste (`teste_fim` preenchido) nunca ganha outro:
  o checkout seguinte vai com `skipTrial: true`.
- Rode `supabase-teste-gratis.sql` uma vez no SQL Editor (colunas
  `teste_fim`/`teste_estendido`) e registre os eventos `trial.*` no webhook.

## Moeda — sempre USD

- A licença SaaS é cobrada **sempre em dólar (USD)**. A moeda é decisão do
  backend: fixa, validada e não parametrizável pelo cliente. A moeda escolhida
  no cadastro do condomínio é só de **exibição** das finanças internas.
- `COMMET_CURRENCY=usd` é obrigatório no `.env` e nas variáveis de ambiente do
  deploy (Vercel → Settings → Environment Variables) — o handler de assinatura
  recusa qualquer outro valor com erro claro, e moeda vinda no corpo da
  requisição é rejeitada.
- **Passo manual**: a conta/organização Commet deve estar configurada em
  **USD** (o SDK não tem parâmetro de moeda — a moeda-base dos preços vem da
  conta). Confira no painel do Commet.
- Os planos usados são `condomaster_<plano>_usd` (nome "CondoMaster <plano>
  (USD)"). Os três planos legados em BRL (code sem sufixo `_usd`) ficam órfãos
  no Commet: fora de plan groups e nunca reutilizados pelo lookup — não apagar
  (histórico), não usar.
- Não configurar *regional pricing* nos planos `_usd` — o backend recusa
  planos com preços regionais (permitiriam checkout em moeda local).
- O webhook só **ativa** a licença se a fatura do evento veio em USD
  (`invoiceCurrency`); eventos de bloqueio passam sempre.

## Observações

- **Assinaturas SaaS** — a mensalidade dos condomínios clientes
  usa `api/commet/assinatura.js`: cria/reaproveita o plano no Commet (code
  `condomaster_<plano>_usd`, preços mensal e anual em centavos de dólar), o
  cliente (externalId = `condominio_id`) e a assinatura recorrente,
  devolvendo a `checkoutUrl`.
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
