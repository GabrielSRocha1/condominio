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
- Testes visuais pendentes: import de contas a pagar, unificação de pessoa e o cancelamento de
  reserva (este provado no banco pelo bloco B — falta só a olhada na tela).

## Histórico (mais recente primeiro)

### 12/11/2026 — Lembrete de reserva próxima no sino do morador (zero SQL)
O sino mostrava **toda** reserva futura confirmada, para sempre: uma de três meses à frente com
o mesmo peso de uma que é amanhã, competindo com cobranças e comunicados. Agora só entra o que
está perto, com a frase mudando de fase: **em uso agora · hoje · amanhã · em breve** (janela de
48h, parâmetro), cor de atenção em hoje/em-curso, **ordenado pela mais próxima** e **acima dos
comunicados**. A reserva distante sai do sino e ganha **card "Próxima reserva" no Início** (molde
do card da assembleia, com taxa e status da cobrança quando houver) — sem ele, enxugar o sino
esconderia informação. O sino da **gestão** ganhou o agregado "N reserva(s) de área nas próximas
24h", vizinho do aviso de assembleia: quem cuida do prédio precisa preparar o espaço.
**Decidido pelo relógio, não por linha no banco** — e de propósito: o projeto **não tem nenhuma
infraestrutura de execução agendada** (sem `crons` no `vercel.json`, sem `pg_cron`/`pg_net` — as
únicas extensões são `pgcrypto` e `btree_gist`, sem Actions, sem Edge Functions; os 4 triggers de
notificação são AFTER INSERT/UPDATE e reagem a escrita, nunca ao relógio). O gêmeo da técnica já
rodava em produção no aviso de "assembleia nos próximos 7 dias". Limite dito em voz alta: **o
lembrete aparece quando o morador abre o app**; fazer o celular vibrar exige agendador + canal de
push, que são duas obras à parte (o `sw.js` só tem install/activate/fetch; zero VAPID/PushManager).
A fase é decidida por **dia de calendário local** (`Date.UTC` dos componentes locais, imune a
horário de verão), não por aritmética de horas — uma reserva às 9h de amanhã está a 23h e tem de
ler "amanhã", não "hoje" (sonda R9c). Novo hook `useTique` (10 min, zero rede) é dep dos dois
sinos, senão "é amanhã" seguiria dizendo amanhã na aba aberta a noite toda. Puros novos
`faseReserva`/`proximaReserva` em `src/lib/reservas.js`; 17 sondas R9 com **tempo injetado** +
6 de paridade de tela (F8); 84 traduções nos 15 idiomas e a frase morta "Reserva confirmada"
removida. `EVENTOS_FEED` intocado — nenhum evento novo de `notificacoes`, nada a instalar.

### 12/11/2026 — Cancelamento de reserva instalado em produção: 7/7 no banco vivo
Os dois passos rodados (`supabase-historico.sql`, depois `supabase-reservas-assembleias.sql`) e
o ciclo provado **contra o banco**, não só por regex: `testar-reservas` ganhou um **bloco B**
(service role, condomínio TESTE Manuais, janelas em 2031) que confirma a reserva gerando a taxa,
cancela a reserva e vê a cobrança virar `cancelada` na mesma transação, **desfaz a confirmação
pelo Histórico** e vê a reserva voltar a `solicitada` com `cobranca_id` nulo e a taxa cancelada,
tenta cancelar com a taxa **paga** e colhe `taxa_paga` com a reserva intacta, cancela um pedido
sem dinheiro nenhum, e limpa o cenário no fim (a trilha em `auditoria` fica — é append-only).
Vizinhas no verde com o banco vivo: `testar-historico` 0 falhas, `testar-permissoes` com o
**padrão semeado ≡ matriz JS** (os 5 perfis) e `testar-planilha-sync` 8/8, inclusive as guardas
`ja_paga`/`justificativa_obrigatoria`/morador do `cancelar_cobranca` em que a RPC nova delega.
Falta só a olhada visual na tela.

### 12/11/2026 — Desfazer de Reservas: o ciclo fecha sem deixar cobrança órfã
Reservas tinha **dois** furos, e o segundo era pior que o documentado. (1) `reservas` estava
no bloqueio de dinheiro do Desfazer — por RELAÇÃO, então recusar um pedido (que não gera
cobrança nenhuma) era tão indesfazível quanto a confirmação que gera, enquanto
`areas_comuns`/`assembleias`/`atas` da mesma feature eram desfazíveis. (2) cancelar uma
reserva confirmada era UPDATE cru: a cobrança `extra` da taxa **ficava viva e inalcançável** —
a tela mandava usar a "Baixa indevida" em Cobranças, mas aquele botão vive na planilha e exige
uma linha, e o sync pula `extra` de propósito. Agora: nova RPC **`cancelar_reserva`** (irmã de
`confirmar_reserva`) cancela a reserva E a taxa na mesma transação, delegando ao corpo real
`cancelar_cobranca__base`; taxa **paga** ou com informe pendente **recusa a operação inteira**
(devolução segue ato explícito da tela Cobranças) e falta de `cobranca.cancelar` recusa dizendo
qual permissão falta. Ordem é regra, não estilo: a taxa é conferida **antes** de qualquer
escrita, porque a função roda na transação do PostgREST e um `return` depois de escrever não
desfaz a escrita. No Desfazer, `reservas` saiu do bloqueio e entrou na allowlist com guarda
pelo **par antes/depois**: desfazer a confirmação cancela a taxa dentro do bloco transacional
(falha rola as duas atrás); desfazer um cancelamento recusa com `taxa_cancelada` (o Histórico
não emite cobrança — reconfirmar é pela tela). O **morador** passou a desistir do próprio
pedido enquanto `solicitada`, autorizado pelo `solicitante_id` dentro da RPC — o que uma policy
não conseguiria, já que o JWT não carrega a unidade (nenhuma policy nova). De quebra, cancelar
reserva confirmada passou a exigir `reserva.decidir` na tela (não exigia, e agora move dinheiro)
e `podeTransicionar` deixou de ser import morto. Puros novos `efeitoCancelamento` e
`podeDesfazerReserva` em `src/lib/reservas.js`; 41 sondas em `testar-reservas` + F2b/F2c em
`testar-historico` (a paridade do bloqueio pega quem mexer num lado só); 240 traduções nos
15 idiomas e a frase morta do aviso removida. Re-rodar `supabase-historico.sql` e
`supabase-reservas-assembleias.sql` (passos 12 e 13, nessa ordem).

### 12/11/2026 — Lista de unidades em ordem numérica (1, 2 … 10, 11)
O banco ordena `numero` (varchar) como texto, então 10, 11 e 12 apareciam antes do 1 na
tela Unidades e em todos os dropdowns. Novo `compararUnidades` em `src/lib/unidades.js`
(localeCompare numérico sobre o número, desempate pelo bloco) aplicado UMA vez sobre
`unidadesRaw` no `loadAll` — `db.unidades` e `db.ctx.unidades` herdam a ordem, então tela,
dropdowns e portal corrigem juntos. Vale também para os números do lote ("101A" do 1º andar
antes de "1001A" do 10º) e letra no prefixo ("A2" antes de "A10"). Sondas O1–O6 na
`testar-unidades-rotulo.mjs` (57 ✅ no total) + build OK.

### 09/11/2026 — Reservas e Assembleias VALIDADAS no navegador
Teste visual aprovado pelo usuário ("as telas ficaram boas") — fecha o ciclo da feature:
código em produção, 3 SQLs rodados com sondas verdes e telas conferidas. Nada em aberto.

### 09/11/2026 — Reservas e Assembleias: SQL instalado em produção
Os 3 passos rodados na ordem (re-run `supabase-historico.sql` com 23 gatilhos, re-run
`supabase-planilha-sync.sql` pulando `extra`, e o novo `supabase-reservas-assembleias.sql`).
Provas: catálogo 4/4, RPC `confirmar_reserva` respondendo, view do histórico intacta após o
re-run, e `testar-permissoes` 0 falhas — o bloco B (banco vivo ≡ matriz JS) voltou ao verde
com os padrões novos semeados. Resta o teste visual com a primeira área cadastrada.

### 09/11/2026 — Reservas e Assembleias ganham telas (`cadfe87`)
As 4 tabelas órfãs do schema viraram produto. **Reservas**: morador solicita pelo portal
(card no Início + aba fora da barra; policy própria `morador_solicita_reserva` força status
`solicitada`; `pessoaId`/`unidadeId` agora vêm do login, com fallback por nome+unidade para
sessão antiga) e a gestão confirma pela RPC **`confirmar_reserva`** — área com taxa gera a
cobrança `extra` da unidade (fora do índice único das ordinárias E fora da planilla de mora:
o sync passou a pular `extra`) e grava `cobranca_id`; recusar/concluir são UPDATEs com `q1`;
conflito de horário é a constraint GiST (pré-checagem JS é só aviso; `23P01` traduzido);
sub-aba Áreas (CRUD com taxa/antecedência/capacidade); pedido novo toca o sino da gestão
(`reserva.solicitada` — 4º evento do feed). **Assembleias**: criar (tipo/modalidade/pauta/
quórum), convocar = PDF timbrado arquivado em Documentos (+ comunicado opcional tipo
convocação), presenças por checkbox de unidade com % vs quórum, ata = deliberações + PDF
(anexado ou gerado) → `realizada`; portal mostra a próxima assembleia com link da convocação.
Permissões novas `tela.reservas`/`tela.assembleias`/`reserva.decidir` (síndico + admin por
padrão) e `reserva.solicitar` (morador) — NAV=16; `trg_historico` cobre as 4 (23 relações;
`reservas` entrou no bloqueio do Desfazer: confirmar gera cobrança). Novo passo 13
`supabase-reservas-assembleias.sql` + re-run de `historico` e `planilha-sync`; módulo puro
`src/lib/reservas.js` + sonda `testar-reservas.mjs` (25 ✅); ~114 frases nos 15 idiomas.

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
