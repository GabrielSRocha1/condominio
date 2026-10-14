-- ═══════════════════════════════════════════════════════════════
-- ENCARGOS DE ATRASO NO CAIXA
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que este arquivo corrige: as duas funções de baixa lançavam SEMPRE
-- c.valor_original como receita no caixa. Com os encargos de atraso
-- ativos (multa + juros — condominios.encargos_atraso, configurado na
-- tela Condomínio), o morador paga principal + encargos, mas a mora
-- recebida evaporava do saldo. Agora:
--   · registrar_pagamento_manual  → lança COALESCE(p_valor, valor_original)
--     (o valor que o gestor confirmou de fato);
--   · registrar_pagamento_stripe  → ganha p_valor_caixa (principal +
--     encargos, SEM a taxa de conveniência — o checkout manda no metadata)
--     e lança COALESCE(p_valor_caixa, valor_original).
--
-- Sem este RUN o app continua funcionando: o backend detecta a função
-- antiga e repete a chamada sem o parâmetro novo — o caixa só continua
-- lançando o valor_original, como sempre (degrada aberto).
--
-- A assinatura do registrar_pagamento_stripe MUDA (parâmetro novo com
-- default): o DROP abaixo remove a versão antiga para não criar uma
-- sobrecarga ambígua no PostgREST.
-- ═══════════════════════════════════════════════════════════════

-- A) Baixa manual/reconciliada: o caixa recebe o valor confirmado -----
create or replace function public.registrar_pagamento_manual(
  p_cobranca_id   uuid,
  p_forma         forma_pagamento,
  p_valor         numeric,
  p_pago_em       timestamptz,
  p_justificativa text,
  p_tx            varchar default null,
  p_informado_id  uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        cobrancas%rowtype;
  v_cat    uuid;
  v_status cobranca_status;
  v_evento varchar(80);
  v_forma_rotulo text;
begin
  select * into c from cobrancas where id = p_cobranca_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'cobranca_inexistente');
  end if;

  -- autorização: service role (endpoints) OU gestor do próprio condomínio
  if public.jwt_role() <> 'service_role' then
    if public.jwt_perfil() not in ('diretor','sindico','tesouraria')
       or public.jwt_condominio() is distinct from c.condominio_id then
      return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
    end if;
  end if;

  if coalesce(trim(p_justificativa), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'justificativa_obrigatoria');
  end if;

  v_evento := coalesce(nullif(trim(p_tx), ''), 'manual-' || p_cobranca_id::text);
  if exists (select 1 from pagamentos where provider_event_id = v_evento) then
    return jsonb_build_object('ok', true, 'duplicado', true, 'status', c.status);
  end if;
  if c.status in ('paga', 'paga_em_atraso', 'cancelada') then
    return jsonb_build_object('ok', true, 'ja_baixada', true, 'status', c.status);
  end if;

  v_status := case when p_pago_em::date > c.vencimento
                   then 'paga_em_atraso'::cobranca_status
                   else 'paga'::cobranca_status end;

  insert into pagamentos (condominio_id, cobranca_id, valor_pago, pago_em, origem,
                          provider_event_id, provider_tx_id, baixado_por, justificativa)
    values (c.condominio_id, c.id, coalesce(p_valor, c.valor_original), p_pago_em,
            case when p_tx is not null then 'reconciliacao'::pagamento_origem
                 else 'baixa_manual'::pagamento_origem end,
            v_evento, p_tx, public.jwt_usuario(), p_justificativa);

  update cobrancas
     set status = v_status, provider_charge_id = coalesce(p_tx, provider_charge_id)
   where id = c.id;

  if p_informado_id is not null then
    update pagamentos_informados
       set situacao = 'confirmado', atualizado_em = now()
     where id = p_informado_id and cobranca_id = c.id;
  end if;

  -- receita direto no caixa (status 'pago' = badge "Entrada" e soma no saldo)
  select id into v_cat from categorias_financeiras
   where condominio_id = c.condominio_id and nome = 'Taxa condominial'
     and tipo in ('receita', 'ambas') limit 1;
  if v_cat is null then
    insert into categorias_financeiras (condominio_id, nome, tipo)
      values (c.condominio_id, 'Taxa condominial', 'receita')
      returning id into v_cat;
  end if;
  v_forma_rotulo := case p_forma
    when 'transferencia' then 'Transferência'
    when 'verum_pay' then 'Cripto'
    when 'dinheiro' then 'Dinheiro'
    when 'debito_automatico' then 'Débito automático'
    else p_forma::text end;
  -- o caixa recebe o VALOR CONFIRMADO (principal + encargos quando houver);
  -- sem p_valor, cai no valor_original — o comportamento de sempre
  insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                           competencia, forma_pagamento, status, origem_tipo, origem_id)
    values (c.condominio_id, 'receita', v_cat,
            'Cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' paga (' || v_forma_rotulo || ')',
            coalesce(p_valor, c.valor_original), p_pago_em::date, c.competencia,
            p_forma, 'pago', 'cobranca', c.id);

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- B) Baixa Stripe: parâmetro novo p_valor_caixa ------------------------
-- (a versão antiga de 5 parâmetros sai para não haver sobrecarga ambígua)
drop function if exists public.registrar_pagamento_stripe(uuid, numeric, timestamptz, varchar, varchar);

create or replace function public.registrar_pagamento_stripe(
  p_cobranca_id    uuid,
  p_valor_pago     numeric,
  p_pago_em        timestamptz,
  p_payment_intent varchar,
  p_charge         varchar,
  p_valor_caixa    numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        cobrancas%rowtype;
  v_cat    uuid;
  v_status cobranca_status;
begin
  select * into c from cobrancas where id = p_cobranca_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'cobranca_inexistente');
  end if;
  if exists (select 1 from pagamentos where provider_event_id = p_payment_intent) then
    return jsonb_build_object('ok', true, 'duplicado', true, 'status', c.status);
  end if;
  if c.status in ('paga', 'paga_em_atraso', 'cancelada') then
    return jsonb_build_object('ok', true, 'ja_baixada', true, 'status', c.status);
  end if;

  v_status := case when p_pago_em::date > c.vencimento
                   then 'paga_em_atraso'::cobranca_status
                   else 'paga'::cobranca_status end;

  insert into pagamentos (condominio_id, cobranca_id, valor_pago, pago_em, origem,
                          provider_event_id, provider_tx_id)
    values (c.condominio_id, c.id, p_valor_pago, p_pago_em, 'webhook',
            p_payment_intent, p_charge);

  update cobrancas
     set status = v_status, provider_charge_id = coalesce(p_charge, provider_charge_id)
   where id = c.id;

  -- receita direto no caixa (status 'pago' = badge "Entrada" e soma no saldo)
  select id into v_cat from categorias_financeiras
   where condominio_id = c.condominio_id and nome = 'Taxa condominial'
     and tipo in ('receita', 'ambas') limit 1;
  if v_cat is null then
    insert into categorias_financeiras (condominio_id, nome, tipo)
      values (c.condominio_id, 'Taxa condominial', 'receita')
      returning id into v_cat;
  end if;
  -- p_valor_caixa = principal + encargos (sem a taxa de conveniência, que
  -- não é receita do condomínio); ausente → valor_original, como sempre
  insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                           competencia, forma_pagamento, status, origem_tipo, origem_id)
    values (c.condominio_id, 'receita', v_cat,
            'Cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' paga online (Stripe)',
            coalesce(p_valor_caixa, c.valor_original), p_pago_em::date, c.competencia,
            'stripe', 'pago', 'cobranca', c.id);

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

revoke all on function public.registrar_pagamento_stripe(uuid, numeric, timestamptz, varchar, varchar, numeric)
  from public, anon, authenticated;
