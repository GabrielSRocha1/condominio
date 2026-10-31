-- ═══════════════════════════════════════════════════════════════
-- ADMINISTRADOR PREDIAL — tudo que ele faz passa pelo diretor
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- Perfil novo `administrador_predial` (rótulo "Administrador"): enxerga e
-- opera como o diretor, mas NENHUMA escrita dele vale direto. Cada
-- INSERT/UPDATE/DELETE é DESVIADO para `alteracoes_pendentes` e a operação
-- original é cancelada — a linha não existe até o diretor aprovar. Na
-- aprovação o diretor pode CORRIGIR o conteúdo antes de aplicar.
--
-- Por que no banco e não na tela: ~29 pontos de escrita do app saem direto
-- do navegador com o JWT do usuário. Checar na interface seria teatro — o
-- administrador abriria o console e escreveria igual, porque o RLS libera
-- (o perfil dele TEM a permissão). O gatilho é o único lugar onde a regra
-- não tem como ser contornada.
--
-- FORA da fila, de propósito:
--   · `acessos_portaria` e `pre_autorizacoes` — o visitante está no portão
--     agora; travar isso esperando o diretor para a portaria;
--   · o que não passa por escrita direta (RPC SECURITY DEFINER ou endpoint
--     com service role): baixa de pagamento, cancelar cobrança, criar
--     acessos, licença. Esses o administrador simplesmente NÃO recebe —
--     deixá-los liberados sem poder enfileirar faria a promessa "tudo é
--     aprovado" ser falsa. Criar acesso é o caso mais grave: com ele o
--     administrador criaria um síndico e entraria por fora da fila.
--
-- Depende de supabase-permissoes.sql (usa jwt_pode/jwt_perfil). Rode DEPOIS
-- dele. Sem este arquivo nada muda: o perfil não existe e o app segue igual.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A) Perfil e permissões
-- ─────────────────────────────────────────────────────────────────
insert into public.perfis (nome, descricao, sistema) values
  ('administrador_predial', 'Opera como o diretor; toda alteração espera aprovação dele', true)
on conflict (nome) do update set descricao = excluded.descricao, atualizado_em = now();

insert into public.permissoes (codigo, descricao) values
  ('alteracao.aprovar', 'Aprovar, corrigir ou rejeitar alterações pendentes')
on conflict (codigo) do update set descricao = excluded.descricao, atualizado_em = now();

/* conjunto do administrador = todas as telas + as escritas que a fila
   consegue cobrir. Fora: financeiro.baixar, cobranca.cancelar,
   acesso.gerir, licenca.gerir (não passam por escrita direta) e
   alteracao.aprovar (ninguém aprova a si mesmo). */
create or replace view public._padrao_administrador as
select c as codigo from unnest(array[
  'tela.dashboard','tela.condominio','tela.unidades','tela.pessoas','tela.financeiro',
  'tela.cobrancas','tela.multas','tela.comunicados','tela.documentos','tela.chamados',
  'tela.portaria','tela.acessos',
  'condominio.editar','unidade.criar','financeiro.lancar','financeiro.aprovar',
  'cobranca.emitir','multa.registrar','multa.aprovar','comunicado.publicar',
  'documento.emitir','chamado.abrir','dados.escrever']) c;
revoke all on public._padrao_administrador from anon, authenticated;

insert into public.perfil_permissoes (condominio_id, perfil_id, permissao_id)
select null, pf.id, pm.id
from public._padrao_administrador d
join public.perfis pf     on pf.nome = 'administrador_predial'
join public.permissoes pm on pm.codigo = d.codigo
on conflict do nothing;

delete from public.perfil_permissoes pp
using public.perfis pf, public.permissoes pm
where pp.condominio_id is null and pf.id = pp.perfil_id and pm.id = pp.permissao_id
  and pf.nome = 'administrador_predial'
  and not exists (select 1 from public._padrao_administrador d where d.codigo = pm.codigo);

/* aprovar é do diretor: jwt_pode já devolve tudo para ele, então basta não
   dar a ninguém mais. Fica registrado aqui para a tela listar o código. */

-- ─────────────────────────────────────────────────────────────────
-- B) A fila
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.alteracoes_pendentes (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references public.condominios(id) on delete cascade,
  tabela         varchar(63) not null,
  operacao       varchar(6)  not null check (operacao in ('INSERT','UPDATE','DELETE')),
  alvo_id        uuid,                       -- linha afetada (UPDATE/DELETE)
  payload        jsonb not null,             -- linha proposta (NEW) ou a que sairia (OLD)
  anterior       jsonb,                      -- OLD, para o diff na tela
  resumo         varchar(200),               -- texto curto para a lista
  solicitado_por uuid references public.usuarios(id),
  solicitado_em  timestamptz not null default now(),
  status         varchar(10) not null default 'pendente'
                 check (status in ('pendente','aprovada','rejeitada')),
  decidido_por   uuid references public.usuarios(id),
  decidido_em    timestamptz,
  parecer        varchar(400),
  aplicado       jsonb,                      -- o que o diretor REALMENTE aplicou
  erro           varchar(400)                -- falha ao aplicar (fica pendente)
);
create index if not exists alteracoes_pendentes_fila
  on public.alteracoes_pendentes (condominio_id, status, solicitado_em desc);

alter table public.alteracoes_pendentes enable row level security;
drop policy if exists alteracoes_leitura on public.alteracoes_pendentes;
/* qualquer perfil de gestão do condomínio LÊ a fila (o administrador
   precisa ver o que mandou); escrita, só pelas RPCs abaixo */
create policy alteracoes_leitura on public.alteracoes_pendentes for select to authenticated
  using (condominio_id = public.jwt_condominio());

-- ─────────────────────────────────────────────────────────────────
-- C) O gatilho que desvia
-- ─────────────────────────────────────────────────────────────────
create or replace function public.desviar_para_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_linha    jsonb;
  v_anterior jsonb;
  v_cond     uuid;
  v_alvo     uuid;
  v_resumo   text;
begin
  -- backend (service role) e qualquer outro perfil passam direto
  if public.jwt_role() = 'service_role' then return coalesce(new, old); end if;
  if public.jwt_perfil() is distinct from 'administrador_predial' then
    return coalesce(new, old);
  end if;

  v_linha    := to_jsonb(coalesce(new, old));
  v_anterior := case when old is null then null else to_jsonb(old) end;

  /* condomínio da linha, para escopar a fila:
       · `condominios` guarda em `id`;
       · `penalidade_provas` e `comunicado_destinatarios` NÃO têm a coluna —
         e consultar a mãe não serve, porque ela pode estar na fila também
         (ainda não existe). Nesses dois casos vale o condomínio da SESSÃO:
         o RLS já impede o administrador de tocar em linha de outro prédio,
         então não há como forjar escopo por aqui.
       · nas demais, a própria coluna — conferida contra a sessão. */
  if tg_table_name = 'condominios' then
    v_cond := (v_linha ->> 'id')::uuid;
  elsif tg_table_name in ('penalidade_provas', 'comunicado_destinatarios') then
    v_cond := public.jwt_condominio();
  else
    v_cond := (v_linha ->> 'condominio_id')::uuid;
  end if;
  if v_cond is null or v_cond is distinct from public.jwt_condominio() then
    raise exception 'Alteração fora do seu condomínio.' using errcode = '42501';
  end if;

  v_alvo := case when old is null then null else (to_jsonb(old) ->> 'id')::uuid end;
  v_resumo := left(coalesce(
    v_linha ->> 'nome', v_linha ->> 'nome_fantasia', v_linha ->> 'titulo',
    v_linha ->> 'descricao', v_linha ->> 'numero', v_linha ->> 'competencia', ''), 200);

  insert into public.alteracoes_pendentes
    (condominio_id, tabela, operacao, alvo_id, payload, anterior, resumo, solicitado_por)
  values
    (v_cond, tg_table_name, tg_op, v_alvo, v_linha, v_anterior, nullif(v_resumo, ''),
     public.jwt_usuario());

  return null; -- CANCELA a operação original: a linha não nasce/muda/some
end $$;

/* Tabelas cobertas. Lista EXPLÍCITA (e não "tudo que tem condominio_id")
   para que incluir uma tabela nova seja uma decisão, não um acidente. */
do $$
declare t text;
begin
  foreach t in array array[
    'condominios','blocos','unidades','vagas','pessoas','pessoa_vinculos',
    'categorias_financeiras','fundos','lancamentos','cobrancas','penalidades',
    'penalidade_provas','comunicados','comunicado_destinatarios','documentos',
    'chamados','planilhas_cobranca','planilha_cobranca_linhas']
  loop
    if to_regclass('public.' || t) is null then
      raise notice '[aprovacoes] tabela % não existe — pulada.', t;
      continue;
    end if;
    execute format('drop trigger if exists trg_aprovacao on public.%I', t);
    execute format(
      'create trigger trg_aprovacao before insert or update or delete on public.%I
       for each row execute function public.desviar_para_aprovacao()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- D) Aplicar / rejeitar (só quem tem alteracao.aprovar — o diretor)
--    O diretor aplica com o PRÓPRIO token: o gatilho nem dispara para ele.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.aprovar_alteracao(
  p_id       uuid,
  p_correcao jsonb default null,   -- campos que o diretor quis corrigir
  p_parecer  text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        public.alteracoes_pendentes%rowtype;
  v_final  jsonb;
  v_cols   text;
  v_cols_r text;
begin
  /* ninguém aprova a si mesmo: o veto ao administrador é CRAVADO aqui, e
     não só na tela de permissões — se um dia alguém marcar
     `alteracao.aprovar` para ele por engano, continua valendo */
  if public.jwt_perfil() = 'administrador_predial'
     or not public.jwt_pode('alteracao.aprovar') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  select * into a from public.alteracoes_pendentes where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'inexistente'); end if;
  if a.condominio_id is distinct from public.jwt_condominio() then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  if a.status <> 'pendente' then
    return jsonb_build_object('ok', true, 'ja_decidida', true, 'status', a.status);
  end if;

  -- correção do diretor sobrepõe o que o administrador mandou
  v_final := a.payload || coalesce(p_correcao, '{}'::jsonb);

  /* colunas da tabela alvo, menos a chave: jsonb_populate_record parte da
     linha ATUAL e sobrepõe só o que vier no jsonb, então campo ausente não
     é zerado e o tipo de cada coluna é respeitado sem cast manual */
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols, v_cols_r
  from information_schema.columns
  where table_schema = 'public' and table_name = a.tabela and column_name <> 'id';

  begin
    if a.operacao = 'INSERT' then
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
        a.tabela, a.tabela) using v_final;
    elsif a.operacao = 'UPDATE' then
      execute format(
        'update public.%I as t set (%s) = (select %s from jsonb_populate_record(t::public.%I, $1) as r)
          where t.id = $2', a.tabela, v_cols, v_cols_r, a.tabela) using v_final, a.alvo_id;
    else
      execute format('delete from public.%I where id = $1', a.tabela) using a.alvo_id;
    end if;
  exception when others then
    /* a alteração CONTINUA pendente com o motivo à vista — melhor que
       sumir da fila dando a impressão de que foi aplicada */
    update public.alteracoes_pendentes
       set erro = left(sqlerrm, 400) where id = p_id;
    return jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar', 'detalhe', left(sqlerrm, 400));
  end;

  update public.alteracoes_pendentes
     set status = 'aprovada', decidido_por = public.jwt_usuario(), decidido_em = now(),
         parecer = left(p_parecer, 400), aplicado = v_final, erro = null
   where id = p_id;

  return jsonb_build_object('ok', true, 'operacao', a.operacao, 'tabela', a.tabela,
                            'corrigida', p_correcao is not null and p_correcao <> '{}'::jsonb);
end $$;

create or replace function public.rejeitar_alteracao(
  p_id uuid, p_parecer text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alteracoes_pendentes%rowtype;
begin
  /* ninguém aprova a si mesmo: o veto ao administrador é CRAVADO aqui, e
     não só na tela de permissões — se um dia alguém marcar
     `alteracao.aprovar` para ele por engano, continua valendo */
  if public.jwt_perfil() = 'administrador_predial'
     or not public.jwt_pode('alteracao.aprovar') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  select * into a from public.alteracoes_pendentes where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'inexistente'); end if;
  if a.condominio_id is distinct from public.jwt_condominio() then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  if a.status <> 'pendente' then
    return jsonb_build_object('ok', true, 'ja_decidida', true, 'status', a.status);
  end if;
  update public.alteracoes_pendentes
     set status = 'rejeitada', decidido_por = public.jwt_usuario(), decidido_em = now(),
         parecer = left(p_parecer, 400)
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.aprovar_alteracao(uuid, jsonb, text) to authenticated;
grant execute on function public.rejeitar_alteracao(uuid, text)       to authenticated;

-- ═══════════════════════ FIM ═══════════════════════
-- Confira com:
--   select nome from perfis where nome = 'administrador_predial';
--   select count(*) from perfil_permissoes pp join perfis pf on pf.id = pp.perfil_id
--    where pf.nome = 'administrador_predial' and pp.condominio_id is null;  -- esperado: 23
--   select tgrelid::regclass from pg_trigger where tgname = 'trg_aprovacao' order by 1;
