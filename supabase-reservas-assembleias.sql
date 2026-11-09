-- ═══════════════════════════════════════════════════════════════
-- RESERVAS E ASSEMBLEIAS — telas para as tabelas que nasceram órfãs.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- As tabelas areas_comuns, reservas, assembleias e atas existem desde o
-- schema (com a guarda GiST anti-sobreposição em reservas). Este arquivo
-- instala só o que as TELAS precisam além delas:
--   · catálogo + padrões: tela.reservas / tela.assembleias / reserva.decidir
--     (síndico e administrador predial), reserva.solicitar (morador);
--   · policy morador_solicita_reserva: o morador INSERE a própria
--     solicitação (status forçado 'solicitada' — confirmar é da gestão).
--     O JWT não carrega a unidade, então a policy não trava a unidade do
--     pedido; quem segura é a aprovação: pedido na unidade errada é
--     recusado pela gestão antes de valer qualquer coisa;
--   · RPC confirmar_reserva(id): transacional — confere reserva.decidir,
--     muda solicitada → confirmada e, se a área tem taxa > 0, GERA a
--     cobrança tipo 'extra' da unidade (competência do mês do uso,
--     vencimento no dia do uso) e grava cobranca_id. O índice único de
--     cobranças só vale para ordinárias — a taxa não colide com a
--     mensalidade. Recusar/cancelar/concluir são UPDATEs comuns da tela;
--   · sino: pedido novo do morador notifica a gestão (reserva.solicitada);
--   · índice de assembleias por data.
--
-- Sem este RUN o app continua inteiro: as telas aparecem para a gestão
-- (a escrita dela já passa pelo coringa dados.escrever), mas confirmar
-- avisa para rodar este arquivo e a solicitação do morador é negada.
--
-- Ordem: passo 13 — depois de TUDO (permissoes, aprovacoes, historico).
-- Este deploy também re-roda DOIS definitivos atualizados:
--   · supabase-historico.sql  (trg_historico agora cobre as 4 tabelas);
--   · supabase-planilha-sync.sql (cobrança 'extra' não vira linha de mora).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A) Catálogo (espelho de PERMISSOES em src/lib/permissoes.js)
-- ─────────────────────────────────────────────────────────────────
insert into public.permissoes (codigo, descricao) values
  ('tela.reservas',     'Ver a tela Reservas'),
  ('tela.assembleias',  'Ver a tela Assembleias'),
  ('reserva.solicitar', 'Solicitar reserva de área comum (morador)'),
  ('reserva.decidir',   'Confirmar ou recusar reservas (gera a cobrança da taxa)')
on conflict (codigo) do update set descricao = excluded.descricao, atualizado_em = now();

-- ─────────────────────────────────────────────────────────────────
-- B) Padrões do SaaS ao vivo (condominio_id nulo) — sem re-rodar os
--    passos 10/11: síndico e administrador ganham as telas + decidir,
--    morador ganha o solicitar. Overrides por condomínio ficam intactos.
-- ─────────────────────────────────────────────────────────────────
insert into public.perfil_permissoes (condominio_id, perfil_id, permissao_id)
select null, pf.id, pm.id
from (values ('sindico','tela.reservas'), ('sindico','tela.assembleias'), ('sindico','reserva.decidir'),
             ('administrador_predial','tela.reservas'), ('administrador_predial','tela.assembleias'),
             ('administrador_predial','reserva.decidir'),
             ('morador','reserva.solicitar')) d(perfil, codigo)
join public.perfis pf     on pf.nome = d.perfil
join public.permissoes pm on pm.codigo = d.codigo
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────
-- C) O morador solicita a própria reserva (molde: morador_abre_chamado)
-- ─────────────────────────────────────────────────────────────────
drop policy if exists morador_solicita_reserva on public.reservas;
create policy morador_solicita_reserva on public.reservas for insert to authenticated
  with check (condominio_id = public.jwt_condominio()
              and public.jwt_pode('reserva.solicitar')
              and status = 'solicitada');

-- ─────────────────────────────────────────────────────────────────
-- D) Confirmar reserva — transacional, com a cobrança da taxa
-- ─────────────────────────────────────────────────────────────────
create or replace function public.confirmar_reserva(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; v_area record; v_resp uuid; v_cobranca uuid;
begin
  if public.jwt_role() <> 'service_role' and not public.jwt_pode('reserva.decidir') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;

  select * into r from public.reservas where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'inexistente');
  end if;
  if public.jwt_role() <> 'service_role'
     and r.condominio_id is distinct from public.jwt_condominio() then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  if r.status <> 'solicitada' then
    return jsonb_build_object('ok', false, 'erro', 'status_invalido');
  end if;

  select * into v_area from public.areas_comuns where id = r.area_id;

  begin
    /* área com taxa: a cobrança nasce junto, 'extra' (fora do índice único
       das ordinárias e fora da planilla de mora — o sync pula 'extra').
       Paga quem responde pela unidade; sem responsável, o solicitante. */
    if coalesce(v_area.taxa, 0) > 0 and r.cobranca_id is null then
      select responsavel_financeiro_id into v_resp from public.unidades where id = r.unidade_id;
      v_resp := coalesce(v_resp, r.solicitante_id);
      insert into public.cobrancas
        (condominio_id, unidade_id, responsavel_id, competencia, tipo, valor_original, vencimento, status)
      values
        (r.condominio_id, r.unidade_id, v_resp, to_char(r.inicio, 'YYYY-MM'), 'extra',
         v_area.taxa, r.inicio::date, 'emitida')
      returning id into v_cobranca;
    end if;

    update public.reservas
       set status = 'confirmada', cobranca_id = coalesce(v_cobranca, cobranca_id)
     where id = p_id;
  exception when others then
    return jsonb_build_object('ok', false, 'erro', 'falha', 'detalhe', left(sqlerrm, 400));
  end;

  return jsonb_build_object('ok', true, 'cobranca_id', v_cobranca,
                            'valor', case when v_cobranca is null then null else v_area.taxa end);
end $$;
revoke all on function public.confirmar_reserva(uuid) from public, anon;
grant execute on function public.confirmar_reserva(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────
-- E) Sino da gestão: pedido novo do morador (cosmético — nunca derruba)
-- ─────────────────────────────────────────────────────────────────
create or replace function public.notificar_reserva_solicitada() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_area varchar(80); v_unidade text;
begin
  if new.status <> 'solicitada' then return new; end if;
  select a.nome into v_area from areas_comuns a where a.id = new.area_id;
  select u.numero || '-' || coalesce(b.nome, '?') into v_unidade
    from unidades u left join blocos b on b.id = u.bloco_id where u.id = new.unidade_id;
  perform public.notificar_gestao(
    new.condominio_id, 'reserva.solicitada',
    left('Reserva solicitada: ' || coalesce(v_area, 'área') || ' · ' || coalesce(v_unidade, ''), 200),
    jsonb_build_object('area', v_area, 'unidade', v_unidade,
                       'inicio', new.inicio, 'fim', new.fim),
    'reserva', new.id);
  return new;
exception when others then
  return new;  -- notificação é cosmética: NUNCA derruba a solicitação
end $$;
revoke all on function public.notificar_reserva_solicitada() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.notificacoes') is null then
    raise notice '[reservas] notificacoes não existe (rode o supabase-notificacoes.sql) — sino sem o evento.';
  else
    drop trigger if exists trg_notificar_reservas on public.reservas;
    create trigger trg_notificar_reservas
      after insert on public.reservas
      for each row execute function public.notificar_reserva_solicitada();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- F) Índice que faltava: a tela lista assembleias por data
-- ─────────────────────────────────────────────────────────────────
create index if not exists idx_assembleias_data on public.assembleias (condominio_id, data_hora desc);

-- ═══════════════════════════════════════════════════════════════
-- Verificação rápida (opcional):
--   select count(*) from public.permissoes
--    where codigo in ('tela.reservas','tela.assembleias','reserva.solicitar','reserva.decidir'); -- 4
--   select polname from pg_policy where polname = 'morador_solicita_reserva';                    -- 1
--   select proname from pg_proc  where proname = 'confirmar_reserva';                            -- 1
--   select tgname  from pg_trigger where tgname = 'trg_notificar_reservas';                      -- 1
-- ═══════════════════════════════════════════════════════════════
