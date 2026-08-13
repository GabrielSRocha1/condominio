-- ═══════════════════════════════════════════════════════════════
-- TESTE GRATUITO: 30 dias via Commet (cartão salvo no checkout,
-- nada cobrado até o fim do teste; cobrança automática depois).
-- Como usar: Supabase → SQL Editor → colar e executar (idempotente).
--
--   teste_fim       → último dia do teste. NULL = o teste ainda não
--                     foi iniciado no Commet (o paywall pede o cadastro
--                     do cartão antes de liberar o acesso).
--   teste_estendido → o diretor já usou a extensão única de +30 dias.
--
-- Já incluído no supabase-schema.sql para instalações novas.
-- ═══════════════════════════════════════════════════════════════

alter table saas_assinaturas add column if not exists teste_fim date;
alter table saas_assinaturas add column if not exists teste_estendido boolean not null default false;
