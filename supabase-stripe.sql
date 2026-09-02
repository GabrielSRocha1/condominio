-- ═══════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO STRIPE — licença SaaS (Billing) + cobranças condominiais (Connect)
--
-- ⚠️ EXECUTE EM DUAS ETAPAS no SQL Editor do Supabase:
--   1) Rode SOMENTE o bloco "RUN 1" e aguarde concluir.
--   2) Depois rode o restante do arquivo ("RUN 2").
-- Um valor novo de enum não pode ser usado na mesma transação em que foi
-- criado, e o SQL Editor executa cada rodada em uma transação única.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────── RUN 1 ───────────────────────────────
alter type provedor_pagamento   add value if not exists 'stripe';
alter type forma_pagamento      add value if not exists 'stripe';
alter type assinatura_pagamento add value if not exists 'stripe';

-- ─────────────────────────────── RUN 2 ───────────────────────────────

-- A) Billing: IDs do gateway na assinatura (o Commet não persistia nenhum id;
--    a Stripe amarra por customer/subscription — os dois ficam gravados aqui)
alter table saas_assinaturas
  add column if not exists stripe_customer_id     varchar(60),
  add column if not exists stripe_subscription_id varchar(60);
create index if not exists idx_saas_ass_stripe_customer on saas_assinaturas (stripe_customer_id);

-- B) Connect: reuso da tabela integracoes_pagamento (1 linha por provedor).
--    webhook_secret/conta_recebedora eram not null no desenho antigo (Verum
--    Pay) e não se aplicam à Stripe — o webhook é global, não por tenant.
alter table integracoes_pagamento
  alter column webhook_secret drop not null,
  alter column conta_recebedora drop not null;
create unique index if not exists uq_integracao_provedor
  on integracoes_pagamento (condominio_id, provedor);

-- C) SEGURANÇA — lockdown de escrita client-side:
--    · integracoes_pagamento guarda o account id que RECEBE os pagamentos:
--      sem policy nenhuma, só a service role (endpoints /api) lê e grava.
--    · saas_assinaturas: o diretor não pode se auto-ativar via supabase-js;
--      a leitura (tenant_select) permanece — o front lê status/plano.
drop policy if exists tenant_select  on integracoes_pagamento;
drop policy if exists tenant_escrita on integracoes_pagamento;
drop policy if exists tenant_escrita on saas_assinaturas;

-- D) Lançamentos criados pelo webhook não têm usuário logado
alter table lancamentos alter column lancado_por drop not null;

-- E) Baixa transacional e idempotente de cobrança paga via Stripe.
--    Chamada pelo webhook Connect E pelo endpoint de verificação (polling) —
--    a deduplicação por provider_event_id (= payment_intent id) garante que
--    os dois caminhos nunca registrem o mesmo pagamento duas vezes.
create or replace function public.registrar_pagamento_stripe(
  p_cobranca_id    uuid,
  p_valor_pago     numeric,
  p_pago_em        timestamptz,
  p_payment_intent varchar,
  p_charge         varchar
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
  insert into lancamentos (condominio_id, tipo, categoria_id, descricao, valor, data,
                           competencia, forma_pagamento, status, origem_tipo, origem_id)
    values (c.condominio_id, 'receita', v_cat,
            'Cobrança ' || substr(c.competencia, 6, 2) || '/' || substr(c.competencia, 1, 4) || ' paga online (Stripe)',
            c.valor_original, p_pago_em::date, c.competencia,
            'stripe', 'pago', 'cobranca', c.id);

  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

revoke all on function public.registrar_pagamento_stripe(uuid, numeric, timestamptz, varchar, varchar)
  from public, anon, authenticated;

-- F) Preços da licença em BRL (a conta da plataforma é Stripe Brasil).
--    ⚠️ DEFINA OS VALORES antes de rodar — placeholders abaixo comentados.
--    Depois de rodar, execute scripts/preparar-stripe-producao.mjs para
--    criar os products/prices correspondentes na Stripe.
 update saas_planos set preco_mensal = 299.90,  preco_anual = 2999.00,  limite_unidades = 150  where nome = 'Essencial';
 update saas_planos set preco_mensal = 699.90,  preco_anual = 6999.00,  limite_unidades = 500  where nome = 'Standard';
 update saas_planos set preco_mensal = 1999.90, preco_anual = 19999.00, limite_unidades = 2000 where nome = 'Premium';
