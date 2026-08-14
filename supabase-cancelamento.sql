-- ═══════════════════════════════════════════════════════════════
-- CANCELAMENTO AGENDADO DA ASSINATURA (aviso na tela Planos)
-- Como usar: Supabase → SQL Editor → colar e executar (idempotente).
--
--   cancelamento_agendado_em → dia em que o cliente pediu o cancelamento
--   acesso_ate               → dia em que o acesso será desativado
--                              (fim do período já pago / do teste)
--
-- As duas voltam a NULL quando a licença é reativada.
-- Já incluído no supabase-schema.sql para instalações novas.
-- ═══════════════════════════════════════════════════════════════

alter table saas_assinaturas add column if not exists cancelamento_agendado_em date;
alter table saas_assinaturas add column if not exists acesso_ate date;
