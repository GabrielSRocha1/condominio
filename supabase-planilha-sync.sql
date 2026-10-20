-- ═══════════════════════════════════════════════════════════════
-- SINCRONIZAÇÃO HISTÓRICO (PLANILHA) ⇄ COBRANÇAS
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
-- Requer o supabase-planilhas.sql (aborta com aviso se faltar).
--
-- Este arquivo MUDA o contrato da planilha: ela deixa de ser só leitura
-- e passa a REFLETIR as cobranças do app, nos dois sentidos:
--   B) pagamento registrado (qualquer caminho: baixa manual, lote,
--      Stripe, cripto — todos passam por INSERT em pagamentos) →
--      carimba a linha do histórico (pago_em, valor_pago) e preenche a
--      célula de papel "pago"; o app passa a exibir a linha ZERADA nas
--      colunas de dinheiro ("não deve nada" — %/contagens/texto ficam);
--   C) RPC cancelar_cobranca → baixa de cobrança INDEVIDA pelo
--      histórico: status 'cancelada' (nunca DELETE — o índice único
--      uq_cobranca_ordinaria ignora canceladas, então a mesma
--      unidade+competência pode ser emitida de novo), carimbo
--      cancelada_em na linha (o app exibe os valores zerados) e evento
--      'cobranca_cancelada' na auditoria;
--   D) cobrança nova (INSERT em cobrancas) → cria/religa a linha do
--      histórico; sem planilha no condomínio, nasce a planilha padrão
--      (unidade, competência, valor, vencimento, pago).
--
-- O que NÃO muda: a planilha continua sem lançar NADA no caixa (o
-- saldo do dashboard segue refletindo só o que o app recebeu), e os
-- dados importados (jsonb `dados`) nunca são destruídos — os carimbos
-- vivem em colunas próprias (pago_em, valor_pago, cancelada_em).
--
-- Limitações aceitas (documentadas):
--   · a célula do mês (unidade+competência) pertence à cobrança
--     ORDINÁRIA; extra/multa/chamada só criam linha se a célula estiver
--     livre (on conflict do nothing) — senão seguem visíveis apenas na
--     lista "só no sistema" da conciliação;
--   · a re-emissão após um cancelamento REUSA a linha indevida (novo
--     cobranca_id, carimbos limpos, valor/vencimento atualizados) — a
--     trilha do cancelamento permanece em cobrancas + auditoria;
--   · os triggers ENGOLEM qualquer erro: uma falha de sincronização
--     jamais derruba uma baixa, o webhook da Stripe ou a emissão.
--
-- Sem este RUN o app continua inteiro com o comportamento antigo; o
-- botão "Baixa indevida" mostra o aviso para rodar este arquivo.
-- ═══════════════════════════════════════════════════════════════

-- Pré-requisito ----------------------------------------------------
do $$ begin
  if to_regclass('public.planilha_cobranca_linhas') is null then
    raise exception 'Rode o supabase-planilhas.sql antes deste arquivo.';
  end if;
end $$;

-- A) Carimbos de sincronização (fora do jsonb: o import nunca os toca)
alter table planilha_cobranca_linhas add column if not exists pago_em      date;
alter table planilha_cobranca_linhas add column if not exists valor_pago   numeric(14,2);
alter table planilha_cobranca_linhas add column if not exists cancelada_em date;
create index if not exists idx_planilha_linhas_cobranca
  on planilha_cobranca_linhas (cobranca_id);

-- A FK do vínculo passa a ON DELETE SET NULL: o app nunca deleta cobrança
-- (cancelamento é status), mas as sondas de teste deletam na limpeza — e,
-- com o trigger abaixo ligando linha→cobrança, a FK NO ACTION bloquearia
-- qualquer limpeza. A linha do histórico sobrevive com o vínculo nulo.
alter table planilha_cobranca_linhas
  drop constraint if exists planilha_cobranca_linhas_cobranca_id_fkey;
alter table planilha_cobranca_linhas
  add constraint planilha_cobranca_linhas_cobranca_id_fkey
  foreign key (cobranca_id) references cobrancas(id) on delete set null;

-- B) Pagamento → carimba a linha do histórico ----------------------
-- Mesmo funil dos triggers do sino e da auditoria: todo recebimento é
-- um INSERT em pagamentos. Além dos carimbos, preenche a célula cujo
-- papel é "pago" (data → ISO; número → valor pago; texto → "pago").
create or replace function public.sincronizar_pagamento_planilha() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_unidade     uuid;
  v_competencia char(7);
  v_planilha    uuid;
  v_chave       text;
  v_tipo        text;
  v_celula      jsonb := '{}'::jsonb;
  v_n           integer := 0;
begin
  select c.unidade_id, c.competencia into v_unidade, v_competencia
    from cobrancas c where c.id = new.cobranca_id;
  select p.id, x.chave, x.tipo into v_planilha, v_chave, v_tipo
    from planilhas_cobranca p
    left join lateral (
      select chave, tipo
        from jsonb_to_recordset(p.colunas) as col(chave text, tipo text, papel text)
       where col.papel = 'pago' limit 1) x on true
   where p.condominio_id = new.condominio_id;
  if v_planilha is null then return new; end if;  -- condomínio sem histórico

  if v_chave is not null then
    v_celula := jsonb_build_object(v_chave, case
      when v_tipo = 'data'   then to_jsonb(to_char(new.pago_em, 'YYYY-MM-DD'))
      when v_tipo = 'numero' then to_jsonb(new.valor_pago)
      else to_jsonb('pago'::text) end);
  end if;

  update planilha_cobranca_linhas
     set pago_em = new.pago_em::date, valor_pago = new.valor_pago,
         cancelada_em = null, dados = dados || v_celula, atualizado_em = now()
   where cobranca_id = new.cobranca_id;
  get diagnostics v_n = row_count;

  -- linha de import ainda sem vínculo: casa pela chave e liga
  if v_n = 0 and v_unidade is not null and v_competencia is not null then
    update planilha_cobranca_linhas
       set cobranca_id = new.cobranca_id, pago_em = new.pago_em::date,
           valor_pago = new.valor_pago, cancelada_em = null,
           dados = dados || v_celula, atualizado_em = now()
     where planilha_id = v_planilha and unidade_id = v_unidade
       and competencia = v_competencia and cobranca_id is null
       and cancelada_em is null;
  end if;
  return new;
exception when others then
  return new;  -- sincronização é cosmética: NUNCA derruba a baixa
end $$;
drop trigger if exists trg_planilha_sync_pagamento on pagamentos;
create trigger trg_planilha_sync_pagamento
  after insert on pagamentos
  for each row execute function public.sincronizar_pagamento_planilha();

-- C) Baixa de cobrança INDEVIDA (cancelamento auditado) -------------
-- Guardas no padrão de registrar_pagamento_manual. Recusa paga (não
-- existe estorno) e informe pendente (rejeite o informe antes).
create or replace function public.cancelar_cobranca(
  p_cobranca_id   uuid,
  p_justificativa text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c   cobrancas%rowtype;
  v_n integer := 0;
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

  if c.status = 'cancelada' then
    return jsonb_build_object('ok', true, 'ja_cancelada', true);
  end if;
  if c.status in ('paga', 'paga_em_atraso') then
    return jsonb_build_object('ok', false, 'erro', 'ja_paga');
  end if;
  if c.status in ('pagamento_informado', 'pagamento_divergente') then
    return jsonb_build_object('ok', false, 'erro', 'informe_pendente');
  end if;

  update cobrancas set status = 'cancelada', atualizado_em = now() where id = c.id;

  -- carimbo nas linhas vinculadas (dados do import ficam intactos)
  update planilha_cobranca_linhas
     set cancelada_em = current_date, atualizado_em = now()
   where cobranca_id = c.id;
  get diagnostics v_n = row_count;

  if to_regclass('public.auditoria_eventos') is not null then
    insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
      values ('cobranca_cancelada', 'aviso', public.jwt_usuario(), c.condominio_id,
              jsonb_build_object('cobranca_id', c.id, 'unidade_id', c.unidade_id,
                                 'competencia', c.competencia, 'valor', c.valor_original,
                                 'justificativa', p_justificativa, 'linhas_marcadas', v_n));
  end if;

  return jsonb_build_object('ok', true, 'status', 'cancelada', 'linhas_marcadas', v_n);
end $$;
revoke all on function public.cancelar_cobranca(uuid, text) from public, anon;
grant execute on function public.cancelar_cobranca(uuid, text) to authenticated, service_role;

-- D) Cobrança nova → linha no histórico ----------------------------
-- Cria a planilha padrão quando o condomínio não tem; monta a linha
-- pelos PAPÉIS das colunas existentes (funciona na padrão e na
-- importada); a ordinária é dona da célula do mês (upsert religa a
-- linha de import e REATIVA a linha indevida); os demais tipos só
-- entram se a célula estiver livre.
create or replace function public.sincronizar_cobranca_planilha() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pl    planilhas_cobranca%rowtype;
  v_label text;
  v_col   record;
  v_dados jsonb := '{}'::jsonb;
  v_vals  jsonb := '{}'::jsonb;
  v_par   jsonb;
  v_ordem integer;
begin
  select * into v_pl from planilhas_cobranca where condominio_id = new.condominio_id;
  if not found then
    begin
      insert into planilhas_cobranca (condominio_id, nome, colunas)
        values (new.condominio_id, 'Histórico de cobranças', '[
          {"chave":"unidade","titulo":"Unidade","tipo":"texto","papel":"unidade","ordem":0},
          {"chave":"competencia","titulo":"Competência","tipo":"texto","papel":"competencia","ordem":1},
          {"chave":"valor","titulo":"Valor","tipo":"numero","papel":"valor","ordem":2,"formato":"moeda"},
          {"chave":"vencimento","titulo":"Vencimento","tipo":"data","papel":"vencimento","ordem":3},
          {"chave":"pago","titulo":"Pago","tipo":"numero","papel":"pago","ordem":4,"formato":"moeda"}
        ]'::jsonb)
        returning * into v_pl;
    exception when unique_violation then  -- corrida entre duas emissões
      select * into v_pl from planilhas_cobranca where condominio_id = new.condominio_id;
    end;
  end if;

  select u.numero || coalesce('-' || b.nome, '') into v_label
    from unidades u left join blocos b on b.id = u.bloco_id
   where u.id = new.unidade_id;

  for v_col in
    select chave, papel from jsonb_to_recordset(v_pl.colunas) as x(chave text, papel text)
  loop
    v_par := case v_col.papel
      when 'unidade'     then jsonb_build_object(v_col.chave, v_label)
      when 'competencia' then jsonb_build_object(v_col.chave, new.competencia)
      when 'valor'       then jsonb_build_object(v_col.chave, new.valor_original)
      when 'vencimento'  then jsonb_build_object(v_col.chave, to_char(new.vencimento, 'YYYY-MM-DD'))
      else '{}'::jsonb end;
    v_dados := v_dados || v_par;
    if v_col.papel in ('valor', 'vencimento') then v_vals := v_vals || v_par; end if;
  end loop;

  select coalesce(max(ordem), 0) + 1 into v_ordem
    from planilha_cobranca_linhas where planilha_id = v_pl.id;

  if new.tipo = 'ordinaria' then
    insert into planilha_cobranca_linhas
        (condominio_id, planilha_id, dados, unidade_id, competencia, cobranca_id, origem, ordem)
      values (new.condominio_id, v_pl.id, v_dados, new.unidade_id, new.competencia,
              new.id, 'planilha', v_ordem)
      on conflict (planilha_id, unidade_id, competencia) do update set
        cobranca_id   = excluded.cobranca_id,
        -- linha INDEVIDA re-emitida: reativa e atualiza valor/vencimento;
        -- linha viva de import: dados e carimbos ficam intactos
        dados         = case when planilha_cobranca_linhas.cancelada_em is not null
                             then planilha_cobranca_linhas.dados || v_vals
                             else planilha_cobranca_linhas.dados end,
        pago_em       = case when planilha_cobranca_linhas.cancelada_em is not null
                             then null else planilha_cobranca_linhas.pago_em end,
        valor_pago    = case when planilha_cobranca_linhas.cancelada_em is not null
                             then null else planilha_cobranca_linhas.valor_pago end,
        cancelada_em  = null,
        atualizado_em = now();
  else
    insert into planilha_cobranca_linhas
        (condominio_id, planilha_id, dados, unidade_id, competencia, cobranca_id, origem, ordem)
      values (new.condominio_id, v_pl.id, v_dados, new.unidade_id, new.competencia,
              new.id, 'planilha', v_ordem)
      on conflict (planilha_id, unidade_id, competencia) do nothing;
  end if;
  return new;
exception when others then
  return new;  -- sincronização é cosmética: NUNCA derruba a emissão
end $$;
drop trigger if exists trg_planilha_sync_cobranca on cobrancas;
create trigger trg_planilha_sync_cobranca
  after insert on cobrancas
  for each row execute function public.sincronizar_cobranca_planilha();

-- Verificação rápida (opcional):
--   select proname from pg_proc where proname = 'cancelar_cobranca';            -- 1 linha
--   select tgname from pg_trigger where tgname like 'trg_planilha_sync%';       -- 2 linhas
--   select count(*) filter (where pago_em is not null)      as pagas,
--          count(*) filter (where cancelada_em is not null) as indevidas
--     from planilha_cobranca_linhas;
-- ═══════════════════════════════════════════════════════════════
