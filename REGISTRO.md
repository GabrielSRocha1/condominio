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
  (`jwt_pode`), nunca do nome do perfil. Desde 22/11/2026 a 4ª exceção é só o **contrato** da
  licença (contratar, trocar de plano, cancelar): a **fatura** ele vê e paga.

## Scripts

| Script | O que faz |
|---|---|
| `scripts/testar-planilha-cobrancas.mjs` | Sondas do histórico de cobranças por planilha (leitura livre, mora, dedupe, pagador, competências; bloco B no banco) |
| `scripts/testar-combo.mjs` | Sondas do dropdown com busca e do filtro por prefixo de palavra |
| `scripts/testar-moeda.mjs` | Sondas do campo de dinheiro por moeda: casas decimais, escala e o campo de ponta a ponta (guarani sem centavos vs. real) |
| `scripts/testar-pessoas-doc.mjs` | Sondas do documento único de pessoa (unificação, duplicados) |
| `scripts/testar-import-lancamentos.mjs` | Sondas do import de contas a pagar |
| `scripts/testar-historico.mjs` | Sondas da aba Histórico de alterações (motor puro + paridade SQL ≡ JS ≡ NAV) |
| `scripts/testar-reservas.mjs` | Sondas de Reservas e Assembleias (motor puro + paridade policy/RPC/sync/histórico/sino) |
| `scripts/testar-fatura-licenca.mjs` | Sondas da Fatura da licença: o administrador lê e paga pelo portal RESTRITO, e leva 403 em contratar/trocar/cancelar |
| `scripts/_contas-de-sonda.mjs` | Teardown das contas de teste: libera o e-mail sem apagar o rastro (`auditoria` é append-only) |
| `scripts/corrigir-pagadores-planilha.mjs` | Reparo: placeholders "Responsável X" ganham nome/RUC do pagador da planilha |
| `scripts/corrigir-competencias-planilha.mjs` | Reparo: competências 1905 (ano lido como serial) e meses recuperáveis |
| `scripts/corrigir-override-permissoes.mjs` | Reparo: adiciona ao override de permissões os códigos que entraram no padrão depois dele (nunca remove) |
| `scripts/corrigir-duplicados-pessoas.mjs` | Reparo: funde cadastros duplicados (mesmo nome, doc provisório P-/M-) |
| `scripts/seed.mjs`, `scripts/testar-manuais-seed.mjs` e demais `testar-*` | Seeds e sondas das áreas mais antigas |

## Pendências conhecidas

- **dLocal Go — Fase 0**: falta a chave de sandbox e o % de comissão; conta demo para a
  revisão deles (`verumcripto+dlocal@gmail.com`) vale até 20/11/2026.
- **Sonda dos manuais**: ~10 ❌ falsos a partir de 28/09/2026 (fixture com cenário vencido).
- Testes visuais pendentes: import de contas a pagar, unificação de pessoa e o cancelamento de
  reserva (este provado no banco pelo bloco B — falta só a olhada na tela).
- **Superfície do Administrador (22–23/11/2026)**: FECHADA — Fatura da licença, Primeiros passos
  e leitura do Histórico estão em produção, com SQL rodado, sondas 0 falhas e **telas conferidas
  pelo usuário em 23/11/2026**. Nada pendente. Lembrete de ambiente, não pendência: no dev local
  a lista de faturas de um condomínio **live** (ex.: Hotel Cassino Ross) nunca carrega, porque o
  `.env` daqui é **test** — cai em "cadastro de cobrança não entregue", que é o comportamento
  certo para esse caso, não defeito.

## Histórico (mais recente primeiro)

### 24/11/2026 — Busca do Historial corrigida: o responsável do SISTEMA saiu do alvo
Ajuste fino na busca mirada entregue hoje cedo: o alvo incluía o `labelResp` da unidade
resolvida, que embute o nome do responsável do CADASTRO — buscar "domini" trazia a linha do
Amado Mendoza só porque a 1-A é do Dominico no sistema. Agora da unidade resolvida entram só
os rótulos (`label`/`rotulo`); nome e documento vêm do que está NA PLANILHA (Datos/RUC).
De quebra: célula de unidade com largura mínima (72px) e rótulo curto sem quebrar — "1-A"
partia no hífen quando a tabela apertava; multi-unidade longa segue quebrando normal.

### 24/11/2026 — Historial (planilla): busca mirada por prefixo e "Recentes primeiro"
A busca do histórico da planilha (Cobros QR) casava SUBSTRING em todas as colunas — "1-A"
achava "11-A", datas, montos e texto solto ("corresponde - junio 2012"). Agora a busca é
MIRADA: unidade, nome do pagador e documento, por prefixo de palavra (`casaPorPrefixo`, o
mesmo filtro da lista de cobranças), com vírgula virando espaço para a célula multi-unidade
("1-A,3-B") expor cada rótulo; o rótulo resolvido da unidade (labelResp/rotulo) também entra
no alvo. Planilha sem colunas de mira cai na busca larga, ainda por prefixo.

E a pergunta "como acho o que acabei de importar?": linha nova do Importar mais entra no FIM
da ordem da planilha — entrou o seletor **"Recentes primeiro"** (criado_em desc; linha
reenviada do mesmo mês só ATUALIZA, não sobe). "Limpar filtros" zera a ordenação junto.
i18n EN/ES; sonda FONTE no testar-combo.mjs trava filtro e ordenação.

### 24/11/2026 — Passo 1 do guia conclui com o PAÍS: o síndico atual deixou de segurar o check
O passo "Complete os dados do condomínio" exigia `pais && sindico` — mas o campo "Síndico
atual" é opcional de verdade (prédio tocado por administrador não tem por que preenchê-lo), e
o passo ficava aberto para sempre mesmo com o país salvo (Progreso I: `pais="PY"` no banco,
`gestao.sindico=""`). A confusão era dupla: o select de país ainda EXIBE o palpite do IP
(geoCache) quando nada foi salvo, então "parece preenchido" ≠ "está salvo". Ajuste: o check
agora é só `!!db.cond.pais` (o que o passo realmente precisa garantir — DDI/máscara dos
telefones e WhatsApp) e o texto do passo parou de prometer o síndico. i18n EN/ES da frase nova.

### 24/11/2026 — Gráfico "Despesas por categoria" para de se atropelar
O card do dashboard tinha 200px fixos e eixo de 90px — bastou o import das Expensas Comunes
criar 17 categorias para as barras esmagarem e os rótulos colidirem (e o tooltip vazava o
dataKey "v"). Conserto na anatomia, não na cor: altura acompanha o nº de linhas (26px cada);
acima de 10 categorias o card agrega em **top 9 + "Outras (N)"** (visão geral — o detalhe vive
em Finanças); nome longo é cortado no EIXO em uma linha e sai inteiro no tooltip; a série
ganhou nome legível ("Gasto"); margens para a barra não encostar na borda. i18n EN/ES
("Outras", "Gasto").

### 24/11/2026 — Excluir lançamentos na aba Lançamentos: linha e lote, pago é intocável
Dado que sobe errado (import ou manual) agora tem saída: lixeira por linha e seleção múltipla
com "Excluir selecionados" na aba Lançamentos — pedido do usuário depois do import das
Expensas Comunes. Decisões:

- **DELETE de verdade, não soft**: linha errada não pode poluir o dedupe da reimportação nem
  as listas. A trilha fica — a auditoria grava a linha inteira em `antes` e a exclusão aparece
  no Histórico de alterações. O **Desfazer segue bloqueado** para lançamentos (decisão de
  09/11: dinheiro não se restaura por clique) — excluir é definitivo pela tela.
- **Pago não se exclui** (decisão do usuário): o valor já está no caixa. "Entrada" (receita
  paga) idem. Lançamento nascido de cobrança se gerencia pela tela de Cobranças, e vínculo
  com multa é recusado (FK de `penalidades` preservada com mensagem clara).
- **Sem código de permissão novo** (a armadilha do override congelado, de ontem): a regra usa
  `financeiro.lancar`, o mesmo que a RLS já exigia para DELETE — nunca exposto na tela até hoje.
- Três camadas: UI esconde (lixeira/checkbox só em excluível), API barra
  (`excluirLancamentos`), banco impede (`trg_lancamentos_sem_delete_pago` before delete em
  `supabase-permissoes.sql`; service_role passa para os reparos). **SQL RODADO em 24/11/2026**
  (Success no SQL Editor — só o trecho novo, sem re-rodar o arquivo nem a cadeia). Pendência:
  só a olhada visual (lixeira/lote na aba, card "Por pagar" caindo, exclusão no Histórico sem
  Desfazer).
- `Tbl` ganhou `selection.rotulo` (o aria-label "Selecionar cobrança" era fixo); `db.lanc`
  passou a expor `origem`. i18n EN/ES das frases novas. Sondas 27/27.

### 23/11/2026 — Lançamento manual nasce "À pagar": a forma de pagamento deixa de fingir que a conta já foi paga
O modal Novo lançamento obrigava a escolher um meio de pagamento (abria em "QR Verum Pay")
mesmo quando a despesa ainda nem foi paga — toda conta a pagar nascia com uma forma inventada.
Pedido do usuário: o modo **"À pagar"** na lista. Entrou como PRIMEIRA opção (padrão), e vira
**"À receber"** quando o tipo é Receita. Implementação de uma linha por desenho: os dois rótulos
ficam FORA de `FORMA_ENUM` de propósito — `FORMA_ENUM[f.forma] || null` já grava
`forma_pagamento = NULL`, o mesmo valor que o import usa quando a planilha não traz forma.
O meio de pagamento de verdade é definido quando a conta é quitada. Sem SQL, sem mudança de
enum; sonda FONTE nova trava o par (opção no modal + `|| null` na API).

### 23/11/2026 — Override de permissões é um retrato congelado: reparo devolve ao Administrador o que entrou no padrão depois
O menu do Administrador do Progreso I estava sem Fatura e Histórico — e também sem Reservas e
Assembleias, que ninguém tinha notado. Causa: o condomínio tem **override** do perfil (criado
02/11, atualizado 07/11 em Gerenciar Acessos → Permissões), e override **substitui** o padrão
inteiro — todo código que entra na MATRIZ_PADRAO depois nunca chega a condomínio com override.
Ficaram de fora: `tela.reservas`/`tela.assembleias`/`reserva.decidir` (09/11),
`tela.fatura`/`licenca.pagar` (22/11) e `tela.historico` (23/11).

Reparo: `scripts/corrigir-override-permissoes.mjs` (ensaio por padrão, `--aplicar` grava) —
calcula o que falta do padrão ATUAL via `sanearPerms` (o mesmo funil do editor da tela: vedadas
ao admin e fixas ficam fora) e só ADICIONA; o que o diretor tirou ou pôs de propósito permanece.
Aplicado no Progreso I: +6 códigos, override com 33, re-ensaio "em dia". Sessões pegam no
próximo login/renovação (≤1h).

Atenção: síndico e tesouraria do Progreso I também têm override congelado (07/11), mas com cara
de customização deliberada (síndico sem as ações financeiras) — o script com `--perfil=sindico`
re-adicionaria TUDO do padrão, desfazendo a customização. Para esses, o caminho é o diretor
marcar só Reservas/Assembleias na tela de Permissões, se quiser. Fica a dívida de desenho:
código novo no padrão não alcança condomínio com override — pensar numa migração de extensão
quando o próximo código nascer.

### 23/11/2026 — Import de contas a pagar: ANO + mês por extenso viram competência, e o dia padrão é 12
A planilha real das Expensas Comunes traz a competência em DUAS colunas — "ANO" (2026) e
"COMPETENCIA" ("OCTUBRE") — e o import gravou tudo em **18/07**: o vocabulário de despesa não
tinha o papel `ano`, a única saída no mapa era mapear ANO→Data, e `paraISO` leu 2026 como
**serial do Excel** (= 18/07/1905). O mesmo bug já tinha sido consertado no lado de cobranças
(5538637), mas a guarda ficou só em `normalizarCompetencia` — agora ela mora no `paraISO`
(inteiro 1900–2100 é ano, não serial), protegendo os dois caminhos de uma vez. O que mudou:

- `PAPEIS_DESP` ganhou `ano` (ANO/AÑO/Year/Ejercicio) e o mapa do modal oferece o papel "Ano";
- `resolverLinhaDespesa` combina ano + mês (`mesDeTexto` já conhecia "OCTUBRE"; mês numérico
  1–12 vale quando há coluna de ano explícita — aí deixa de ser ambíguo);
- **sem data na planilha, o lançamento cai no dia 12 do mês da competência** (pedido do
  usuário; antes o fallback da API era dia 1º);
- a API recusa competência pré-1970 com motivo claro — lixo de serial nunca mais chega ao banco.

Sondas 23/23 (`testar-import-lancamentos.mjs`, com os casos novos) + regressão completa de
cobranças/mora OK (serial real 45061 segue virando 2023-05). Pendência: apagar os ~17
lançamentos 1905-07 no SQL Editor (delete entregue) e reimportar a planilha pela UI — decisão
do usuário: apagar e reimportar, validando o fluxo novo fim a fim.

### 23/11/2026 — Telas do Administrador conferidas: a superfície dele está fechada
Validação visual feita pelo usuário, sem ressalvas. Com isso o ciclo que começou em 22/11 está
completo nas três frentes, e vale registrar o desenho que emergiu delas, porque é o mesmo em
todas: **a fronteira do administrador não é o escopo do dado, é a propriedade da decisão.** Ele
opera o prédio inteiro; o que fica com o dono é o que encerra ou apaga.

| Ele faz | Fica com o diretor |
|---|---|
| Vê plano, valor e faturas; **paga** pelo portal restrito; troca o cartão | Contratar, trocar de plano, **cancelar a assinatura** |
| **Lê** a trilha inteira de alterações | **Desfazer** pelo Histórico |
| Cria e remove acessos da equipe | Criar/remover acesso de **diretor**; excluir a pessoa ligada a ele |
| Os 8 passos do guia de implantação | Ativar o recebimento ONLINE (conta bancária e ID fiscal do condomínio) |

O par "ver/fazer ≠ encerrar/apagar" se repete três vezes porque é a mesma pergunta respondida
três vezes: **o que ele faz é reversível e rastreável; o que o dono guarda é o irreversível.**
Conjunto dele: **32 de 41 códigos**. Nada disso decide por nome de perfil — tudo passa pela
matriz, e o diretor pode revogar qualquer um em Gerenciar Acessos → Permissões.

### 23/11/2026 — O Administrador LÊ o Histórico, e segue sem poder reverter
Em 09/11 o Histórico foi vedado ao `administrador_predial` em bloco — tela **e** desfazer —, com
o argumento de que a trilha é o instrumento do dono para fiscalizar quem administra o prédio.
O argumento vale para **reverter**, não para **ler**: o registro continua lá de qualquer jeito
(`auditoria` é append-only por gatilho, DELETE só acima de 365 dias), e saber quem mexeu em quê
é metade do trabalho de quem administra o prédio. `tela.historico` saiu de
`PERMS_VEDADAS_AO_ADMIN` e entrou no padrão dele (**32 de 41**); `historico.desfazer`
**continua vedado**. A aba abre sem o botão Desfazer sem precisar de código novo — ele já era
gated por `historico.desfazer` em separado. É o mesmo corte da licença: ver e pagar ≠ contratar
e cancelar; aqui, ler ≠ reverter. **Ele lê tudo e não reverte nada.**
SQL: só o `supabase-aprovacoes.sql` (passo 11) — `tela.historico` já estava no catálogo desde o
`supabase-historico.sql`, e o que mudou foi a view `_padrao_administrador`. Conferido no banco:
32 códigos, `tela.historico` presente e `historico.desfazer` ausente. Sondas: `testar-historico`
ganhou 5 asserções que travam a assimetria (incluindo "a tela é do administrador, e só dele além
do diretor") e `testar-permissoes` outra no mesmo espírito; as duas 0 falhas, mais
`fatura-licenca`, `aprovacoes`, `reservas` e `idioma-moeda` 0, build OK.

### 23/11/2026 — Primeiros passos também para o Administrador
O guia de implantação aparecia só para diretor, síndico e tesouraria: o `administrador_predial`
não tinha **nenhum** passo, e por isso a entrada "Primeiros passos" do menu nem existia para
ele — `obVisivel` exige `obSteps.length`. Era uma sobra da época anterior à matriz, não uma
decisão: quem implanta o prédio é ele tanto quanto o diretor, e o conjunto dele já traz **todas**
as ações que os oito passos pedem (`condominio.editar`, `unidade.criar`, `cobranca.emitir`,
`financeiro.lancar`, `comunicado.publicar`, `acesso.gerir`). Entrou nos **oito**.
O passo dos meios de pagamento vale inteiro para ele pelos meios manuais (Verum Wallet e conta
bancária); só o recebimento ONLINE é do dono — é conta bancária e ID fiscal do condomínio —, e
aquele bloco da tela Condomínio **já era vedado a ele**, então não há botão que leve a um 403.
A busca de `obExtras` (status do recebimento + acessos criados, os dois checks que não saem do
db) passou a valer para ele: `connect/status` devolve `online` para qualquer perfil e a listagem
de acessos decide pela matriz. Síndico e tesouraria seguem fora dessa busca — nenhum passo deles
precisa, seria chamada à toa.
`roles` aqui **continua decidindo por nome de perfil**, ao contrário do NAV. Não foi convertido
junto de propósito: os passos não mapeiam 1:1 para um código — o de "unidades" vale para o
síndico, que **não** tem `unidade.criar` — e trocar o critério mudaria em silêncio o que síndico
e tesouraria enxergam hoje. Em troca, sonda nova cruza os dois mundos: **todo passo oferecido a
um perfil aponta para uma tela que a matriz lhe dá** (8 para o administrador, 5 para o síndico,
3 para a tesouraria) — passo em tela escondida seria beco sem saída, e nada impedia a divergência.

### 22/11/2026 — O administrador paga a fatura da plataforma, sem poder matar a conta
**EM PRODUÇÃO**: SQL rodado, commits `d3f364c` → `6b95280` → `207f34b` com push em `main`
(a Vercel deploya dela), e a configuração restrita do portal provisionada na conta **LIVE**
(`bpc_1UemLrRtL3V8lKdYI2lhNX4C`, conferida: `cancel=false`, `update=false`, faturas e cartão
ligados; a padrão do diretor segue com `cancel=true`). Ordem cumprida: **SQL primeiro, deploy
depois**. Sondas: `testar-fatura-licenca` **23/23**, `testar-permissoes` 0 falhas (bloco B
incluído), `testar-aprovacoes`/`historico`/`reservas`/`idioma-moeda` 0, build OK — as duas
principais rodadas **duas vezes seguidas** para provar o teardown. Falta só a olhada visual em
produção.

Quem administra o prédio por contrato paga e gere as contas do condomínio, e a licença da
plataforma é uma dessas contas — mas o `administrador_predial` não conseguia nem **ver** a
fatura: a 4ª exceção vedava `tela.planos` + `licenca.gerir` em bloco, e todo
`/api/stripe/*` da licença exigia `licenca.gerir`. Pior no caso que mais importa: com a licença
vencida o paywall tranca o sistema inteiro, e ele lia só *"Acesso indisponível — procure a
administração"*, sem nada a fazer, esperando um diretor que podia estar ausente.
**A vedação protegia a coisa certa pelo critério errado**: tratava "pagar a conta" e "ser dono
do contrato" como a mesma coisa. Agora são duas. Apurado no código ao desenhar isto: **não
existe nenhuma ação de excluir conta, excluir condomínio ou desativar no app** (a única
`condominios.delete()` é rollback interno de criação falha); o que de fato destrói a conta é
**cancelar a assinatura** — webhook marca `cancelada` e o paywall tranca para sempre. A
fronteira ficou exatamente aí.
Par novo no catálogo (39 → 41 códigos), espelhando o par que já existia: **`tela.fatura`**
(menu) + **`licenca.pagar`** (endpoints), ambos no padrão do administrador — que vai a **31 de
41**. `PERMS_VEDADAS_AO_ADMIN` **não mudou**: segue com os mesmos 4 códigos, e a sonda que os
trava passa sem alteração — nada foi afrouxado, abriu-se uma porta estreita ao lado. O diretor
pode revogar as duas em Gerenciar Acessos → Permissões.
Tela nova **Fatura** (NAV 16 → 17): plano, valor e renovação em leitura + as faturas lidas da
**Stripe** (não há tabela local de faturas, e não deve haver: a fatura é um fato da Stripe, e
espelhá-la criaria duas versões da verdade sobre dinheiro). O mesmo componente é montado no
rodapé de **Planos** — o diretor ganha a lista em contexto, sem lógica duplicada; até aqui o app
**não tinha listagem de faturas em lugar nenhum**. Endpoint novo `/api/stripe/faturas`, e o
valor vem convertido por `deMenorUnidade` (lista zero-decimal da Stripe): com Adaptive Pricing
a fatura sai na moeda do cliente, e uma fatura em guarani **não** se divide por 100 — a mesma
armadilha de 12/11.
**Pagar é pelo Billing Portal, em configuração RESTRITA**: `invoice_history` e
`payment_method_update` ligados, **`subscription_cancel` e `subscription_update` desligados**.
A configuração é provisionada sob demanda e reconhecida por metadata (`restrito_v1`) — test e
live se resolvem sozinhos, sem variável de ambiente nova — e também pelo
`preparar-stripe-producao.mjs`, que a **reaperta** se achar frouxa. Aqui o projeto degrada
**FECHADO**, contra a própria convenção: se a configuração restrita não puder ser resolvida, o
endpoint responde 503, porque cair no portal padrão entregaria o botão "Cancel plan" a quem não
pode cancelar. Está comentado no código, justamente por contrariar o padrão da casa.
No **Paywall**, a única `ehDiretor` virou duas — `podeGerir` (escolher plano, checkout, código
de ativação) e `podePagar` (motivo real do bloqueio, plano, valor e **"Pagar fatura em
atraso"** pelo portal restrito) —, com os ~12 usos auditados um a um. Condomínio sem cliente na
Stripe não tem fatura para pagar: em vez de um botão que morre em 404, a mensagem manda falar
com o diretor. `assinatura.js`, `plano.js` e `cancelar-assinatura.js` **não mudaram uma linha**.
Sondas: `scripts/testar-fatura-licenca.mjs` (10 puras + 7 no banco com um administrador de
verdade: lê faturas, abre portal, **o portal é o restrito conferido na Stripe**, e 403 em
cancelar/contratar/trocar) e 5 novas em `testar-permissoes`, entre elas uma de FONTE que
congela o invariante: os três endpoints do contrato **não podem mencionar `licenca.pagar`** —
um copiar-colar futuro entregaria o cancelamento a quem só deveria pagar.
**Nenhuma policy nova**: `saas_assinaturas` é somente-leitura para o navegador e os dados de
fatura vivem na Stripe; `licenca.pagar` é enforçada na API, como `licenca.gerir` sempre foi.
Quem procurar `jwt_pode('licenca.pagar')` no banco não vai achar — e está certo.
**Ajustes vindos da primeira olhada na tela** (22/11/2026): a caixa de falha era **vermelha** e
aparecia **junto** com "Nenhuma fatura emitida até agora", afirmando duas coisas contraditórias.
Agora os quatro estados sem lista (sem cliente · cadastro não entregue · falha ao carregar ·
lista vazia) moram num ramo só, em **âmbar** — vermelho fica para erro de verdade, e nenhum
desses é: em todos a licença está em dia e não há nada para a pessoa consertar. Os três trazem a
âncora que ela veio ver: **a data do próximo vencimento** (`tenant.vencFull`, campo novo). E a
tela **não nomeia o provedor de pagamento**: a plataforma atende em domínio próprio e quem
processa o cartão é detalhe de implementação.

**Varredura do nome do provedor em TODA a UI** (22/11/2026, pedida na mesma olhada): saíram **11
textos** — ativação do recebimento online, seletor de país, status do cadastro, QR do Pix,
confirmação de pagamento do morador, aviso de troca de plano e as três mensagens do paywall —,
mais dois literais " · Stripe" soltos ao lado de um `L()`, o passo "Primeiros passos" e o rótulo
`FORMA_LABEL` ("Pagamento online (Stripe)" → "Pagamento online"). O 502 de
`api/stripe/assinatura.js` entregava ao condomínio, dentro de um `alert`, o nome do provedor **e
o caminho de um script nosso**: o diagnóstico foi para o log do servidor e a tela recebe "Este
plano ainda não está disponível para contratação." Os 12 dicionários secundários não tinham
nenhuma dessas chaves (caem no inglês), então foram 11 chaves × EN + ES.
**Ficam de fora, de propósito**: os comentários de código (documentação deve nomear o que está
integrado), as **páginas legais** (`src/legal/*`, 10 menções em cada idioma — identificar o
processador de pagamento é disclosure devido, não cópia de produto) e a página hospedada do
checkout, que é do provedor. Sonda nova varre os `L()` do app inteiro + o `FORMA_LABEL`.
`/api/stripe/faturas` passou a tratar `No such customer` como CONDIÇÃO (200 + `clienteAusente`),
não como 500: acontece sempre que a chave aponta para o outro ambiente — foi o que apareceu na
tela ao abrir um condomínio **live** no dev local, que roda em **test**.

**O bug que esta mudança desenterrou, e que valia mais que ela** (22/11/2026): rodar o
`supabase-permissoes.sql` num banco completo falhava com
`ERROR 42809: "historico_unificado" is not a table`. Os laços que varrem
`information_schema.columns` por `condominio_id` — bloco F do `permissoes` e o equivalente no
`rls` — listam também as colunas de **VIEW**, e policy em view não existe. Como o SQL Editor
roda o arquivo em **uma transação**, o RUN inteiro voltava atrás: o catálogo do bloco B, que já
havia sido semeado, era revertido junto, o banco ficava **idêntico** e a mensagem apontava uma
relação sem nenhuma relação com o que se queria mudar. Sintoma final: o `aprovacoes` (passo 11)
rodava limpo e inseria ZERO linha, porque o `join permissoes pm on pm.codigo = d.codigo` não
achava os códigos — sem erro nenhum. **Nunca apareceu em instalação nova** (o passo 10 roda
antes do 12, a view ainda não existe); só no RE-RUN sobre banco completo, que é precisamente o
caminho que o README prescreve desde 09/11, quando o `historico_unificado` nasceu com
`condominio_id`. Os três laços do projeto agora filtram `table_type = 'BASE TABLE'`
(`permissoes`, `rls` e o de `atualizado_em` no `schema`, este preventivo), e duas sondas de
FONTE cobrem os três arquivos de uma vez.

Dois achados de passagem, corrigidos junto: o status `bloqueada` não existia em `STATUS_META` e
vazava cru na tela (justamente a que um condomínio bloqueado abre), e 4 strings da tela Reservas
nunca entraram nos dicionários EN/ES desde 09/11 — a sonda de i18n acusava e ninguém tinha
olhado. **Armadilha de sonda documentada**: `auditoria` é append-only por gatilho (DELETE só
acima de 365 dias) e o LOGIN grava lá, então conta de sonda que entrou **não pode mais ser
apagada** — o `remover` do endpoint falhava em silêncio e deixava conta SEM perfil, que existe,
duplica o e-mail e não entra; a execução seguinte pulava o bloco B inteiro com "login da
tesouraria falhou", sem pista da causa. `scripts/_contas-de-sonda.mjs` passa a **liberar o
e-mail** em vez de apagar o rastro (apelida quando o delete é recusado), e as duas sondas rodam
duas vezes seguidas sem sobra.

### 12/11/2026 — Campo de dinheiro em moeda SEM centavos (o guarani travado em "Gs. 0")
Relatado da tela: a taxa de uso da área não aceitava valor — o campo ficava preso em "Gs. 0".
A causa é mais ampla que a tela: o `MoneyInput` digitava **sempre em centésimos**, assumindo que
toda moeda tem centavos. Em guarani, digitar "5" virava Gs. 0,05, que o `Intl` arredonda para
"Gs. 0" — daí a sensação de campo travado. **O pior não estava à vista**: quem insistisse e
digitasse 20000 submetia **Gs. 200**, cem vezes menos, sem aviso nenhum. Entre as 32 moedas do
catálogo, **cinco** não têm centavos (JPY, HUF, PYG, CLP, COP), e o bug valia para todas elas em
**todos** os 5 campos de dinheiro do app — cobrança, recebimento, confirmação manual, QR e a taxa
da área —, não só no que foi relatado. Agora a escala vem da moeda (`10 ** casasDecimais`), nunca
de 100 fixo, e a resposta sai do próprio `Intl` em vez de uma lista à mão. A prop `defaultCents`
virou **`defaultValor`**: quem chama passa o valor de verdade e a conversão para a menor unidade
mora num lugar só — foram 4 chamadores que multiplicavam por 100 na mão. Novo módulo puro
`src/lib/moeda.js` + `scripts/testar-moeda.mjs` com 18 sondas, incluindo o campo **reproduzido de
ponta a ponta** (dígitos → tela → valor submetido) nas duas famílias de moeda. Nota registrada no
módulo: a lista zero-decimal da **Stripe** não inclui o HUF e a do `Intl` inclui — as duas estão
certas em camadas diferentes (o que a pessoa digita vs. como a Stripe cobra), e não se encontram
porque o banco guarda decimal, não unidade menor.

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
