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
| Pagamentos | Stripe — Billing (licença SaaS) e Connect (cobranças condominiais); dLocal Go para os países LATAM que o Connect não atende, em **Fase 0** (descoberta — nada em produção) |

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

   5. `supabase-encargos.sql` — baixas lançam no caixa o valor recebido
      (principal + encargos de atraso); sem ele o app funciona e o caixa
      segue lançando só o valor original
   6. `supabase-planilhas.sql` — histórico de cobranças importado de
      planilha (tabelas `planilhas_cobranca` e `planilha_cobranca_linhas`,
      com as próprias policies). Opcional: sem ele, só a aba
      "Histórico (planilha)" da tela Cobranças fica indisponível.
   7. `supabase-fundo-reserva.sql` — a baixa divide o lançamento quando o
      FR% está embutido na cobrança (Taxa condominial + Fundo de reserva) e
      faz o backfill das cobranças já pagas; sem ele o app funciona e o
      card do fundo soma só os lançamentos manuais da categoria
   8. `supabase-notificacoes.sql` — o sino da gestão ganha a seção
      "Movimentações": triggers gravam uma notificação por entrada recebida
      (baixa manual, lote, Stripe, cripto, receita avulsa) e por conta paga,
      e o app sonda a cada 30 s; movimentação nova vinda de outra janela
      também recarrega o painel inteiro (saldo, cards e pendências — não só
      o sino), então diretor/síndico/tesouraria acompanham sem F5. Sem ele
      o app funciona e o sino mostra só as pendências

   Banco **já instalado**? Não re-rode o schema inteiro — rode apenas o que
   faltar, na ordem: o `alter table usuarios add column if not exists
   preferencias …` que vem logo abaixo do `create table usuarios` (idioma por
   conta), `supabase-seguranca4.sql` e `supabase-seguranca5.sql` ("Esqueci
   minha senha"), `supabase-encargos.sql`, `supabase-planilhas.sql`,
   `supabase-fundo-reserva.sql` e `supabase-notificacoes.sql` (passos 5–8
   acima — todos idempotentes e com degrade aberto: sem eles o app funciona
   com o comportamento antigo).
   Atenção: re-rodar o `supabase-rls.sql` exige re-rodar seguranca 1→5 em
   seguida (ele derruba e recria todas as policies).
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
| `testar-dlocal.mjs` | sondas da Fase 0 da dLocal Go: credenciais, colaborações de split e matriz país × moeda (`--live` só lê) |
| `testar-planilha-cobrancas.mjs` | sondas do histórico por planilha: colunas livres, layout "planilla de mora" (blocos por ano), conciliação, resolução de unidade tolerante, dedupe e a prova de que o histórico não entra no caixa |
| `testar-manuais-seed.mjs` / `testar-manuais-fluxo.mjs` | monta o condomínio TESTE Manuais e roda o fluxo completo de pagamento (cripto, informado, divergente, dinheiro, idempotência) |
| `testar-refresh-race.mjs` | sondas da rotação atômica do refresh token: corrida de renovação sem derrubar a família e o anti-roubo intacto |
| `testar-encargos.mjs` | sondas dos encargos de atraso (multa + juros): motor puro, RLS da configuração, informe pelo valor devido e o caixa com encargos |
| `testar-caixa-cargos.mjs` | sondas do caixa com âncora (± e corte inclusivo — a âncora é o caixa no INÍCIO do dia e o próprio dia soma), dos cargos de gestão e do cargo no perfil de acesso |
| `testar-unidades-lote.mjs` | sondas da criação de unidades em lote: faixas, letras (andar espelhado e um por andar) e validações |
| `testar-receber-lote.mjs` | sondas do recebimento em lote (motor puro): desconto arredondado por item, âncora do mesmo responsável, ordenação e lotes inválidos |
| `testar-fundo-reserva.mjs` | sondas do fundo de reserva na baixa: divisão taxa + fundo pelo FR% embutido, mora fora do fundo e desconto proporcional (pula se o supabase-fundo-reserva.sql não rodou) |
| `testar-notificacoes.mjs` | sondas do feed de movimentações do sino (motor puro): os 3 eventos, fallback de evento desconhecido, payload corrompido, contagem/destaque de não-vistas por instante absoluto, hora no fuso local e o topo do feed que dispara o reload entre janelas |
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
- `DLOCAL-INTEGRACAO.md` — dLocal Go (LATAM): chaves, achados da Fase 0 e o que falta decidir
- `MODELAGEM-BANCO-DE-DADOS.tsv` — dicionário de dados original (v1)
