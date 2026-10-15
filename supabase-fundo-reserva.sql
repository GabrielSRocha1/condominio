-- ═══════════════════════════════════════════════════════════════
-- FUNDO DE RESERVA NO CAIXA
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que este arquivo corrige: as cobranças nascem com o fundo de reserva
-- EMBUTIDO (valor × (1 + FR%) — regras_internas.cobranca.fundo_reserva_pct,
-- o MONTO da planilla), mas a baixa lançava o pagamento inteiro como
-- "Taxa condominial": a parcela do fundo nunca chegava ao card Fundo de
-- reserva do Financeiro. Agora as duas funções de baixa DIVIDEM o
-- lançamento quando o % está configurado:
--   · Taxa condominial  = pago − parcela do fundo
--   · Fundo de reserva  = principal_pago × FR% ÷ (100 + FR%)
--     (principal_pago = min(pago, valor_original): multa e juros de mora
--      não alimentam o fundo — encargos são receita ordinária)
-- O saldo do caixa não muda (as duas linhas somam o mesmo pago); o card
-- do fundo passa a somar os lançamentos PAGOS da categoria.
--
-- O bloco C faz o BACKFILL: divide retroativamente os lançamentos das
-- cobranças JÁ PAGAS (uma vez só — quem já tem a linha do fundo é pulado,
-- então re-rodar o arquivo não duplica nada).
--
-- Sem este RUN o app continua funcionando (degrada aberto): a baixa segue
-- lançando tudo como Taxa condominial e o card do fundo soma apenas os
-- lançamentos manuais da categoria "Fundo de reserva".
-- ═══════════════════════════════════════════════════════════════

-- A) Baixa manual/reconciliada: divide a parcela do fundo ---------------
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
  v_cat_fr uuid;
  v_status cobranca_status;
  v_evento varchar(80);
  v_forma_rotulo text;
  v_caixa  numeric;
  v_fr_pct numeric := 0;
  v_fr     numeric := 0;
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

  -- parcela do fundo de reserva embutido (FR% nas regras do condomínio);
  -- lixo no jsonb ou % ausente → 0 (degrada aberto, sem travar a baixa)
  v_caixa := coalesce(p_valor, c.valor_original);
  begin
    select coalesce(nullif(trim(co.regras_internas#>>'{cobranca,fundo_reserva_pct}'), '')::numeric, 0)
      into v_fr_pct from condominios co where co.id = c.condominio_id;
  exception when others then v_fr_pct := 0;
  end;
  if v_fr_pct > 0 then
    v_fr := round(least(v_caixa, c.valor_original) * v_fr_pct / (100 + v_fr_pct), 2);
  end if;
  if v_fr <= 0 or v_fr >= v_caixa then v_fr := 0; end if;

  -- o caixa recebe o VALOR CONFIRMADO (principal + encargos quando houver),
  -- dividido entre a taxa e o fundo quando o FR% está configurado
  insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                           competencia, forma_pagamento, status, origem_tipo, origem_id)
    values (c.condominio_id, 'receita', v_cat,
            'Cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' paga (' || v_forma_rotulo || ')',
            v_caixa - v_fr, p_pago_em::date, c.competencia,
            p_forma, 'pago', 'cobranca', c.id);

  if v_fr > 0 then
    select id into v_cat_fr from categorias_financeiras
     where condominio_id = c.condominio_id and nome = 'Fundo de reserva'
       and tipo in ('receita', 'ambas') limit 1;
    if v_cat_fr is null then
      insert into categorias_financeiras (condominio_id, nome, tipo)
        values (c.condominio_id, 'Fundo de reserva', 'receita')
        returning id into v_cat_fr;
    end if;
    insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                             competencia, forma_pagamento, status, origem_tipo, origem_id)
      values (c.condominio_id, 'receita', v_cat_fr,
              'Fundo de reserva — cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' (' || v_forma_rotulo || ')',
              v_fr, p_pago_em::date, c.competencia,
              p_forma, 'pago', 'cobranca', c.id);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- B) Baixa Stripe: a mesma divisão sobre o valor que vai ao caixa -------
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
  v_cat_fr uuid;
  v_status cobranca_status;
  v_caixa  numeric;
  v_fr_pct numeric := 0;
  v_fr     numeric := 0;
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
  v_caixa := coalesce(p_valor_caixa, c.valor_original);
  begin
    select coalesce(nullif(trim(co.regras_internas#>>'{cobranca,fundo_reserva_pct}'), '')::numeric, 0)
      into v_fr_pct from condominios co where co.id = c.condominio_id;
  exception when others then v_fr_pct := 0;
  end;
  if v_fr_pct > 0 then
    v_fr := round(least(v_caixa, c.valor_original) * v_fr_pct / (100 + v_fr_pct), 2);
  end if;
  if v_fr <= 0 or v_fr >= v_caixa then v_fr := 0; end if;

  insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                           competencia, forma_pagamento, status, origem_tipo, origem_id)
    values (c.condominio_id, 'receita', v_cat,
            'Cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' paga online (Stripe)',
            v_caixa - v_fr, p_pago_em::date, c.competencia,
            'stripe', 'pago', 'cobranca', c.id);

  if v_fr > 0 then
    select id into v_cat_fr from categorias_financeiras
     where condominio_id = c.condominio_id and nome = 'Fundo de reserva'
       and tipo in ('receita', 'ambas') limit 1;
    if v_cat_fr is null then
      insert into categorias_financeiras (condominio_id, nome, tipo)
        values (c.condominio_id, 'Fundo de reserva', 'receita')
        returning id into v_cat_fr;
    end if;
    insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                             competencia, forma_pagamento, status, origem_tipo, origem_id)
      values (c.condominio_id, 'receita', v_cat_fr,
              'Fundo de reserva — cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' (Stripe)',
              v_fr, p_pago_em::date, c.competencia,
              'stripe', 'pago', 'cobranca', c.id);
  end if;

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

revoke all on function public.registrar_pagamento_stripe(uuid, numeric, timestamptz, varchar, varchar, numeric)
  from public, anon, authenticated;

-- C) BACKFILL: divide as cobranças JÁ PAGAS (uma vez; re-rodar não duplica)
do $$
declare
  r       record;
  v_pct   numeric;
  v_share numeric;
  v_cat   uuid;
begin
  for r in
    select l.id, l.condominio_id, l.valor, l.data, l.competencia, l.forma_pagamento, l.origem_id,
           co.regras_internas#>>'{cobranca,fundo_reserva_pct}' as pct_txt,
           cb.valor_original
      from lancamentos l
      join condominios co on co.id = l.condominio_id
      join cobrancas   cb on cb.id = l.origem_id
     where l.tipo = 'receita' and l.origem_tipo = 'cobranca' and l.status = 'pago'
       and not exists (                 -- já dividido (ou é a própria linha do fundo)
         select 1 from lancamentos f
           join categorias_financeiras cf on cf.id = f.categoria_id
          where f.origem_tipo = 'cobranca' and f.origem_id = l.origem_id
            and lower(cf.nome) like '%reserva%')
  loop
    begin
      v_pct := coalesce(nullif(trim(r.pct_txt), '')::numeric, 0);
    exception when others then v_pct := 0;
    end;
    if v_pct <= 0 then continue; end if;
    v_share := round(least(r.valor, r.valor_original) * v_pct / (100 + v_pct), 2);
    if v_share <= 0 or v_share >= r.valor then continue; end if;

    select id into v_cat from categorias_financeiras
     where condominio_id = r.condominio_id and nome = 'Fundo de reserva'
       and tipo in ('receita', 'ambas') limit 1;
    if v_cat is null then
      insert into categorias_financeiras (condominio_id, nome, tipo)
        values (r.condominio_id, 'Fundo de reserva', 'receita')
        returning id into v_cat;
    end if;

    update lancamentos set valor = valor - v_share, atualizado_em = now() where id = r.id;
    insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                             competencia, forma_pagamento, status, origem_tipo, origem_id)
      values (r.condominio_id, 'receita', v_cat,
              'Fundo de reserva — cobrança ' || substr(r.competencia, 6, 2) || '/' || substr(r.competencia, 1, 4),
              v_share, r.data, r.competencia, r.forma_pagamento, 'pago', 'cobranca', r.origem_id);
  end loop;
end $$;
