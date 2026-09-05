-- ═══════════════════════════════════════════════════════════════
-- CONCILIAÇÃO DE PAGAMENTOS MANUAIS (transferência / cripto / dinheiro)
-- Rode no SQL Editor do Supabase. DOIS blocos: RUN 1 (enum) precisa ser
-- executado e COMMITADO antes do RUN 2 (Postgres não deixa usar um valor
-- de enum criado na mesma transação).
--
-- Fluxo que este arquivo habilita:
--   morador informa transferência (comprovante) ou cripto (hash on-chain)
--     → cobranca.status = 'pagamento_informado' (valor confere)
--                        | 'pagamento_divergente' (valor difere/duplicado)
--   gestor confirma (ou a verificação on-chain aprova sozinha)
--     → registrar_pagamento_manual(): pagamentos + status paga/paga_em_atraso
--       + lancamento receita 'pago' ("Entrada" no caixa) — atômico e
--       idempotente, espelhando registrar_pagamento_stripe().
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────── RUN 1 ───────────────────────────
alter type cobranca_status add value if not exists 'pagamento_informado';

-- ─────────────────────────── RUN 2 ───────────────────────────

-- A) Trilha dos informes do morador (escrita SÓ pelo backend/service role;
--    leitura pelo tenant — gestor vê o que confirmar, morador acompanha)
create table if not exists pagamentos_informados (
  id                uuid primary key default gen_random_uuid(),
  condominio_id     uuid not null references condominios(id),
  cobranca_id       uuid not null references cobrancas(id),
  forma             forma_pagamento not null,          -- transferencia | verum_pay
  valor_informado   numeric(14,2) not null,
  pago_em_informado date,
  documento_id      uuid references documentos(id),    -- comprovante (transferência)
  tx_hash           varchar(120),                      -- cripto
  chain             varchar(20),                       -- ethereum | bnb | polygon | solana
  situacao          varchar(12) not null default 'pendente'
                    check (situacao in ('pendente','confirmado','rejeitado')),
  motivo_rejeicao   text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists idx_pag_informados_cobranca on pagamentos_informados (cobranca_id);
create index if not exists idx_pag_informados_pendentes on pagamentos_informados (condominio_id) where situacao = 'pendente';

alter table pagamentos_informados enable row level security;
drop policy if exists tenant_select on pagamentos_informados;
create policy tenant_select on pagamentos_informados for select to authenticated
  using (condominio_id = public.jwt_condominio());
-- sem policy de escrita: só a service role dos endpoints /api grava aqui

-- B) usuário logado (claim sub do JWT caseiro) — para baixado_por auditável
create or replace function public.jwt_usuario() returns uuid
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''), '')::uuid
$$;

create or replace function public.jwt_role() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '')
$$;

-- C) Baixa manual/reconciliada — transacional e idempotente.
--    Chamável: pelo client autenticado (gestor: diretor/síndico/tesouraria do
--    condomínio — validado AQUI dentro, não por RLS) e pelos endpoints /api
--    (service role, ex.: auto-baixa da verificação on-chain).
--    Idempotência: provider_event_id único = p_tx (hash on-chain) ou
--    'manual-<cobranca_id>' — duplo clique não duplica pagamento nem caixa.
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
  insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                           competencia, forma_pagamento, status, origem_tipo, origem_id)
    values (c.condominio_id, 'receita', v_cat,
            'Cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' paga (' || v_forma_rotulo || ')',
            c.valor_original, p_pago_em::date, c.competencia,
            p_forma, 'pago', 'cobranca', c.id);

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

revoke all on function public.registrar_pagamento_manual(uuid, forma_pagamento, numeric, timestamptz, text, varchar, uuid)
  from public, anon;
grant execute on function public.registrar_pagamento_manual(uuid, forma_pagamento, numeric, timestamptz, text, varchar, uuid)
  to authenticated;

-- D) Rejeição de um informe: cobrança volta ao estado aberto correto
create or replace function public.rejeitar_pagamento_informado(
  p_informado_id uuid,
  p_motivo       text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i pagamentos_informados%rowtype;
  c cobrancas%rowtype;
begin
  select * into i from pagamentos_informados where id = p_informado_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'informe_inexistente');
  end if;
  select * into c from cobrancas where id = i.cobranca_id for update;

  if public.jwt_role() <> 'service_role' then
    if public.jwt_perfil() not in ('diretor','sindico','tesouraria')
       or public.jwt_condominio() is distinct from i.condominio_id then
      return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
    end if;
  end if;
  if i.situacao <> 'pendente' then
    return jsonb_build_object('ok', true, 'ja_decidido', true, 'situacao', i.situacao);
  end if;

  update pagamentos_informados
     set situacao = 'rejeitado', motivo_rejeicao = coalesce(p_motivo, ''), atualizado_em = now()
   where id = p_informado_id;

  -- só reabre se a cobrança ainda está na fase de conferência
  if c.status in ('pagamento_informado', 'pagamento_divergente') then
    update cobrancas
       set status = case when c.vencimento < current_date
                         then 'vencida'::cobranca_status
                         else 'emitida'::cobranca_status end
     where id = c.id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.rejeitar_pagamento_informado(uuid, text) from public, anon;
grant execute on function public.rejeitar_pagamento_informado(uuid, text) to authenticated;
