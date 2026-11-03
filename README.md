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
      card do fundo soma só os lançamentos manuais da categoria.
      É o arquivo DEFINITIVO da família da baixa: define
      `registrar_pagamento_manual`, `registrar_pagamento_stripe` e — desde
      02/11/2026 — `rejeitar_pagamento_informado`, que morava no schema e
      veio para cá para poder ser corrigida sem re-rodar o schema inteiro
      (o primeiro `create type` dele falha com "type already exists").
      As três conferem AUTORIDADE por permissão (`jwt_pode`), não por nome
      de perfil, e o ESCOPO (condomínio da linha) por dentro
   8. `supabase-notificacoes.sql` — o sino da gestão ganha a seção
      "Movimentações": triggers gravam uma notificação por entrada recebida
      (baixa manual, lote, Stripe, cripto, receita avulsa) e por conta paga,
      e o app sonda a cada 30 s; movimentação nova vinda de outra janela
      também recarrega o painel inteiro (saldo, cards e pendências — não só
      o sino), então diretor/síndico/tesouraria acompanham sem F5. Sem ele
      o app funciona e o sino mostra só as pendências
   9. `supabase-planilha-sync.sql` — sincroniza o Histórico (planilha) com
      as cobranças: pagamento carimba a linha (a mora congela na data),
      a baixa indevida cancela a cobrança (status `cancelada`, auditada) e
      zera a linha, e cobrança nova vira linha do histórico — criando a
      planilha padrão se o condomínio não tem. Exige o
      `supabase-planilhas.sql` antes. Sem ele o app funciona com o
      comportamento antigo e o botão "Baixa indevida" avisa para rodá-lo
   10. `supabase-permissoes.sql` — **liga a matriz de permissões**: o que
      cada perfil pode passa a vir de `perfil_permissoes` (telas + ações
      sensíveis), com override por condomínio editável em Gerenciar Acessos
      → Permissões. Recria as policies de escrita por PERMISSÃO (não mais
      por nome de perfil), põe gatilho de aprovação em `lancamentos` e
      `penalidades` e embrulha as RPCs com guarda de perfil. **Deve rodar
      por último**: ele recria policies que os arquivos anteriores criam.
      O padrão semeado reproduz o comportamento anterior — rodar não muda
      poder de ninguém, com UMA exceção deliberada: a tesouraria perde a
      escrita em `penalidades` e `comunicados`, telas que ela nunca teve
      (o banco era mais frouxo que a interface). Sem ele o app funciona com
      o comportamento antigo e a aba Permissões abre em leitura, avisando.

   11. `supabase-aprovacoes.sql` — perfil **Administrador** (`administrador_predial`):
      quem administra o prédio por contrato. Opera e escreve como o diretor,
      e o que ele faz **vale na hora** — criar, alterar e excluir. Quatro
      exceções, nenhuma delas um código de permissão: não cria acesso de
      Diretor, não exclui acesso de Diretor (as duas em `api/auth/acessos.js`,
      pelo perfil de quem pede), não exclui a pessoa ligada ao Diretor
      (gatilho `trg_a_protege_diretor`, seção E) e não vê a tela **Planos**
      (`tela.planos` + `licenca.gerir` ficam fora e são vedadas na matriz).
      O síndico opera do mesmo jeito.
      A **fila de aprovação** que este arquivo instalava até 01/11/2026
      continua aqui, instalada e **inerte**: `perfis_sob_aprovacao()` devolve
      vazio (seção A0), nada novo entra em `alteracoes_pendentes`, a tela
      Aprovações saiu do menu e as pendências que já existiam ficam
      **congeladas** (preservadas, nunca aplicadas — liste-as com a consulta
      do rodapé do arquivo). Devolver perfis àquela função re-arma o
      mecanismo inteiro, mas aí os dois espelhos JS têm de voltar junto
      (`PERFIS_SOB_APROVACAO` em `src/lib/aprovacoes.js` e em
      `src/lib/permissoes.js`) — a sonda compara os três.
      Exige o `supabase-permissoes.sql` antes. Sem ele o perfil não existe e
      nada muda.

   Banco **já instalado**? Não re-rode o schema inteiro — rode apenas o que
   faltar, na ordem: o `alter table usuarios add column if not exists
   preferencias …` que vem logo abaixo do `create table usuarios` (idioma por
   conta), `supabase-seguranca4.sql` e `supabase-seguranca5.sql` ("Esqueci
   minha senha"), `supabase-encargos.sql`, `supabase-planilhas.sql`,
   `supabase-fundo-reserva.sql`, `supabase-notificacoes.sql`,
   `supabase-planilha-sync.sql`, `supabase-permissoes.sql` e
   `supabase-aprovacoes.sql` (passos 5–11
   acima — todos idempotentes e com degrade aberto: sem eles o app funciona
   com o comportamento antigo).
   Licença ancorada em USD (antes BRL)? Rode também o UPDATE dos planos:

   ```sql
   -- Licença ancorada em USD — ver o contrato de moeda em supabase-schema.sql (saas_planos)
   update saas_planos set preco_mensal = 100.00, preco_anual = 1000.00, atualizado_em = now() where nome = 'Essencial';
   update saas_planos set preco_mensal = 180.00, preco_anual = 1800.00, atualizado_em = now() where nome = 'Standard';
   update saas_planos set preco_mensal = 420.00, preco_anual = 4200.00, atualizado_em = now() where nome = 'Premium';
   ```

   Atenção: re-rodar o `supabase-rls.sql` exige re-rodar seguranca 1→5 **e o
   `supabase-permissoes.sql`** em seguida (ele derruba e recria todas as
   policies — inclusive as que decidem por permissão). E re-rodar o
   `supabase-permissoes.sql` exige re-rodar o `supabase-aprovacoes.sql`
   depois: ele recria os embrulhos das RPCs de baixa/cancelamento sem o
   desvio da fila, e é o passo 11 que os devolve ao estado atual.
4. **Stripe** — `node scripts/preparar-stripe-producao.mjs --cotacao <USD→BRL> --executar`
   cria products/prices (base BRL = USD × cotação + `currency_options.usd`
   exato — a licença é ancorada em USD), o promotion code de ativação manual
   e os 2 webhooks (guarde os `whsec_` no `.env`). Passo a passo completo no
   `STRIPE-INTEGRACAO.md`.
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
| `testar-planilha-sync.mjs` | sondas da sincronização planilha ⇄ cobranças: situações paga/indevida, mora congelada no pagamento, triggers (cobrança nova → linha; pagamento → carimbo), RPC `cancelar_cobranca` (guardas + auditoria + caixa intocado), re-emissão reusando a linha e import preservando carimbos (pula se o supabase-planilha-sync.sql não rodou) |
| `testar-manuais-seed.mjs` / `testar-manuais-fluxo.mjs` | monta o condomínio TESTE Manuais e roda o fluxo completo de pagamento (cripto, informado, divergente, dinheiro, idempotência) |
| `testar-refresh-race.mjs` | sondas da rotação atômica do refresh token: corrida de renovação sem derrubar a família e o anti-roubo intacto |
| `testar-encargos.mjs` | sondas dos encargos de atraso (multa + juros): motor puro, RLS da configuração, informe pelo valor devido e o caixa com encargos |
| `testar-caixa-cargos.mjs` | sondas do caixa com âncora (± e corte inclusivo — a âncora é o caixa no INÍCIO do dia e o próprio dia soma), dos cargos de gestão e do cargo no perfil de acesso |
| `testar-unidades-lote.mjs` | sondas da criação de unidades em lote: faixas, letras (andar espelhado e um por andar) e validações |
| `testar-receber-lote.mjs` | sondas do recebimento em lote (motor puro): desconto arredondado por item, âncora do mesmo responsável, ordenação e lotes inválidos |
| `testar-fundo-reserva.mjs` | sondas do fundo de reserva na baixa: divisão taxa + fundo pelo FR% embutido, mora fora do fundo e desconto proporcional (pula se o supabase-fundo-reserva.sql não rodou) |
| `testar-notificacoes.mjs` | sondas do feed de movimentações do sino (motor puro): os 3 eventos, fallback de evento desconhecido, payload corrompido, contagem/destaque de não-vistas por instante absoluto, hora no fuso local e o topo do feed que dispara o reload entre janelas |
| `testar-permissoes.mjs` | sondas da matriz de permissões: catálogo, padrão que reproduz o comportamento pré-matriz, override que SUBSTITUI (e zera) o padrão, paridade JS ≡ SQL ≡ NAV e, com banco, policies por permissão + gatilho de aprovação + blindagem da própria matriz (bloco B pula se o supabase-permissoes.sql não rodou) |
| `testar-webhook-stripe.mjs` | sondas da autenticação dos webhooks da Stripe: corpo bruto preservado byte a byte (inclusive multibyte partido entre chunks), recusa de corpo re-serializado e a contingência que confirma o evento na própria Stripe quando a plataforma já parseou o corpo |
| `testar-aprovacoes.mjs` | sondas do Administrador predial: a fila está desarmada nos três espelhos (SQL + 2 JS) e o mecanismo segue instalado; a prova no banco de que a escrita dele ENTRA na hora e nada é enfileirado; e as 4 exceções recusadas de verdade — criar/remover acesso de Diretor, excluir a pessoa do Diretor (pelas duas ligações, mais o rebaixamento do papel) e Planos/licença negadas pelo próprio `jwt_pode`. Inclui o ACL de `executar_acao` e o retrato das pendências congeladas (nenhuma é tocada) |
| `testar-combo.mjs` | sondas do dropdown com busca (`src/lib/combo.js`): filtro sem acento/caixa com termos em qualquer ordem, corte entre lista curta (continua `<select>` nativo, melhor no celular) e longa — e, no fonte, as armadilhas de montagem: lista em posição fixa (o modal tem `overflow-y-auto` e cortaria uma absoluta), Enter que escolhe em vez de enviar o formulário, `required` no campo visível (o escondido fica fora da validação) e nenhum `<select>` cru de unidade/pessoa de volta |
| `relatorio-seguranca.mjs` | auditoria semanal (sessões, eventos, anomalias) |
| `emergencia-sessoes.mjs` | resposta a incidente: revoga sessões em massa |
| `verificar-segredos-bundle.mjs` | confere que nenhum segredo vazou no build |
| `preparar-stripe-producao.mjs` | provisiona a conta Stripe (test ou `--live`); exige `--cotacao <USD→BRL>` — licença ancorada em USD, base BRL |
| `migrar-assinaturas-precos-novos.mjs` | move assinaturas vivas dos prices antigos para os novos na renovação (dry-run por padrão; rodar só após avisar os clientes) |
| `recriar-webhooks-live.mjs` | recria webhooks live quando o secret se perde |
| `criar-codigo-ativacao.mjs` | gera código de ativação por cliente (test ou `--live`) |
| `supabase-limpar-dados.sql` + `limpar-storage.mjs` | zera dados de teste |

## Documentação

- `SEGURANCA.md` — modelo de ameaças, camadas aplicadas e rotina de operação
- `STRIPE-INTEGRACAO.md` — arquitetura de pagamentos e ativação em produção
- `DLOCAL-INTEGRACAO.md` — dLocal Go (LATAM): chaves, achados da Fase 0 e o que falta decidir
- `MODELAGEM-BANCO-DE-DADOS.tsv` — dicionário de dados original (v1)
