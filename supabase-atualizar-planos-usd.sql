-- ═══════════════════════════════════════════════════════════════════
-- ATUALIZAÇÃO DOS PLANOS — preços sempre em DÓLAR (USD)
-- Rode este script no SQL Editor do Supabase em bancos já criados
-- (o supabase-schema.sql novo já traz estes valores para bancos novos).
-- ═══════════════════════════════════════════════════════════════════

-- coluna nova: preço anual (em dólar)
alter table saas_planos add column if not exists preco_anual numeric(14,2);

-- Essencial — $49.90/mês · $499.00/ano · até 100 unidades
update saas_planos set preco_mensal = 49.90,  preco_anual = 499.00,  limite_unidades = 100,  atualizado_em = now() where nome = 'Essencial';

-- Standard — $99.90/mês · $999.00/ano · até 500 unidades
update saas_planos set preco_mensal = 99.90,  preco_anual = 999.00,  limite_unidades = 500,  atualizado_em = now() where nome = 'Standard';

-- Premium — $299.90/mês · $2,999.00/ano · até 2000 unidades
update saas_planos set preco_mensal = 299.90, preco_anual = 2999.00, limite_unidades = 2000, atualizado_em = now() where nome = 'Premium';

select nome, preco_mensal, preco_anual, limite_unidades from saas_planos order by preco_mensal;
