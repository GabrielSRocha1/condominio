-- ═══════════════════════════════════════════════════════════════════════════
-- CONDOMASTER PRO — SCHEMA COMPLETO PARA SUPABASE (PostgreSQL)
-- Gerado a partir de MODELAGEM-BANCO-DE-DADOS.tsv (v1)
--
-- COMO USAR:
--   1. Abra seu projeto no https://supabase.com/dashboard
--   2. Menu lateral → SQL Editor → New query
--   3. Cole este arquivo INTEIRO e clique em RUN
--
-- O script é idempotente onde possível, mas foi pensado para rodar UMA vez
-- em um banco vazio. Para recomeçar do zero, rode antes:
--   drop schema public cascade; create schema public;
--   grant usage on schema public to anon, authenticated, service_role;
--   grant all on schema public to postgres, service_role;
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── EXTENSÕES ───────────────────────────
create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;  -- constraint de exclusão em reservas

-- ─────────────────────────── ENUMS ───────────────────────────
create type assinatura_status      as enum ('teste','ativa','inadimplente','bloqueada','cancelada');
create type assinatura_pagamento   as enum ('verum_pay','transferencia');
create type condominio_tipo        as enum ('residencial','comercial','misto');
create type condominio_porte       as enum ('alto','medio','baixo');
create type unidade_tipo           as enum ('apartamento','sala','loja','cobertura','box','deposito');
create type unidade_status         as enum ('ocupada','vaga','alugada','vendida','reservada','inativa');
create type vaga_tipo              as enum ('fixa','rotativa','visitante','pcd','moto');
create type vaga_status            as enum ('livre','vinculada','bloqueada');
create type pessoa_tipo            as enum ('fisica','juridica');
create type vinculo_papel          as enum ('proprietario','coproprietario','inquilino','morador','dependente','sindico','diretor','tesouraria','conselho_fiscal','funcionario','prestador','visitante_recorrente','imobiliaria');
create type categoria_fin_tipo     as enum ('receita','despesa','ambas');
create type lancamento_tipo        as enum ('receita','despesa');
create type forma_pagamento        as enum ('verum_pay','transferencia','debito_automatico','dinheiro');
create type lancamento_status      as enum ('aguardando_aprovacao','aprovado','rejeitado','pago','cancelado');
create type cobranca_tipo          as enum ('ordinaria','extra','multa','chamada_caixa');
create type cobranca_status        as enum ('rascunho','emitida','paga','vencida','paga_em_atraso','cancelada','pagamento_divergente');
create type pagamento_origem       as enum ('webhook','baixa_manual','reconciliacao');
create type provedor_pagamento     as enum ('verum_pay');
create type penalidade_tipo        as enum ('advertencia','multa');
create type penalidade_status      as enum ('registrada','em_defesa','aprovada','cancelada','lancada');
create type prova_tipo             as enum ('foto','video','audio','documento');
create type comunicado_tipo        as enum ('comunicado','convocacao','circular','aviso_manutencao','emergencia');
create type documento_tipo         as enum ('multa','advertencia','recibo','comprovante','convocacao','ata','autorizacao','circular','extrato','ordem_servico');
create type envio_canal            as enum ('email','whatsapp','push','portal');
create type envio_status           as enum ('enfileirado','enviado','entregue','falhou');
create type chamado_categoria      as enum ('eletrica','hidraulica','pintura','limpeza','elevador','portao','cameras','jardinagem','estrutural','telhado','area_comum','equipamentos','emergencia');
create type chamado_prioridade     as enum ('baixa','media','alta');
create type chamado_status         as enum ('aberto','andamento','concluido','cancelado');
create type reserva_status         as enum ('solicitada','confirmada','cancelada','concluida');
create type assembleia_tipo        as enum ('ordinaria','extraordinaria');
create type assembleia_modalidade  as enum ('presencial','digital','hibrida');
create type assembleia_status      as enum ('convocada','realizada','cancelada');
create type pre_autorizacao_tipo   as enum ('visitante','prestador','entrega','recorrente');
create type acesso_tipo            as enum ('entrada','saida','entrega','ocorrencia');

-- ═══════════════════════ GRUPO SaaS ═══════════════════════

-- 1 · saas_planos — Planos comerciais do SaaS
create table saas_planos (
  id               uuid primary key default gen_random_uuid(),
  nome             varchar(60) not null,
  preco_mensal     numeric(14,2) not null,
  limite_unidades  integer,                              -- NULL = ilimitado
  modulos          jsonb not null default '{}'::jsonb,   -- feature flags
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- 3 · condominios — Cadastro-mãe de cada condomínio (tenant)
-- (sindico_pessoa_id vira FK depois que a tabela pessoas existir)
create table condominios (
  id                  uuid primary key default gen_random_uuid(),
  nome_fantasia       varchar(120) not null,
  razao_social        varchar(160) not null,
  cnpj                varchar(18) not null unique,
  inscricao_municipal varchar(30),
  endereco            jsonb not null,
  tipo                condominio_tipo not null,
  porte               condominio_porte not null,
  regras_internas     jsonb,
  identidade_visual   jsonb,
  encargos_atraso     jsonb not null default '{"multa_pct":2,"juros_am_pct":1}'::jsonb,
  sindico_pessoa_id   uuid,
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- 2 · saas_assinaturas — Contrato de cada condomínio com o SaaS
create table saas_assinaturas (
  id                     uuid primary key default gen_random_uuid(),
  condominio_id          uuid not null references condominios(id),
  plano_id               uuid not null references saas_planos(id),
  status                 assinatura_status not null default 'teste',
  inicio                 date not null,
  renovacao              date,
  forma_pagamento        assinatura_pagamento not null,
  bloqueada_em           timestamptz,
  checklist_implantacao  jsonb,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
-- 1 assinatura não-cancelada por condomínio
create unique index uq_assinatura_ativa on saas_assinaturas (condominio_id) where status <> 'cancelada';

-- ═══════════════════════ GRUPO NÚCLEO ═══════════════════════

-- 4 · blocos — Torres/blocos/alas
create table blocos (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  nome           varchar(40) not null,
  andares        integer,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- 7 · pessoas — Cadastro único de pessoas físicas e jurídicas (sem papel)
create table pessoas (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  nome           varchar(160) not null,
  tipo_pessoa    pessoa_tipo not null,
  cpf_cnpj       varchar(18) not null,
  nascimento     date,
  telefone       varchar(20),
  email          varchar(160),
  foto_url       varchar(300),
  documento_url  varchar(300),
  consentimentos jsonb,          -- LGPD: opt-in por canal e data
  anonimizada_em timestamptz,    -- LGPD: expurgo após retenção
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (condominio_id, cpf_cnpj)
);

-- FK adiada de condominios (dependência circular condominios ↔ pessoas)
alter table condominios
  add constraint fk_condominios_sindico foreign key (sindico_pessoa_id) references pessoas(id);

-- 5 · unidades — Apartamentos, salas, lojas, coberturas, boxes e depósitos
create table unidades (
  id                        uuid primary key default gen_random_uuid(),
  condominio_id             uuid not null references condominios(id),
  bloco_id                  uuid not null references blocos(id),
  numero                    varchar(20) not null,
  tipo                      unidade_tipo not null,
  andar                     integer,
  status                    unidade_status not null default 'vaga',
  fracao_ideal              numeric(9,6) not null,
  area_privativa_m2         numeric(10,2),
  unidade_principal_id      uuid references unidades(id),   -- box/depósito dependente
  responsavel_financeiro_id uuid references pessoas(id),
  observacoes               text,
  deletado_em               timestamptz,                    -- soft delete
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now(),
  unique (condominio_id, bloco_id, numero)
);

-- 6 · vagas — Vagas de garagem
create table vagas (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  numero         varchar(20) not null,
  tipo           vaga_tipo not null,
  status         vaga_status not null default 'livre',
  unidade_id     uuid references unidades(id),   -- NULL em rotativa/visitante
  restricoes     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ═══════════════════════ GRUPO PESSOAS ═══════════════════════

-- 8 · pessoa_vinculos — Papel de cada pessoa, com unidade e vigência
create table pessoa_vinculos (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  pessoa_id      uuid not null references pessoas(id),
  unidade_id     uuid references unidades(id),   -- NULL p/ funcionário/prestador/síndico
  papel          vinculo_papel not null,
  inicio         date not null,
  fim            date,                           -- NULL = vigente
  observacoes    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ═══════════════════════ GRUPO ACESSO ═══════════════════════

-- 9 · usuarios — Contas de acesso vinculadas a pessoas
create table usuarios (
  id              uuid primary key default gen_random_uuid(),
  pessoa_id       uuid not null unique references pessoas(id),   -- 1:1
  email           varchar(160) not null unique,
  senha_hash      varchar(255) not null,
  totp_secret     varchar(64),
  ultimo_login_em timestamptz,
  bloqueado_em    timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- 10 · perfis — Perfis de acesso
create table perfis (
  id            uuid primary key default gen_random_uuid(),
  nome          varchar(40) not null unique,
  descricao     varchar(200),
  sistema       boolean not null default false,   -- perfis nativos não podem ser excluídos
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 11 · permissoes — Permissões granulares
create table permissoes (
  id            uuid primary key default gen_random_uuid(),
  codigo        varchar(60) not null unique,      -- ex.: financeiro.lancar, multa.aprovar
  descricao     varchar(200) not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 12 · perfil_permissoes — Matriz N:N perfil × permissão
create table perfil_permissoes (
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references perfis(id),
  permissao_id  uuid not null references permissoes(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (perfil_id, permissao_id)
);

-- 13 · usuario_perfis — Perfil de cada usuário em cada condomínio
create table usuario_perfis (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id),
  condominio_id uuid references condominios(id),   -- NULL = perfil global do SaaS
  perfil_id     uuid not null references perfis(id),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique nulls not distinct (usuario_id, condominio_id, perfil_id)
);

-- ═══════════════════════ GRUPO FINANCEIRO ═══════════════════════

-- 14 · categorias_financeiras — Categorias de receita/despesa (árvore)
create table categorias_financeiras (
  id               uuid primary key default gen_random_uuid(),
  condominio_id    uuid not null references condominios(id),
  nome             varchar(80) not null,
  tipo             categoria_fin_tipo not null,
  categoria_pai_id uuid references categorias_financeiras(id),   -- subcategorias
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- 15 · fundos — Fundos do condomínio (reserva, obras)
create table fundos (
  id            uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  nome          varchar(60) not null,
  saldo         numeric(14,2) not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 16 · lancamentos — Receitas e despesas
create table lancamentos (
  id               uuid primary key default gen_random_uuid(),
  condominio_id    uuid not null references condominios(id),
  tipo             lancamento_tipo not null,
  categoria_id     uuid not null references categorias_financeiras(id),
  fundo_id         uuid references fundos(id),
  descricao        varchar(240) not null,
  valor            numeric(14,2) not null check (valor > 0),   -- sinal vem do tipo
  data             date not null,
  competencia      char(7) not null check (competencia ~ '^\d{4}-\d{2}$'),   -- AAAA-MM
  centro_custo     varchar(80),
  forma_pagamento  forma_pagamento,
  status           lancamento_status not null default 'aguardando_aprovacao',
  lancado_por      uuid not null references usuarios(id),
  aprovado_por     uuid references usuarios(id),
  nota_fiscal_url  varchar(300),
  origem_tipo      varchar(30),   -- penalidade · chamado · cobranca · manual
  origem_id        uuid,          -- FK polimórfica — validada na aplicação
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- 24 · documentos — Arquivo central de PDFs timbrados
-- (criada antes de cobrancas/penalidades, que apontam para cá)
create table documentos (
  id              uuid primary key default gen_random_uuid(),
  condominio_id   uuid not null references condominios(id),
  tipo            documento_tipo not null,
  titulo          varchar(200) not null,
  unidade_id      uuid references unidades(id),
  arquivo_url     varchar(300) not null,
  hash_sha256     char(64) not null,
  template_versao varchar(20) not null,
  emitido_por     uuid not null references usuarios(id),
  retencao_ate    date not null,       -- padrão: emissão + 5 anos
  deletado_em     timestamptz,         -- expurgo físico só após retencao_ate
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- 17 · cobrancas — Títulos por unidade/competência
create table cobrancas (
  id                        uuid primary key default gen_random_uuid(),
  condominio_id             uuid not null references condominios(id),
  unidade_id                uuid not null references unidades(id),
  responsavel_id            uuid not null references pessoas(id),
  competencia               char(7) not null check (competencia ~ '^\d{4}-\d{2}$'),
  tipo                      cobranca_tipo not null,
  valor_original            numeric(14,2) not null,
  encargos                  numeric(14,2),
  vencimento                date not null,
  status                    cobranca_status not null default 'rascunho',
  qr_payload                text,
  provider_charge_id        varchar(80),
  lote_id                   uuid,
  comprovante_documento_id  uuid references documentos(id),
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);
-- 1 taxa ordinária por unidade/competência
create unique index uq_cobranca_ordinaria on cobrancas (unidade_id, competencia)
  where tipo = 'ordinaria' and status <> 'cancelada';
create index idx_cobrancas_provider on cobrancas (provider_charge_id);   -- chave do webhook

-- 18 · pagamentos — Transações recebidas
create table pagamentos (
  id                 uuid primary key default gen_random_uuid(),
  condominio_id      uuid not null references condominios(id),
  cobranca_id        uuid not null references cobrancas(id),
  valor_pago         numeric(14,2) not null,
  pago_em            timestamptz not null,
  origem             pagamento_origem not null,
  provider_event_id  varchar(80) unique,   -- idempotência do webhook
  provider_tx_id     varchar(80),
  baixado_por        uuid references usuarios(id),
  justificativa      text,                 -- obrigatória em baixa manual
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  check (origem <> 'baixa_manual' or justificativa is not null)
);

-- 19 · integracoes_pagamento — Config do provedor por condomínio
create table integracoes_pagamento (
  id               uuid primary key default gen_random_uuid(),
  condominio_id    uuid not null references condominios(id),
  provedor         provedor_pagamento not null default 'verum_pay',
  credenciais      jsonb not null,          -- criptografadas na aplicação
  webhook_secret   varchar(120) not null,   -- validação HMAC
  conta_recebedora jsonb not null,
  ativa            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- ═══════════════════════ GRUPO PENALIDADES ═══════════════════════

-- 20 · penalidades — Multas e advertências
create table penalidades (
  id                 uuid primary key default gen_random_uuid(),
  condominio_id      uuid not null references condominios(id),
  numero             varchar(20) not null,   -- sequencial por ano: 2026-014
  tipo               penalidade_tipo not null,
  unidade_id         uuid not null references unidades(id),
  infrator_id        uuid references pessoas(id),
  categoria_infracao varchar(120) not null,
  descricao          text not null,
  base_normativa     varchar(200) not null,   -- artigo da convenção/regimento
  ocorrida_em        timestamptz not null,
  valor              numeric(14,2),           -- NULL em advertência
  prazo_defesa       date,
  defesa_texto       text,
  status             penalidade_status not null default 'registrada',
  registrada_por     uuid not null references usuarios(id),
  decidida_por       uuid references usuarios(id),
  parecer            text,
  documento_id       uuid references documentos(id),
  lancamento_id      uuid references lancamentos(id),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (condominio_id, numero),
  check (tipo <> 'multa' or valor is not null)   -- multa exige valor
);

-- 21 · penalidade_provas — Arquivos de prova
create table penalidade_provas (
  id            uuid primary key default gen_random_uuid(),
  penalidade_id uuid not null references penalidades(id),
  tipo          prova_tipo not null,
  arquivo_url   varchar(300) not null,
  hash_sha256   char(64) not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ═══════════════════════ GRUPO COMUNICAÇÃO ═══════════════════════

-- 22 · comunicados
create table comunicados (
  id            uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  tipo          comunicado_tipo not null,
  titulo        varchar(200) not null,
  corpo         text not null,
  segmento      jsonb not null,   -- todos · bloco X · lojas · inadimplentes…
  canais        jsonb not null,   -- ["portal","email","whatsapp"]
  publicado_em  timestamptz,      -- NULL = rascunho
  publicado_por uuid not null references usuarios(id),
  documento_id  uuid references documentos(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 23 · comunicado_destinatarios — Confirmação de leitura
create table comunicado_destinatarios (
  id            uuid primary key default gen_random_uuid(),
  comunicado_id uuid not null references comunicados(id),
  pessoa_id     uuid not null references pessoas(id),
  lido_em       timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (comunicado_id, pessoa_id)
);

-- 25 · notificacoes — Fila lógica
create table notificacoes (
  id              uuid primary key default gen_random_uuid(),
  condominio_id   uuid not null references condominios(id),
  pessoa_id       uuid not null references pessoas(id),
  evento          varchar(60) not null,   -- cobranca.emitida · pagamento.confirmado…
  titulo          varchar(200) not null,
  payload         jsonb not null,
  canais          jsonb not null,         -- respeitando opt-in LGPD
  referencia_tipo varchar(30),
  referencia_id   uuid,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- 26 · envios_log — Cada tentativa de envio por canal
create table envios_log (
  id                  uuid primary key default gen_random_uuid(),
  notificacao_id      uuid not null references notificacoes(id),
  canal               envio_canal not null,
  destinatario        varchar(160) not null,
  template            varchar(60) not null,
  status              envio_status not null default 'enfileirado',
  provider_message_id varchar(120),
  erro                text,
  tentativas          integer not null default 0,
  enviado_em          timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- ═══════════════════════ GRUPO OPERAÇÃO ═══════════════════════

-- 27 · chamados — Ordens de serviço de manutenção
create table chamados (
  id                     uuid primary key default gen_random_uuid(),
  condominio_id          uuid not null references condominios(id),
  numero                 varchar(20) not null,   -- OS-231
  categoria              chamado_categoria not null,
  prioridade             chamado_prioridade not null default 'media',
  descricao              text not null,
  status                 chamado_status not null default 'aberto',
  aberto_por             uuid not null references usuarios(id),
  unidade_id             uuid references unidades(id),
  responsavel_vinculo_id uuid references pessoa_vinculos(id),
  prazo                  date,
  custo_estimado         numeric(14,2),
  custo_realizado        numeric(14,2),
  midias                 jsonb,
  fechado_em             timestamptz,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  unique (condominio_id, numero)
);

-- 28 · areas_comuns — Áreas reserváveis
create table areas_comuns (
  id            uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id),
  nome          varchar(80) not null,
  regras        jsonb,
  taxa          numeric(14,2),   -- gera cobrança extra quando > 0
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 29 · reservas — Reservas de áreas comuns
create table reservas (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  area_id        uuid not null references areas_comuns(id),
  unidade_id     uuid not null references unidades(id),
  solicitante_id uuid not null references pessoas(id),
  inicio         timestamptz not null,
  fim            timestamptz not null,
  status         reserva_status not null default 'solicitada',
  cobranca_id    uuid references cobrancas(id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check (fim > inicio),
  -- sem sobreposição de horário na mesma área (só reservas vivas)
  exclude using gist (
    area_id with =,
    tstzrange(inicio, fim) with &&
  ) where (status in ('solicitada','confirmada'))
);

-- 30 · assembleias
create table assembleias (
  id                        uuid primary key default gen_random_uuid(),
  condominio_id             uuid not null references condominios(id),
  tipo                      assembleia_tipo not null,
  modalidade                assembleia_modalidade not null,
  data_hora                 timestamptz not null,
  pauta                     jsonb not null,
  convocacao_documento_id   uuid references documentos(id),
  quorum_minimo             numeric(5,2),
  presencas                 jsonb,
  status                    assembleia_status not null default 'convocada',
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);

-- 31 · atas — 1:1 com a assembleia realizada
create table atas (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  assembleia_id  uuid not null unique references assembleias(id),
  deliberacoes   jsonb not null,
  documento_id   uuid not null references documentos(id),
  registrada_por uuid not null references usuarios(id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ═══════════════════════ GRUPO PORTARIA ═══════════════════════

-- 32 · pre_autorizacoes — Entradas pré-autorizadas com QR de uso único
create table pre_autorizacoes (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  tipo           pre_autorizacao_tipo not null,
  nome           varchar(160) not null,
  unidade_id     uuid not null references unidades(id),
  autorizada_por uuid not null references usuarios(id),
  valida_de      timestamptz not null,
  valida_ate     timestamptz not null,
  qr_token_hash  char(64) not null,
  veiculo_placa  varchar(10),
  usada_em       timestamptz,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check (valida_ate > valida_de)
);

-- 33 · acessos_portaria — Registro de entrada/saída/entrega/ocorrência
create table acessos_portaria (
  id                 uuid primary key default gen_random_uuid(),
  condominio_id      uuid not null references condominios(id),
  tipo               acesso_tipo not null,
  pre_autorizacao_id uuid references pre_autorizacoes(id),
  pessoa_nome        varchar(160) not null,   -- snapshot do nome
  unidade_id         uuid references unidades(id),
  registrado_por     uuid not null references usuarios(id),
  detalhes           text,
  ocorrido_em        timestamptz not null,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

-- ═══════════════════════ GRUPO GOVERNANÇA ═══════════════════════

-- 34 · auditoria — Trilha append-only (sem UPDATE/DELETE)
create table auditoria (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  condominio_id uuid references condominios(id),   -- NULL em ações do painel SaaS
  usuario_id    uuid references usuarios(id),      -- NULL em ações de sistema
  perfil        varchar(40),
  acao          varchar(60) not null,              -- criar · atualizar · aprovar · login…
  entidade      varchar(60) not null,
  entidade_id   uuid,
  antes         jsonb,
  depois        jsonb,
  ip            inet,
  user_agent    varchar(300)
);
revoke update, delete on auditoria from anon, authenticated;

-- ═══════════════════════ ÍNDICES MULTI-TENANT ═══════════════════════
-- condominio_id é filtrado em praticamente toda consulta
create index idx_blocos_tenant        on blocos (condominio_id);
create index idx_unidades_tenant      on unidades (condominio_id);
create index idx_vagas_tenant         on vagas (condominio_id);
create index idx_pessoas_tenant       on pessoas (condominio_id);
create index idx_vinculos_tenant      on pessoa_vinculos (condominio_id);
create index idx_vinculos_pessoa      on pessoa_vinculos (pessoa_id);
create index idx_vinculos_unidade     on pessoa_vinculos (unidade_id);
create index idx_categorias_tenant    on categorias_financeiras (condominio_id);
create index idx_fundos_tenant        on fundos (condominio_id);
create index idx_lancamentos_tenant   on lancamentos (condominio_id, competencia);
create index idx_cobrancas_tenant     on cobrancas (condominio_id, competencia);
create index idx_cobrancas_unidade    on cobrancas (unidade_id);
create index idx_pagamentos_tenant    on pagamentos (condominio_id);
create index idx_pagamentos_cobranca  on pagamentos (cobranca_id);
create index idx_penalidades_tenant   on penalidades (condominio_id);
create index idx_provas_penalidade    on penalidade_provas (penalidade_id);
create index idx_comunicados_tenant   on comunicados (condominio_id);
create index idx_destinatarios_com    on comunicado_destinatarios (comunicado_id);
create index idx_documentos_tenant    on documentos (condominio_id);
create index idx_notificacoes_tenant  on notificacoes (condominio_id, pessoa_id);
create index idx_envios_notificacao   on envios_log (notificacao_id);
create index idx_chamados_tenant      on chamados (condominio_id, status);
create index idx_areas_tenant         on areas_comuns (condominio_id);
create index idx_reservas_tenant      on reservas (condominio_id);
create index idx_reservas_area        on reservas (area_id, inicio);
create index idx_assembleias_tenant   on assembleias (condominio_id);
create index idx_preaut_tenant        on pre_autorizacoes (condominio_id, valida_ate);
create index idx_acessos_tenant       on acessos_portaria (condominio_id, ocorrido_em);
create index idx_auditoria_tenant     on auditoria (condominio_id, ts);

-- ═══════════════════════ TRIGGER atualizado_em ═══════════════════════
create or replace function set_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'atualizado_em'
  loop
    execute format(
      'create trigger trg_%I_atualizado before update on public.%I
       for each row execute function set_atualizado_em()',
      t.table_name, t.table_name
    );
  end loop;
end $$;

-- ═══════════════════════ ROW LEVEL SECURITY ═══════════════════════
-- ⚠️  ATENÇÃO: as políticas abaixo são de DESENVOLVIMENTO — liberam leitura e
-- escrita para qualquer requisição com a chave anon/authenticated, para você
-- conseguir gravar nas tabelas direto do frontend enquanto desenvolve.
-- ANTES DE COLOCAR EM PRODUÇÃO, substitua por políticas por tenant
-- (filtrando por condominio_id do usuário logado via Supabase Auth).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format(
      'create policy dev_acesso_total on public.%I
       for all to anon, authenticated using (true) with check (true)',
      t.tablename
    );
  end loop;
end $$;

-- ═══════════════════════ SEEDS INICIAIS (opcional) ═══════════════════════

-- Planos do SaaS (batem com o Painel SaaS do frontend)
insert into saas_planos (nome, preco_mensal, limite_unidades, modulos) values
  ('Essencial', 249.00, 60,   '{"portaria":false,"whatsapp":false,"assembleia_digital":false}'),
  ('Standard',  449.00, 200,  '{"portaria":true,"whatsapp":false,"assembleia_digital":true}'),
  ('Premium',   849.00, null, '{"portaria":true,"whatsapp":true,"assembleia_digital":true}');

-- Perfis nativos do sistema (batem com os perfis do frontend)
insert into perfis (nome, descricao, sistema) values
  ('administradora', 'Gestão SaaS: clientes, planos e licenças', true),
  ('diretor',        'Visão estratégica, aprovações e auditoria', true),
  ('sindico',        'Operação, multas, comunicados e manutenção', true),
  ('tesouraria',     'Financeiro, cobranças e conciliação', true),
  ('conselho_fiscal','Consulta fiscal e pareceres', true),
  ('morador',        'Boletos, comprovantes, comunicados e chamados', true),
  ('funcionario',    'Operação interna designada', true),
  ('prestador',      'Prestador de serviço externo', true);

-- Permissões básicas de exemplo
insert into permissoes (codigo, descricao) values
  ('financeiro.lancar',  'Criar lançamentos de receita e despesa'),
  ('financeiro.aprovar', 'Aprovar lançamentos acima do limite'),
  ('cobranca.emitir',    'Emitir cobranças e QR de pagamento'),
  ('multa.registrar',    'Registrar multas e advertências'),
  ('multa.aprovar',      'Decidir multas após defesa'),
  ('comunicado.publicar','Publicar comunicados e convocações'),
  ('documento.emitir',   'Emitir documentos timbrados'),
  ('saas.gerir',         'Administrar planos, assinaturas e clientes do SaaS');

-- ═══════════════════════ FIM ═══════════════════════
-- Próximo passo: copie a URL e a anon key do projeto
-- (Dashboard → Settings → API) para o arquivo .env do projeto.
