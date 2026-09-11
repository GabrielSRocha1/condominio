# CondoMaster Pro

SaaS de gestão de condomínios: financeiro com aprovações, cobranças com
pagamento online (Stripe) e conciliação manual (transferência/cripto/dinheiro),
multas com fluxo de defesa, comunicados, documentos timbrados, chamados de
manutenção, portaria com QR de acesso e portal do morador. Interface em 15
idiomas, instalável como PWA.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + Vite + Tailwind 4 (`CondoMasterPro.jsx` + `src/`) |
| Backend | Funções serverless Vercel (`api/`) — auth própria com JWT + refresh cookie |
| Banco/Storage | Supabase (PostgreSQL com RLS por condomínio + bucket `documentos`) |
| Pagamentos | Stripe — Billing (licença SaaS) e Connect (cobranças condominiais) |

## Rodando do zero

1. **Dependências** — `npm install`
2. **Variáveis** — preencha o `.env` (cada chave está documentada no próprio
   arquivo; os mesmos valores vão para as env vars da Vercel no deploy —
   exceto `STRIPE_SECRET_KEY_LIVE`, que é só do script local de provisionamento).
3. **Banco** — no SQL Editor do Supabase, rode nesta ordem:
   1. `supabase-schema.sql` — tabelas, enums, RPCs de pagamento e seeds
   2. `supabase-storage.sql` — bucket `documentos` + policies de upload
   3. `supabase-rls.sql` — isolamento por condomínio (substitui a policy de dev)
   4. `supabase-seguranca.sql` → `supabase-seguranca2.sql` → `supabase-seguranca3.sql`
      — sessões/refresh, idempotência de API e auditoria imutável (detalhes no
      `SEGURANCA.md`)
4. **Stripe** — `node scripts/preparar-stripe-producao.mjs --executar` cria
   products/prices, o promotion code de ativação manual e os 2 webhooks
   (guarde os `whsec_` no `.env`). Passo a passo completo no `STRIPE-INTEGRACAO.md`.
5. **Subir** — `npm run dev`

## Scripts úteis (`node scripts/<nome>.mjs`)

| Script | Para quê |
|---|---|
| `seed.mjs` | popula dados de demonstração |
| `testar-seguranca.mjs` / `2` / `3` | sondas de regressão das etapas de segurança |
| `relatorio-seguranca.mjs` | auditoria semanal (sessões, eventos, anomalias) |
| `emergencia-sessoes.mjs` | resposta a incidente: revoga sessões em massa |
| `verificar-segredos-bundle.mjs` | confere que nenhum segredo vazou no build |
| `preparar-stripe-producao.mjs` | provisiona a conta Stripe (test ou `--live`) |
| `recriar-webhooks-live.mjs` | recria webhooks live quando o secret se perde |
| `criar-codigo-ativacao.mjs` | gera código de ativação por cliente (test ou `--live`) |
| `supabase-limpar-dados.sql` + `limpar-storage.mjs` | zera dados de teste |

## Documentação

- `SEGURANCA.md` — modelo de ameaças, camadas aplicadas e rotina de operação
- `STRIPE-INTEGRACAO.md` — arquitetura de pagamentos e ativação em produção
- `MODELAGEM-BANCO-DE-DADOS.tsv` — dicionário de dados original (v1)
