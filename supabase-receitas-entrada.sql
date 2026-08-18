-- Acerto único: receitas aprovadas antes da mudança de fluxo ficavam travadas
-- em 'aprovado' ("Em aberto") sem ação disponível na interface. Com o novo
-- fluxo, aprovar uma receita já grava 'pago' (badge "Entrada" — dinheiro no
-- caixa). Este script converte as receitas antigas para o estado novo.
-- Rodar UMA VEZ no SQL Editor do Supabase.

update lancamentos
   set status = 'pago'
 where tipo = 'receita'
   and status = 'aprovado';
