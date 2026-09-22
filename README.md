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
      → `supabase-seguranca4.sql` → `supabase-seguranca5.sql` — sessões/refresh,
      idempotência de API, auditoria imutável e recuperação de senha: por
      código para tesouraria/morador (Etapa 4) e por link enviado ao e-mail
      para diretor/síndico (Etapa 5 — exige as envs `SMTP_HOST/PORT/USER/PASS`;
      detalhes no `SEGURANCA.md`)

   Banco **já instalado**? Não re-rode o schema inteiro — rode apenas o
   `alter table usuarios add column if not exists preferencias …` que vem logo
   abaixo do `create table usuarios` (guarda o idioma escolhido por cada conta)
   e os `supabase-seguranca4.sql` e `supabase-seguranca5.sql` (habilitam o
   "Esqueci minha senha" da tela de entrada — sem eles o restante segue
   funcionando).
4. **Stripe** — `node scripts/preparar-stripe-producao.mjs --executar` cria
   products/prices, o promotion code de ativação manual e os 2 webhooks
   (guarde os `whsec_` no `.env`). Passo a passo completo no `STRIPE-INTEGRACAO.md`.
5. **Subir** — `npm run dev`

## Scripts úteis (`node scripts/<nome>.mjs`)

| Script | Para quê |
|---|---|
| `seed.mjs` | popula dados de demonstração |
| `testar-seguranca.mjs` / `2` / `3` | sondas de regressão das etapas de segurança |
| `testar-recuperacao.mjs` | sondas da recuperação de senha — código (Etapa 4) e link por e-mail (Etapa 5) |
| `testar-idioma-moeda.mjs` | sondas do idioma por IP, da preferência no banco e da semente de moeda |
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
