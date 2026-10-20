-- ═══════════════════════════════════════════════════════════════
-- NOTIFICAÇÕES — Feed de movimentações financeiras do sino da gestão.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- Triggers gravam na tabela `notificacoes` (schema base, até aqui órfã) um
-- evento por movimentação financeira, para diretor/síndico/tesouraria
-- acompanharem em tempo quase real (o app sonda a cada 30 s):
--   · pagamento.confirmado — cobrança baixada (manual, LOTE, Stripe,
--     cripto): AFTER INSERT em pagamentos — 1 notificação por cobrança,
--     mesmo quando o fundo de reserva divide o lançamento em dois;
--   · conta.paga — despesa marcada como paga (UPDATE → 'pago');
--   · receita.recebida — receita avulsa aprovada (UPDATE → 'pago' SEM
--     origem_tipo 'cobranca' — as de cobrança já notificam pelo INSERT
--     em pagamentos; receitas 'pago' criadas por INSERT fora das RPCs
--     de baixa não notificam — limitação aceita, hoje não há esse caminho).
--
-- pessoa_id NULO = broadcast para a gestão do condomínio (o filtro de
-- perfil é o mesmo do sino, no app). Diferente da auditoria (obrigatória),
-- a notificação é cosmética: os triggers ENGOLEM qualquer erro — uma falha
-- aqui jamais derruba uma baixa ou o webhook da Stripe.
--
-- Sem este RUN o app continua inteiro: o sino só não ganha a seção
-- "Movimentações" (listarNotificacoes degrada para null em silêncio).
-- ═══════════════════════════════════════════════════════════════

-- pessoa_id nulo = broadcast para a gestão (o schema base exigia destinatário)
alter table notificacoes alter column pessoa_id drop not null;

-- consulta do sino: últimas movimentações do condomínio, mais novas primeiro
create index if not exists idx_notificacoes_feed
  on notificacoes (condominio_id, criado_em desc);

-- Registrador comum (security definer ignora o RLS de escrita da tabela) --
create or replace function public.notificar_gestao(
  p_condominio uuid, p_evento varchar, p_titulo varchar,
  p_payload jsonb, p_ref_tipo varchar, p_ref_id uuid
) returns void
language sql security definer set search_path = public as $$
  insert into notificacoes (condominio_id, pessoa_id, evento, titulo, payload,
                            canais, referencia_tipo, referencia_id)
    values (p_condominio, null, p_evento, left(coalesce(p_titulo, p_evento), 200),
            coalesce(p_payload, '{}'::jsonb), '["portal"]'::jsonb, p_ref_tipo, p_ref_id);
$$;
revoke all on function public.notificar_gestao(uuid, varchar, varchar, jsonb, varchar, uuid) from public, anon, authenticated;

-- ENTRADA RECEBIDA: toda baixa de cobrança passa por um INSERT em
-- pagamentos (RPCs manuais/lote, webhook Stripe, cripto) — mesmo padrão do
-- trg_auditoria_pagamentos. O titulo é só fallback de exibição; o app
-- monta o texto traduzido a partir do payload.
create or replace function public.notificar_pagamento_recebido() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_comp    char(7);
  v_unidade text;
begin
  select c.competencia, u.numero || '-' || coalesce(b.nome, '?')
    into v_comp, v_unidade
    from cobrancas c
    join unidades u on u.id = c.unidade_id
    left join blocos b on b.id = u.bloco_id
   where c.id = new.cobranca_id;
  perform public.notificar_gestao(
    new.condominio_id, 'pagamento.confirmado',
    'Entrada recebida — ' || coalesce(v_unidade, '?')
      || coalesce(' · ' || substr(v_comp, 6, 2) || '/' || substr(v_comp, 1, 4), ''),
    jsonb_build_object('valor', new.valor_pago, 'origem', new.origem,
                       'unidade', v_unidade, 'competencia', v_comp,
                       'cobranca_id', new.cobranca_id),
    'cobranca', new.cobranca_id);
  return new;
exception when others then
  return new;  -- notificação é cosmética: NUNCA derruba a baixa
end $$;
drop trigger if exists trg_notificar_pagamentos on pagamentos;
create trigger trg_notificar_pagamentos
  after insert on pagamentos
  for each row execute function public.notificar_pagamento_recebido();

-- CONTA PAGA e RECEITA AVULSA: só a TRANSIÇÃO para 'pago' por UPDATE
-- (marcarLancamentoPago e decidirLancamento). As receitas de cobrança
-- nascem por INSERT já 'pago' nas RPCs de baixa (origem_tipo 'cobranca')
-- e não passam aqui — sem notificação dupla, mesmo com o split do fundo.
create or replace function public.notificar_lancamento_pago() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'despesa' then
    perform public.notificar_gestao(
      new.condominio_id, 'conta.paga',
      'Conta paga — ' || coalesce(new.descricao, ''),
      jsonb_build_object('valor', new.valor, 'descricao', new.descricao,
                         'competencia', new.competencia),
      'lancamento', new.id);
  elsif new.tipo = 'receita' and coalesce(new.origem_tipo, '') <> 'cobranca' then
    perform public.notificar_gestao(
      new.condominio_id, 'receita.recebida',
      'Receita recebida — ' || coalesce(new.descricao, ''),
      jsonb_build_object('valor', new.valor, 'descricao', new.descricao,
                         'competencia', new.competencia),
      'lancamento', new.id);
  end if;
  return new;
exception when others then
  return new;  -- idem: erro aqui não pode abortar a baixa da despesa
end $$;
drop trigger if exists trg_notificar_lancamentos on lancamentos;
create trigger trg_notificar_lancamentos
  after update of status on lancamentos
  for each row
  when (new.status = 'pago' and old.status is distinct from new.status)
  execute function public.notificar_lancamento_pago();

-- Manutenção (opcional, manual): o sino lê só as 30 mais recentes; para
-- conter o crescimento, expurgue de tempos em tempos:
--   delete from notificacoes where criado_em < now() - interval '90 days';

-- Fase 2 (opcional, NÃO rode agora): entrega por Supabase Realtime em vez
-- de polling. Além da linha abaixo, o client precisa chamar
-- supabase.realtime.setAuth(token) e REASSINAR o canal a cada renovação do
-- JWT (src/lib/supabase.js recria o client ao renovar — canais morrem).
--   alter publication supabase_realtime add table notificacoes;

-- Verificação rápida (opcional):
--   baixe uma cobrança no app (ou pague uma conta) e rode:
--   select evento, titulo, pessoa_id, criado_em from notificacoes
--    order by criado_em desc limit 5;
--   → 1 linha por pagamento (mesmo com fundo de reserva ativo), pessoa_id nulo.
-- ═══════════════════════════════════════════════════════════════
