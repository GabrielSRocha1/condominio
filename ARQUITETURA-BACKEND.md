# CondoMaster Pro — Arquitetura do Back-end (v1)

**Stack assumida** (alinhada ao padrão dos seus outros produtos — Família Ross, Verum Pay): **NestJS + TypeScript + Prisma + PostgreSQL + Redis + BullMQ**, deploy em containers Docker atrás de Caddy (HTTPS automático). Se preferir Spring Boot, a arquitetura de módulos e os fluxos abaixo permanecem idênticos — muda só a implementação.

---

## 1. Arquitetura do back-end

**Monolito modular** (não microserviços). Justificativa: 1 equipe pequena, dezenas de tenants no primeiro ano, domínios fortemente acoplados (multa → financeiro → cobrança → documento). Microserviços aqui só adicionariam latência e custo operacional. O monolito é modular o suficiente para extrair serviços depois (o candidato natural a extração futura é o **worker de jobs**).

```
                        ┌─────────────────────────────────────────┐
  Front-ends            │              API NestJS                 │
  (admin, portal, ─────▶│  REST /api/v1 · JWT · Guards RBAC       │
   painel SaaS)         │  ┌────────────────────────────────────┐ │
                        │  │ Módulos de domínio (item 2)        │ │
  Verum Pay ──webhook──▶│  │ TenantContext (AsyncLocalStorage)  │ │
                        │  └────────────────────────────────────┘ │
                        └──────┬───────────┬──────────┬───────────┘
                               │           │          │
                        PostgreSQL      Redis      BullMQ Worker
                        (RLS por        (cache,    (PDF, e-mail,
                         tenant)         sessões,   WhatsApp,
                               │          rate      conciliação,
                        S3-compatible    limit)     rateio em lote)
                        (docs, provas,
                         comprovantes)
```

**Decisões estruturantes**

| Decisão | Escolha | Por quê |
|---|---|---|
| Multi-tenant | Banco único, coluna `condominio_id` em toda tabela de domínio + **Row-Level Security do PostgreSQL** | Isolamento garantido no banco, não só na aplicação; backup/migração únicos; RLS já é padrão nos seus projetos |
| Camadas | Controller → Service → Repository (Prisma) | Regras de negócio nunca no controller; Prisma nunca no controller |
| Processamento pesado | Sempre assíncrono via BullMQ | Geração de 96+ cobranças, PDFs, envios em massa não bloqueiam requisição |
| Eventos internos | Event emitter do Nest (`multa.aprovada`, `pagamento.confirmado`) | Módulos reagem entre si sem import circular (multa aprovada → financeiro lança título → notificação dispara) |
| Dinheiro | `Decimal` no Prisma / `NUMERIC(14,2)` no banco, nunca float | Óbvio, mas fatal se errar |
| API | REST versionada `/api/v1`, OpenAPI/Swagger gerado | Contrato claro para o front que já existe |

**Dois contextos de tenant**: o painel SaaS da administradora opera **fora** do escopo de tenant (tabelas `saas_*`); todo o resto opera **dentro** de um `condominio_id` resolvido no login e injetado via `TenantContext` (AsyncLocalStorage) → Prisma middleware aplica o filtro automaticamente e o PostgreSQL RLS garante a segunda linha de defesa.

## 2. Organização dos módulos

```
auth            login, refresh, troca de contexto, recuperação de senha
tenants (saas)  condomínios contratantes, planos, licenças, implantação, bloqueio
condominios     cadastro-mãe, regras internas, identidade visual, módulos ativos
unidades        unidades, vagas, vínculos, históricos
pessoas         pessoas + papéis (vínculo pessoa↔unidade↔papel, com vigência)
financeiro      lançamentos, categorias, competências, rateio, fundos, extratos
cobrancas       títulos, geração em lote, status, conciliação
pagamentos      adapter Verum Pay: emissão de QR, webhook, reconciliação
penalidades     advertências e multas: fluxo prova→defesa→aprovação
comunicados     criação, destinatários, canais, confirmação de leitura
documentos      motor de templates timbrados, arquivo, retenção
manutencao      chamados/OS, designação, custos → integração com financeiro
portaria        pré-autorizações, QR de acesso, movimentação, ocorrências
notificacoes    orquestração e-mail/WhatsApp/push (fila)
relatorios      agregações para dashboards (com cache Redis)
auditoria       trilha append-only de toda mutação
storage         abstração S3 (upload assinado, download com URL temporária)
```

Regra de dependência: módulos de domínio **não se importam entre si diretamente** — comunicam por eventos ou por serviços compartilhados (`notificacoes`, `documentos`, `auditoria`, `storage`), que são os únicos "horizontais".

## 3. Serviços internos

| Serviço | Responsabilidade | Notas |
|---|---|---|
| `TenantContextService` | Resolver e propagar `condominio_id` + `usuario_id` por requisição | AsyncLocalStorage; base do RLS |
| `RbacService` | Matriz perfil × permissão (`financeiro.aprovar`, `multa.aprovar`…) | Permissões granulares, não só papéis — permite "conselho fiscal só leitura" sem código novo |
| `RateioService` | Distribuir valor por fração ideal / igual / bloco / customizado | Puro e testável; arredondamento: sobra vai para a maior fração |
| `CobrancaService` | Ciclo de vida do título: rascunho → emitida → paga/vencida/cancelada | Máquina de estados explícita |
| `VerumPayAdapter` | Único ponto de contato com a API do Verum Pay | Interface `PaymentProvider` — se um dia entrar boleto bancário, é outro adapter |
| `ReconciliacaoService` | Job diário: compara títulos "emitidos" com transações no Verum Pay | Rede de segurança para webhook perdido |
| `PdfService` | Renderiza templates timbrados (HTML → PDF via Playwright/Chromium no worker) | Identidade visual vem do cadastro do condomínio |
| `NotificationService` | Fila unificada; escolhe canal, template, idioma; registra entrega | Cada envio vira registro auditável |
| `PenalidadeWorkflow` | Estados: registrada → em_defesa → aprovada/cancelada → lançada | Aprovação exige permissão `multa.aprovar` (síndico) |
| `AuditoriaInterceptor` | Interceptor global: grava quem/o quê/antes/depois em toda mutação | Append-only, mesmo padrão do seu Canvas |
| `RelatoriosService` | KPIs do dashboard com cache Redis (TTL 60s) | Invalidação por evento de pagamento |
| `LgpdService` | Exportação de dados do titular, anonimização pós-retenção | Obrigatório dado o volume de CPF/foto/documento |

## 4. Rotas / API endpoints (contrato resumido)

Base: `/api/v1`. Autenticação: `Authorization: Bearer <JWT>`. Todas as rotas de domínio operam no tenant do token.

```
AUTH
POST   /auth/login                    { email, senha } → { access, refresh, contextos[] }
POST   /auth/refresh
POST   /auth/context                  troca de condomínio ativo (usuário multi-condomínio)
POST   /auth/forgot | /auth/reset

SAAS (perfil administradora)
GET    /saas/tenants                  ?status=&plano=
POST   /saas/tenants                  contratação + checklist de implantação
PATCH  /saas/tenants/:id              plano, status, bloqueio
GET    /saas/dashboard                MRR, ativos, inadimplentes, uso

CONDOMÍNIO
GET/PUT /condominio                   cadastro-mãe, regras, identidade visual
GET    /condominio/modulos            módulos ativos pelo plano

UNIDADES & PESSOAS & VAGAS
GET/POST      /unidades               ?bloco=&status=&q=
GET/PATCH/DEL /unidades/:id
GET           /unidades/:id/extrato | /historico
GET/POST      /pessoas                ?papel=&q=
GET/PATCH     /pessoas/:id
POST          /pessoas/:id/vinculos   { unidadeId, papel, inicio, fim? }
GET/POST/PATCH /vagas

FINANCEIRO
GET/POST /financeiro/lancamentos      ?competencia=&tipo=&categoria=&status=
PATCH    /financeiro/lancamentos/:id/aprovar | /rejeitar
GET      /financeiro/categorias | /fundos | /extrato?unidadeId=&de=&ate=
POST     /financeiro/rateio/preview   simula rateio antes de gerar cobranças

COBRANÇAS
POST   /cobrancas/lote                { competencia, base, vencimento, canais[] } → job
GET    /cobrancas                     ?competencia=&status=&unidadeId=
GET    /cobrancas/:id                 inclui QR payload + status transação
POST   /cobrancas/:id/reenviar
POST   /cobrancas/:id/cancelar
GET    /cobrancas/:id/comprovante     → URL temporária do PDF

PAGAMENTOS (integração)
POST   /webhooks/verum-pay            assinado; idempotente (ver item 7)
POST   /pagamentos/reconciliar        dispara reconciliação manual (tesouraria)

PENALIDADES
POST   /penalidades                   registro com provas (upload assinado)
GET    /penalidades                   ?status=&unidadeId=
POST   /penalidades/:id/defesa        (portal do morador)
POST   /penalidades/:id/decisao       { aprovar|cancelar, parecer } — síndico
GET    /penalidades/:id/documento     PDF timbrado

COMUNICADOS & DOCUMENTOS
POST   /comunicados                   { tipo, destinatarios, canais[], titulo, corpo }
GET    /comunicados | /comunicados/:id/leitura
POST   /documentos                    gera timbrado avulso
GET    /documentos                    ?tipo=&ano=&unidadeId=
GET    /documentos/:id/download       URL temporária

MANUTENÇÃO
POST/GET /chamados                    ?status=&categoria=&prioridade=
PATCH    /chamados/:id                status, responsável, custo realizado
POST     /chamados/:id/fechar         custo realizado → lançamento em financeiro (evento)

PORTARIA
POST   /portaria/pre-autorizacoes     → QR de acesso (token curto, janela de validade)
POST   /portaria/acessos/validar      { qrToken } → entrada registrada
GET    /portaria/movimentacao         ?data=
POST   /portaria/ocorrencias

PORTAL DO MORADOR (mesmo backend, escopo por vínculo)
GET    /me/cobrancas | /me/extrato | /me/comunicados | /me/penalidades
POST   /me/chamados | /me/pre-autorizacoes
POST   /me/comunicados/:id/leitura    confirmação de leitura

RELATÓRIOS & AUDITORIA
GET    /relatorios/dashboard          KPIs do perfil logado
GET    /relatorios/inadimplencia | /despesas-categoria | /fluxo-mensal
GET    /auditoria                     ?entidade=&usuarioId=&de=&ate= (diretor)
```

## 5. Regras de negócio (as que o código deve garantir)

1. **Isolamento absoluto de tenant** — nenhuma query cruza `condominio_id`; RLS como garantia final.
2. **Papel é vínculo com vigência**, não atributo da pessoa: uma pessoa pode ser proprietária da 101 e síndica ao mesmo tempo; ao encerrar vínculo, o histórico permanece.
3. **Rateio**: soma das parcelas = valor exato do total (ajuste de centavos na maior fração ideal). Preview obrigatório antes da geração em lote.
4. **Título de cobrança tem máquina de estados**: `rascunho → emitida → paga | vencida → paga_em_atraso | cancelada`. Transições fora disso são rejeitadas. `paga` só via webhook confirmado ou baixa manual da tesouraria (auditada, com justificativa).
5. **Encargos de atraso parametrizáveis por condomínio, com teto legal**: multa ≤ 2% + juros ≤ 1% a.m. (art. 1.336 §1º CC) + correção. O sistema calcula no momento do pagamento, não congela na emissão.
6. **Multa regimental exige fluxo completo**: prova anexada + base normativa obrigatórias no registro; advertência antes da multa quando a categoria exigir; prazo de defesa não pode ser zero; **só o perfil com `multa.aprovar` decide**; documento timbrado só existe após decisão; multa aprovada gera lançamento na próxima competência automaticamente (evento).
7. **Despesa acima do limite configurado exige aprovação** (síndico ou diretor conforme faixa). Lançamento nasce `aguardando_aprovacao`.
8. **Fechamento de chamado com custo realizado** dispara lançamento de despesa vinculado à OS.
9. **Bloqueio de tenant inadimplente é degradação, não corte**: admin do condomínio vira somente-leitura; **portal do morador continua pagando cobranças** (cortar o meio de pagamento pune o condomínio errado e piora a inadimplência de todos).
10. **QR de acesso da portaria**: token de uso único/janela curta, invalidado após entrada ou expiração.
11. **Documentos**: retenção mínima configurável (padrão 5 anos); exclusão é soft-delete + expurgo agendado; recibos e comprovantes nunca expurgam antes do prazo fiscal.
12. **Auditoria é append-only** — sem endpoint de UPDATE/DELETE; nem admin apaga trilha.
13. **LGPD**: dados pessoais de vínculo encerrado são anonimizáveis após retenção; exportação completa por titular disponível.

## 6. Fluxo de autenticação

```
login(email, senha)
  → Argon2id verify
  → carrega vínculos ativos do usuário (pode ter papel em N condomínios)
  → se 1 contexto: emite tokens direto; se N: front escolhe → POST /auth/context
  → access JWT (15 min): { sub, condominioId, perfil, permissoes[] }
  → refresh token (30 dias): opaco, hash em banco, rotativo (reuso detectado = revoga família)
```

- **Guards em camadas**: `JwtGuard` → `TenantGuard` (injeta contexto) → `PermissionsGuard` (`@RequirePermission('multa.aprovar')` por rota).
- Portal do morador usa o **mesmo** auth; o que muda é a matriz de permissões e o escopo automático "só minhas unidades" nas rotas `/me/*`.
- Rate limit por IP+conta no login (Redis); bloqueio progressivo; 2FA TOTP opcional por perfil (recomendado obrigatório para tesouraria e administradora).
- Painel SaaS: mesmo mecanismo, `condominioId = null`, perfil `administradora` com permissões `saas.*`.

## 7. Fluxo de pagamento com Verum Pay

```
1. EMISSÃO (lote ou individual)
   POST /cobrancas/lote → job BullMQ "gerar-cobrancas"
   worker: para cada unidade → RateioService calcula → cria título (emitida)
           → VerumPayAdapter.createCharge({ valor, ref: cobrancaId, vencimento })
           → salva { qrPayload, providerChargeId }
           → enfileira notificação por canal escolhido

2. PAGAMENTO
   condômino paga o QR → Verum Pay processa on-chain/Pix

3. CONFIRMAÇÃO (webhook)
   POST /webhooks/verum-pay
   a. valida assinatura HMAC do corpo (rejeita sem log de conteúdo se inválida)
   b. IDEMPOTÊNCIA: insere providerEventId em tabela unique — duplicado? 200 e sai
   c. responde 200 IMEDIATAMENTE; processamento vai para fila
   d. worker: localiza título por providerChargeId
      → valida valor recebido ≥ valor devido + encargos calculados na data
      → transação: título=paga + lançamento de receita + evento pagamento.confirmado
      → evento dispara: comprovante PDF + notificação + invalida cache do dashboard

4. REDE DE SEGURANÇA
   - Job diário ReconciliacaoService: consulta API Verum Pay por títulos "emitida"
     com vencimento passado → encontra pagamento sem webhook → aplica baixa
   - Divergência de valor → título em "pagamento_divergente" → fila da tesouraria
   - Webhook com falha de processamento → retry exponencial (BullMQ), DLQ após 5
```

**Pontos críticos**: idempotência por `providerEventId` (webhooks reenviam), nunca confiar no valor vindo do front (sempre recalcular encargos no servidor), e a reconciliação diária como contrato de confiança — o webhook é otimização, não fonte única da verdade.

## 8. Fluxo de geração de PDF e comprovantes

```
evento (multa.aprovada | pagamento.confirmado | comunicado.publicado | manual)
  → job "gerar-pdf" { templateId, dados, condominioId }
  → worker: carrega template HTML (Handlebars) + identidade visual do condomínio
            (logo, CNPJ, endereço, cor, assinante) do cadastro-mãe
  → renderiza HTML → Chromium headless (Playwright) → PDF/A
  → grava no S3: s3://docs/{condominioId}/{ano}/{tipo}/{id}.pdf
  → registra em `documentos` (tipo, unidade, hash SHA-256 do arquivo, emitente)
  → download sempre via URL pré-assinada com expiração (nunca bucket público)
```

- Templates por tipo (multa, advertência, recibo, comprovante, convocação, ata, autorização) versionados — reemitir documento antigo usa o template da época.
- **Hash do PDF gravado na trilha de auditoria** = prova de integridade ("este documento não foi alterado desde a emissão"), base suficiente para assinatura eletrônica simples; se o jurídico exigir ICP-Brasil depois, pluga-se um provedor no mesmo ponto.
- Comprovante de pagamento é gerado no evento `pagamento.confirmado` e fica imediatamente disponível em `/me/cobrancas` e `/cobrancas/:id/comprovante`.

## 9. Fluxo de notificações (e-mail e WhatsApp)

```
NotificationService.dispatch({ tipo, destinatarios[], canais[], dados })
  → resolve preferências do destinatário (opt-in/opt-out por canal — LGPD)
  → 1 job por destinatário×canal na fila "notificacoes" (rate-limited)
  → providers plugáveis:
       EmailProvider    → SES/Resend (SPF/DKIM no domínio do SaaS)
       WhatsAppProvider → fase 1: link wa.me pré-preenchido (sem custo/aprovação)
                          fase 2: WhatsApp Business Cloud API com templates
                          aprovados (cobrança, comunicado, multa) — mesma interface
  → cada tentativa registra: destinatário, canal, template, status
    (enfileirado → enviado → entregue → falhou), providerMessageId
  → falha: retry exponencial ×3 → marca falha → aparece no painel
    ("3 moradores não receberam a cobrança") para ação manual
```

- Templates centralizados com variáveis tipadas; tudo pt-BR na fase 1, i18n preparado (padrão dos seus produtos multi-moeda/idioma).
- Confirmação de leitura: pixel/rota `POST /me/comunicados/:id/leitura` no portal alimenta o % de leitura do front.
- E-mails transacionais (reset de senha, comprovante) têm fila prioritária separada dos envios em massa.

## 10. Logs, auditoria e segurança

**Auditoria de domínio** (tabela `auditoria`, append-only):
`{ ts, condominioId, usuarioId, perfil, acao, entidade, entidadeId, antes(jsonb), depois(jsonb), ip, userAgent }` — preenchida por interceptor global em toda mutação + eventos de negócio (aprovações, decisões, baixas manuais). Consulta apenas para diretor/administradora. Sem UPDATE/DELETE no schema (revoke).

**Logs técnicos**: Pino estruturado (JSON) com `requestId` + `tenantId` em todo log; **CPF, senha, tokens e payload de webhook nunca logados** (redaction no serializer). Métricas Prometheus (latência, fila, falhas de webhook) + alertas (DLQ > 0, reconciliação com divergência, tentativas de login anômalas).

**Segurança**:
- Senhas Argon2id; refresh rotativo com detecção de reuso; 2FA TOTP para perfis financeiros.
- RLS PostgreSQL como segunda camada de isolamento; usuário de aplicação sem `BYPASSRLS`.
- Validação de entrada global (class-validator + whitelist — campo desconhecido rejeita a requisição).
- Helmet, CORS restrito aos domínios do front, rate limit por rota sensível (login, webhook, download).
- Uploads: tipo/tamanho validados, antivírus (ClamAV no worker) antes de mover para o bucket definitivo, nunca servidos do host da API.
- Webhook: HMAC + allowlist de IP se o Verum Pay suportar + idempotência.
- Segredos via env/secret manager, nunca no repositório; criptografia at-rest no S3 e no Postgres (disco); campos ultrassensíveis (documento de identidade) com criptografia de coluna.
- Backups diários do Postgres com teste de restore mensal; retenção 30 dias + 12 mensais.

## 11. Estrutura de pastas

```
condomaster-api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/                      # horizontais sem regra de negócio
│   │   ├── auth/                    # strategies, guards (Jwt, Tenant, Permissions)
│   │   ├── tenant/                  # TenantContext (AsyncLocalStorage) + Prisma middleware
│   │   ├── rbac/                    # matriz permissões, decorator @RequirePermission
│   │   ├── audit/                   # interceptor + repositório append-only
│   │   ├── storage/                 # S3 client, URLs assinadas, antivírus hook
│   │   ├── pdf/                     # PdfService + templates/ (hbs por tipo)
│   │   ├── notifications/           # NotificationService + providers/ (email, whatsapp)
│   │   ├── payments/                # PaymentProvider interface + verum-pay.adapter.ts
│   │   └── filters, pipes, logger/
│   ├── modules/                     # 1 pasta por domínio do item 2
│   │   ├── saas/                    # controller, service, dto/
│   │   ├── condominios/  unidades/  pessoas/  vagas/
│   │   ├── financeiro/              # + rateio.service.ts
│   │   ├── cobrancas/               # + cobranca.state-machine.ts
│   │   ├── penalidades/             # + penalidade.workflow.ts
│   │   ├── comunicados/  documentos/  manutencao/  portaria/
│   │   ├── portal/                  # rotas /me/* (escopo por vínculo)
│   │   └── relatorios/
│   ├── jobs/                        # processors BullMQ
│   │   ├── gerar-cobrancas.processor.ts
│   │   ├── webhook-pagamento.processor.ts
│   │   ├── reconciliacao.processor.ts     # cron diário
│   │   ├── gerar-pdf.processor.ts
│   │   ├── notificacoes.processor.ts
│   │   └── expurgo-lgpd.processor.ts      # cron
│   └── events/                      # nomes e payloads tipados dos eventos de domínio
├── test/                            # e2e por módulo + unit de RateioService/state machines
├── docker-compose.yml               # api, worker, postgres, redis, minio (dev)
├── Caddyfile
└── .env.example
```

API e worker são o **mesmo código com entrypoints diferentes** (`main.ts` vs `worker.ts`) — escala independente sem duplicação.

---

## Sequência de implementação sugerida

1. **Fundação**: auth + tenant context + RBAC + auditoria + RLS (nada avança sem isso)
2. **Cadastros**: condomínio, unidades, pessoas/vínculos, vagas
3. **Financeiro**: lançamentos, categorias, rateio (com testes de arredondamento)
4. **Cobranças + Verum Pay**: emissão, webhook idempotente, reconciliação — *MVP vendável*
5. **PDF + notificações**: comprovantes e envio de cobrança fecham o ciclo
6. **Portal do morador** (rotas `/me/*`)
7. Penalidades → comunicados/documentos → manutenção → portaria → painel SaaS → relatórios avançados

Cada fase entrega rotas utilizáveis pelo front já construído. O contrato OpenAPI da fase 1-4 pode ser gerado primeiro para o front trocar os mocks por chamadas reais em paralelo.
