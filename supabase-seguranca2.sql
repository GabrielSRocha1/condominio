-- ═══════════════════════════════════════════════════════════════
-- SEGURANÇA — Etapa 2: idempotência das operações financeiras.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- api_idempotencia guarda a RESPOSTA de cada operação mutante identificada
-- por uma Idempotency-Key (gerada pelo app a cada ação do usuário):
--   · retry de rede (conexão oscilou, app reenviou) → mesma chave → o
--     servidor devolve a resposta guardada SEM processar de novo — nada de
--     cobrança dupla, informe duplicado ou duas assinaturas;
--   · corrida (duas requisições iguais em paralelo) → a segunda esbarra na
--     chave primária, espera e devolve a resposta da primeira (ou 409).
-- A linha nasce como "processando" (status null) e é preenchida quando o
-- endpoint responde. Linhas com mais de 24h são varridas na própria rota.
-- ═══════════════════════════════════════════════════════════════

create table if not exists api_idempotencia (
  chave       varchar(200) primary key,   -- usuario:rota:uuid-da-operacao
  usuario_id  uuid,
  rota        varchar(80) not null,
  status      int,                        -- null = requisição ainda processando
  corpo       jsonb,
  criado_em   timestamptz not null default now()
);
create index if not exists idx_api_idem_criado on api_idempotencia (criado_em);

alter table api_idempotencia enable row level security;
-- sem policies: só a service role dos endpoints /api enxerga

-- Verificação rápida (opcional):
--   insert into api_idempotencia (chave, rota) values ('probe', 'teste');
--   delete from api_idempotencia where chave = 'probe';
