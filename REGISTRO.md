# REGISTRO do projeto — CondoMaster Pro

Registro vivo de tudo que é pertinente ao aplicativo: estado do sistema, decisões, convenções
e o histórico do que entrou em produção. **Toda mudança relevante (feature, correção, reparo de
dados, decisão de arquitetura) ganha uma entrada aqui, no topo do histórico.** Documentos por
tema: [README.md](README.md) (visão geral + instalação), [SEGURANCA.md](SEGURANCA.md),
[STRIPE-INTEGRACAO.md](STRIPE-INTEGRACAO.md), [DLOCAL-INTEGRACAO.md](DLOCAL-INTEGRACAO.md),
`MODELAGEM-BANCO-DE-DADOS.tsv`.

## O sistema em uma olhada

- **Produto**: SaaS de gestão de condomínios (financeiro com aprovações, cobranças com QR e
  pagamento online, multas, comunicados, documentos, portaria, portal do morador), 15 idiomas,
  PWA. Espanhol é o idioma de entrada; gestão multi-moeda (Gs., R$, US$…).
- **Stack**: React 18 + Vite + Tailwind 4 (tela única `CondoMasterPro.jsx` + módulos em
  `src/lib/`), funções serverless Vercel (`api/`), Supabase (Postgres com RLS por condomínio),
  Stripe (Billing para a licença; Connect para as cobranças), dLocal Go em Fase 0.
- **Instalação do banco**: 13 arquivos SQL em ordem — a lista canônica está no README.
  Regra prática: re-rodar `supabase-rls.sql` exige re-rodar `seguranca 1→5`, `permissoes`,
  `historico` e `reservas-assembleias` depois; `supabase-fundo-reserva.sql` é o arquivo
  DEFINITIVO das RPCs de baixa; re-rodar `seguranca3` exige re-rodar `historico` (policy
  de `auditoria_eventos`).
- **Produção**: Vercel (chaves Stripe LIVE só lá; o `.env` local fica em TEST).

## Convenções de trabalho

- **Módulo puro sondável**: regra de negócio nova nasce em `src/lib/*.js` puro (zero/poucos
  imports) e ganha sonda em `scripts/testar-*.mjs` rodável no Node — `api.js` não importa no
  Node, então o que precisa de prova fica fora dele.
- **Sondas, não esperança**: cada feature relevante tem sondas (puras + FONTE por regex no
  JSX/api quando o comportamento é de montagem). Rodar as sondas + `npm run build` antes de
  commitar. Bloco B de algumas sondas usa o banco real (condomínio TESTE Manuais) via dev
  server de pé.
- **Reparo de dados**: scripts `scripts/corrigir-*.mjs` com ENSAIO por padrão e `--aplicar`
  para gravar — o ensaio é lido antes de aplicar. Service role; genéricos por condomínio.
- **i18n**: dicionário por frase exata PT → 14 idiomas (`src/lib/i18n.js`, EN e ES inline).
  Mensagem de lib fica em PT e é traduzida NA EXIBIÇÃO com `L()` (no Node o idioma padrão é
  "es" — traduzir na criação quebraria as sondas).
- **Degradar aberto**: SQL opcional não rodado não derruba o app — a tela mostra aviso.
- **Commits**: uma linha narrativa em PT (sem acentos), contando o comportamento que mudou.
- **Fila de aprovação do diretor**: CONGELADA desde 02/11/2026 (inerte) — o Administrador
  opera como o diretor, com 4 exceções; a autoridade vem da MATRIZ DE PERMISSÕES
  (`jwt_pode`), nunca do nome do perfil.

## Scripts

| Script | O que faz |
|---|---|
| `scripts/testar-planilha-cobrancas.mjs` | Sondas do histórico de cobranças por planilha (leitura livre, mora, dedupe, pagador, competências; bloco B no banco) |
| `scripts/testar-combo.mjs` | Sondas do dropdown com busca e do filtro por prefixo de palavra |
| `scripts/testar-pessoas-doc.mjs` | Sondas do documento único de pessoa (unificação, duplicados) |
| `scripts/testar-import-lancamentos.mjs` | Sondas do import de contas a pagar |
| `scripts/testar-historico.mjs` | Sondas da aba Histórico de alterações (motor puro + paridade SQL ≡ JS ≡ NAV) |
| `scripts/testar-reservas.mjs` | Sondas de Reservas e Assembleias (motor puro + paridade policy/RPC/sync/histórico/sino) |
| `scripts/corrigir-pagadores-planilha.mjs` | Reparo: placeholders "Responsável X" ganham nome/RUC do pagador da planilha |
| `scripts/corrigir-competencias-planilha.mjs` | Reparo: competências 1905 (ano lido como serial) e meses recuperáveis |
| `scripts/corrigir-duplicados-pessoas.mjs` | Reparo: funde cadastros duplicados (mesmo nome, doc provisório P-/M-) |
| `scripts/seed.mjs`, `scripts/testar-manuais-seed.mjs` e demais `testar-*` | Seeds e sondas das áreas mais antigas |

## Pendências conhecidas

- **dLocal Go — Fase 0**: falta a chave de sandbox e o % de comissão; conta demo para a
  revisão deles (`verumcripto+dlocal@gmail.com`) vale até 20/11/2026.
- **Sonda dos manuais**: ~10 ❌ falsos a partir de 28/09/2026 (fixture com cenário vencido).
- Testes visuais pendentes: import de contas a pagar e unificação de pessoa no navegador.
- **Reservas e Assembleias**: falta rodar em produção, NESTA ordem: `supabase-historico.sql`
  (re-run, 23 gatilhos), `supabase-planilha-sync.sql` (re-run, `extra` fora da planilla) e
  `supabase-reservas-assembleias.sql` (novo, passo 13) — até lá o bloco B de
  `testar-permissoes` acusa "padrão semeado no banco diverge" (esperado) e as telas avisam.
  Depois: teste visual (morador solicita → sino → confirmar → cobrança `extra`; assembleia
  convocar → presenças → ata).

## Histórico (mais recente primeiro)

### 09/11/2026 — Histórico VALIDADO fim a fim em produção
SQL rodado (sonda de banco 5/5), aba conferida pelo diretor e **Desfazer provado de
verdade**: a pessoa e o vínculo apagados pela remoção de acesso voltaram pela trilha, na
ordem certa (pessoa antes do vínculo), com as entradas 'DESFAZ' gravadas. Ciclo completo.

### 09/11/2026 — Histórico diz QUEM foi removido, e remover acesso atualiza o painel
Teste visual em produção revelou três falhas. (1) "Acesso removido" gravava só o uuid do
alvo — agora `api/auth/acessos.js` grava nome, e-mail e perfil no `detalhe` (criar idem), e
a linha do Histórico mostra o detalhe legível (`detalheCurto` em historico.js — uuid nunca;
fica para o modal). (2) Vínculo excluído mostrava "—": `papel`/`email` entraram nas chaves
de resumo ("sindico" aparece). (3) Remover/criar acesso não recarregava o painel — a pessoa
apagada pelo backend continuava na tela Pessoas e parecia que "não removeu" (o banco tinha
removido: a trilha provou, 0 vivas); agora `reload()` após as duas ações. Sondas H4e/H4f.
Obs.: CRUD feito pelo backend (service role) segue como "Sistema" — o autor humano está no
evento da mesma hora, que agora é legível.
Nova tela **Histórico de alterações** (modelo Google Ads): toda movimentação com data/hora,
quem (nome + perfil), ação (Criou/Editou/Excluiu/**Adicionou** nas filhas/Desfez/Evento), onde
e o que mudou — chips por categoria, filtro por ação e período, busca local, paginação no
servidor e diff antes/depois em modal. Reaproveitou as DUAS infra que já existiam: a órfã
`auditoria` (schema) virou a trilha de CRUD — endurecida, era legível por QUALQUER perfil
pelos loops genéricos — e `auditoria_eventos` (seguranca3) entrou na mesma view
(`historico_unificado`, security_invoker). Gatilho genérico `trg_historico` em 19 tabelas
(pula consequência de outro gatilho, UPDATE cosmético e nunca derruba a escrita); autor via
claims do JWT. **Desfazer** (`desfazer_alteracao`): reverte cadastros com checagem otimista
(estado atual ≡ `depois` gravado, senão "desfaça as mais recentes primeiro") e grava entrada
'DESFAZ' — a trilha é append-only de verdade; DINHEIRO fica fora (cobrancas/lancamentos/
fundos/planilhas/portaria → use cancelamento/rejeição da própria tela). Permissões novas
`tela.historico` + `historico.desfazer`: fora do padrão de todos (= só o diretor, anti-trava),
delegáveis pela matriz e **vedadas ao Administrador** (a trilha fiscaliza quem administra).
Policy de `auditoria_eventos` saiu do nome de perfil para `jwt_pode`. Novo passo 12
`supabase-historico.sql` (README atualizado com as regras de re-run); sonda
`testar-historico.mjs` (33 ✅) + `testar-permissoes.mjs` ajustada (NAV=14, vedadas=4);
~80 frases novas nos 15 idiomas. Falta rodar o SQL em produção e o teste visual.

### 08/11/2026 — Contas a pagar por planilha (`8e53c6a`)
Finanças ganhou **Importar**: planilha .xlsx/.csv vira LANÇAMENTOS reais (sem tabela-espelho),
com papéis de coluna inferidos (Rubro/Concepto/Importe/Fecha/Mes/Medio de pago/Pagado),
categorias criadas on-the-fly e **dedupe por mês+valor+descrição** (lancamentos não tem unique).
Status pelo poder de quem importa: com `financeiro.aprovar` entra direto em Contas a pagar;
linha paga + `financeiro.baixar` entra como paga (afeta o caixa; âncora protege datas antigas).
Bug corrigido de brinde: o card "A pagar" comparava com status de UI e era **sempre 0**.

### 08/11/2026 — Unificação robusta + card de unidades (`78eb1c5`)
A unificação de pessoas morria em "permission denied for table usuarios" (tabela do servidor de
auth, sem GRANT no navegador) — agora é melhor-esforço. Modal de pessoa mostra card com TODAS
as unidades de quem tem 2+. `corrigir-duplicados-pessoas.mjs` **aplicado**: 16 fusões → 56
pessoas, 11 proprietários multi-unidade consolidados (Dominico 1-A·3-B, YU YING 5 aptos…).

### 08/11/2026 — Documento único de pessoa (`3b1bcdc`)
Mesmo CI = a mesma pessoa com mais um apartamento. Criar com doc existente REUSA o cadastro
(vínculo novo); editar com o doc de outra pessoa UNIFICA com confirmação (reponta vínculos,
unidades, cobranças, multas e acesso; vínculos por UPDATE — chamados referenciam os ids).
Coluna Unidade da tela Pessoas lista todas as unidades. O unique do banco não mudou.

### 07/11/2026 — Pagador da planilha + competências 1905 (`5538637`)
Papéis de coluna **nome** (Datos) e **documento** (RUC): a materialização de cobranças passa a
criar a pessoa com o nome real (vínculo proprietário) ou REUSAR quem já tem o documento.
Parser de competência: ano solto (2020) não vira mais serial do Excel ("07/1905"), serial
pré-1970 é lixo, mês colado por hífen resolve ("corresponde-julio 2012"). Reparos aplicados:
68 placeholders renomeados (38 com RUC) e 74 cobranças-artefato 1905 removidas.

### 06/11/2026 — Filtro por prefixo + dedupe do import (`edf3136`, `5374acf`)
Busca da tela Cobranças virou **prefixo por palavra** ("1-a" acha só a 1-A; a chave antiga
"…01-A" não vaza mais). Import da planilha não cai mais com unidade+competência repetidas no
mesmo arquivo (colapsa, vence a última) e as mensagens do import ficaram traduzíveis.

### 02/11/2026 — Administrador predial + rótulo da unidade (`e2d331b` e vizinhos)
Administrador opera como o diretor (fila de aprovação CONGELADA, inerte) com 4 exceções que
salvam na hora. Unidade exibida como andar-letra ("10-A") — `label` (numero-bloco) continua
sendo a chave do servidor/SQL; `rotulo` é só tela. Dropdowns longos de unidade/pessoa viraram
ComboBusca (busca acima de 8 itens; lista fixa por causa do overflow dos modais). Espanhol
revisado (síndico → Síndico etc.).

### 31/10/2026 — Matriz de permissões + webhook Stripe
Autoridade saiu do NOME do perfil para a matriz de permissões (SQL rodado; override por
condomínio). Webhook Stripe: a Vercel parseava o corpo e o `JSON.stringify` quebrava a
assinatura — corpo bruto restaurado (0/6 eventos entregues até então).

### 20/10/2026 — Licença USD, QRs reais, sync planilha⇄cobranças, sino
Licença âncora em USD ($100/$180/$420, anual ×10) com Adaptive Pricing — rollout completo,
legados migrados (`817d89a`). QR Pix (link Stripe, lazy) e QR cripto reais na tela Cobranças
(`b7b73d4`). Sincronização planilha⇄cobranças: triggers + RPC `cancelar_cobranca`, paga/
indevida zeram na planilha (`a3b7b29`). Sino com feed de movimentações: triggers + polling
30 s que também recarrega o painel (`03dab70`; Realtime descartado — client é recriado na
renovação da sessão).

### 15/10/2026 — Planilla de mora completa (`2cdaa91`)
Ciclo inteiro em produção: leitura do layout "planilla de mora" (blocos por ano), recebimento
em LOTE, fundo de reserva na baixa (RPCs com sondas 6/6 + 17/17) e âncora do caixa INCLUSIVA
(`data >= início do dia` — diagnosticar saldo importando `saldoComAncora`, nunca copiando a
fórmula).

### 14/10/2026 — Corrida do refresh de sessão (`c154cbe` + `b9ea6c6`)
Duas renovações simultâneas revogavam a família inteira de sessões: CAS + locks no servidor,
401 → login limpo no cliente, vínculo de acesso pela unidade.

> Histórico anterior a outubro/2026: ver `git log` e os documentos por tema.
