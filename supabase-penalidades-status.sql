-- ═══════════════════════════════════════════════════════════════
-- PENALIDADES: entrega ao responsável + vínculo com a cobrança da multa
--
-- Como usar: Supabase → SQL Editor → colar e executar (idempotente).
--
-- Habilita o ciclo de status das multas/advertências na tela Multas:
--   pendente   → registrada/em defesa (revisão do síndico)
--   aprovada   → síndico aprovou, aguardando envio
--   entregue   → enviada ao responsável (entregue_em preenchido)
--   encerrada  → advertência entregue
--   paga       → multa com a cobrança vinculada paga
--   vencida    → multa cuja cobrança venceu sem pagamento
-- ═══════════════════════════════════════════════════════════════

alter table penalidades add column if not exists entregue_em timestamptz;
alter table penalidades add column if not exists cobranca_id uuid references cobrancas(id);
