-- ═══════════════════════════════════════════════════════════════
-- OPERA QUEM EXECUTA, CONFIRMA O DIRETOR
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- Dois perfis operam sob aprovação (perfis_sob_aprovacao):
--   · `administrador_predial` (rótulo "Administrador") — perfil novo;
--   · `sindico` — já existia e PASSOU a operar assim.
-- Os dois enxergam e operam como o diretor, mas o que eles fazem não vale
-- sozinho: a operação é DESVIADA para `alteracoes_pendentes` e cancelada —
-- a linha não existe até o diretor aprovar, e na aprovação ele pode
-- CORRIGIR o conteúdo antes de aplicar.
--
-- Por que no banco e não na tela: ~29 pontos de escrita do app saem direto
-- do navegador com o JWT do usuário. Checar na interface seria teatro — o
-- síndico abriria o console e escreveria igual, porque o RLS libera (o
-- perfil dele TEM a permissão). O gatilho é o único lugar onde a regra não
-- tem como ser contornada.
--
-- Três coisas NÃO são uma escrita só, e sim uma RPC que mexe em várias
-- tabelas (baixar pagamento, cancelar cobrança, rejeitar pagamento
-- informado). Essas viram UMA pendência do tipo ACAO antes de qualquer
-- escrita — ver a seção C2 para o porquê de deixá-las correr corromper o
-- estado em vez de deixá-lo pendente.
--
-- FORA da fila, de propósito:
--   · CRIAR unidade (e o bloco que vem junto), CRIAR pessoa e o vínculo
--     dela — montar o prédio e o cadastro é trabalho operacional; o diretor
--     quer ver o resultado pronto, não aprovar apartamento por apartamento.
--     ALTERAR e EXCLUIR continuam esperando SEMPRE, em toda tabela;
--   · CRIAR cobrança — mas ela nasce RASCUNHO e só vira "emitida" (= visível
--     e pagável pelo morador) quando o diretor emitir. O portão mudou de
--     lugar, não sumiu: quem define QUEM PAGA a unidade segue na fila;
--   · `acessos_portaria` e `pre_autorizacoes` — o visitante está no portão
--     agora; travar isso esperando o diretor para a portaria;
--   · o que roda com SERVICE ROLE (endpoints /api/auth/acessos e /api/stripe)
--     — aí o gatilho nem dispara. `licenca.gerir` nenhum dos dois recebe.
--     Criar acesso é exceção com coleira: eles RECEBEM acesso.gerir, mas
--     api/auth/acessos.js só os deixa criar login de MORADOR. Se criassem
--     um síndico ou um diretor, entrariam com ele e escreveriam fora da
--     fila. Remover acesso e trocar cargo continuam do diretor.
--
-- Depende de supabase-permissoes.sql (usa jwt_pode/jwt_perfil). Rode DEPOIS
-- dele. Sem este arquivo nada muda: o perfil não existe e o app segue igual.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A0) QUEM opera sob aprovação
--     Lista única, consultada pelo gatilho, pelos embrulhos de RPC e pelas
--     RPCs de decisão. Espelhada em PERFIS_SOB_APROVACAO (src/lib/
--     aprovacoes.js) — a sonda compara as duas.
--     O SÍNDICO entrou aqui: ele opera o dia a dia (cadastra, lança, emite)
--     e o diretor confirma. Mesmo mecanismo, mesma política.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.perfis_sob_aprovacao() returns text[]
language sql immutable as $$ select array['administrador_predial', 'sindico'] $$;
grant execute on function public.perfis_sob_aprovacao() to anon, authenticated;

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
   consegue cobrir. Fora: financeiro.baixar, cobranca.cancelar e
   licenca.gerir (não passam por escrita direta, logo a fila não as
   alcança) e alteracao.aprovar (ninguém aprova a si mesmo).
   `acesso.gerir` ENTRA, mas api/auth/acessos.js o limita a criar login de
   MORADOR: criar um síndico seria entrar por fora da fila. */
create or replace view public._padrao_administrador as
select c as codigo from unnest(array[
  'tela.dashboard','tela.condominio','tela.unidades','tela.pessoas','tela.financeiro',
  'tela.cobrancas','tela.multas','tela.comunicados','tela.documentos','tela.chamados',
  'tela.portaria','tela.acessos',
  'condominio.editar','unidade.criar','financeiro.lancar','financeiro.aprovar',
  'cobranca.emitir','multa.registrar','multa.aprovar','comunicado.publicar',
  'documento.emitir','chamado.abrir','dados.escrever','acesso.gerir']) c;
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
  /* operacao = INSERT/UPDATE/DELETE → `tabela` é a tabela e `payload` é a
     linha. operacao = ACAO → `tabela` carrega o CÓDIGO DA AÇÃO
     ('financeiro.baixar', 'cobranca.cancelar', …) e `payload` são os
     argumentos da RPC. Ver a seção C2. */
  tabela         varchar(63) not null,
  operacao       varchar(6)  not null check (operacao in ('INSERT','UPDATE','DELETE','ACAO')),
  alvo_id        uuid,                       -- linha afetada (UPDATE/DELETE/ACAO)
  payload        jsonb not null,             -- linha proposta (NEW), a que sairia (OLD) ou os args da ação
  anterior       jsonb,                      -- OLD, para o diff na tela
  resumo         varchar(200),               -- texto curto para a lista
  /* on delete set null: a fila guarda HISTÓRICO, e histórico não pode
     impedir o diretor de remover um acesso. Sem isso, tirar o acesso de
     um administrador que deixou pendências falha com erro de chave
     estrangeira — e ele continua entrando. Perde-se o nome, não o fato. */
  solicitado_por uuid references public.usuarios(id) on delete set null,
  solicitado_em  timestamptz not null default now(),
  status         varchar(10) not null default 'pendente'
                 check (status in ('pendente','aprovada','rejeitada')),
  decidido_por   uuid references public.usuarios(id) on delete set null,
  decidido_em    timestamptz,
  parecer        varchar(400),
  aplicado       jsonb,                      -- o que o diretor REALMENTE aplicou
  erro           varchar(400)                -- falha ao aplicar (fica pendente)
);
create index if not exists alteracoes_pendentes_fila
  on public.alteracoes_pendentes (condominio_id, status, solicitado_em desc);

/* instalações que já criaram a tabela não ganham nem o `on delete set null`
   nem a operação ACAO pelo create acima (ele é if not exists) — refaz aqui */
do $$
begin
  alter table public.alteracoes_pendentes
    drop constraint if exists alteracoes_pendentes_operacao_check;
  alter table public.alteracoes_pendentes
    add constraint alteracoes_pendentes_operacao_check
      check (operacao in ('INSERT','UPDATE','DELETE','ACAO'));
  alter table public.alteracoes_pendentes
    drop constraint if exists alteracoes_pendentes_solicitado_por_fkey,
    drop constraint if exists alteracoes_pendentes_decidido_por_fkey;
  alter table public.alteracoes_pendentes
    add constraint alteracoes_pendentes_solicitado_por_fkey
      foreign key (solicitado_por) references public.usuarios(id) on delete set null,
    add constraint alteracoes_pendentes_decidido_por_fkey
      foreign key (decidido_por) references public.usuarios(id) on delete set null;
end $$;

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
  if not (public.jwt_perfil() = any(public.perfis_sob_aprovacao())) then
    return coalesce(new, old);
  end if;

  /* Escrita feita por OUTRO GATILHO (profundidade > 1) é CONSEQUÊNCIA de
     uma operação já aceita — sincronização planilha ⇄ cobranças, feed de
     movimentações, saldo do fundo. Ninguém decidiu isso: decidiu-se a
     operação que a disparou. Enfileirar encheria a tela do diretor com
     efeitos colaterais que ele não escolheu e, pior, quebraria a
     sincronização no meio do caminho (a linha da planilha nunca apontaria
     para a cobrança que acabou de nascer). */
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  /* ── O QUE NÃO ESPERA ──────────────────────────────────────────────
     Montar o prédio é trabalho operacional do administrador: o diretor
     quer ver as unidades prontas, não aprovar apartamento por apartamento.
     ALTERAR e EXCLUIR continuam esperando SEMPRE, em toda tabela — o risco
     não está no cadastro novo, está no que muda de valor ou some.

     `blocos` entra por MECÂNICA, não por escolha: criar unidade cria o
     bloco junto, e um bloco preso na fila deixaria a unidade apontando
     para uma linha que não existe — a chave estrangeira recusaria na hora.
     Espelhado em IMEDIATAS (src/lib/aprovacoes.js); a sonda compara os dois. */
  if tg_op = 'INSERT' and tg_table_name in
     ('blocos', 'unidades', 'pessoas', 'pessoa_vinculos') then
    return new;
  end if;

  /* Cobrança do administrador NASCE RASCUNHO: entra na lista do diretor na
     hora, mas o portal do morador e o checkout não a enxergam até ele
     emitir. Forçado AQUI, e não na tela, porque a escrita sai do navegador
     com o JWT dele — pela tela ele mandaria 'emitida' pelo console e a
     cobrança chegaria ao morador sem ninguém ter olhado.
     O UPDATE continua na fila, então rascunho→emitida não é dele. */
  if tg_op = 'INSERT' and tg_table_name = 'cobrancas' then
    new.status := 'rascunho';
    return new;
  end if;

  /* Fração ideal é consequência ARITMÉTICA de uma unidade já aceita, não
     decisão: o app refaz o rateio de todas as unidades a cada inclusão.
     Enfileirar encheria a tela do diretor com N pendências por unidade
     criada, nenhuma delas uma escolha dele. Qualquer outro campo que mude
     junto tira a linha desta exceção e ela volta para a fila. */
  if tg_op = 'UPDATE' and tg_table_name = 'unidades'
     and (to_jsonb(new) - 'fracao_ideal' - 'atualizado_em')
       = (to_jsonb(old) - 'fracao_ideal' - 'atualizado_em') then
    return new;
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
-- C2) AÇÕES DE RPC na fila
--
-- Baixar pagamento, cancelar cobrança e rejeitar pagamento informado NÃO
-- são uma escrita só: cada uma mexe em pagamentos, cobranças, lançamentos
-- e fundos dentro de uma RPC. O gatilho ALCANÇA essas escritas (jwt_perfil
-- lê o claim, e SECURITY DEFINER não troca o claim) — e é justamente por
-- isso que deixá-las correr seria pior que bloquear: `pagamentos` não está
-- na lista coberta e entraria, enquanto a baixa da cobrança ficaria na
-- fila. Resultado: pagamento registrado numa cobrança que continua em
-- aberto. Estado corrompido, não "pendente".
--
-- Então a ação inteira vira UMA pendência, antes de qualquer escrita:
-- `operacao = 'ACAO'`, `tabela` = o código da ação, `payload` = os
-- argumentos. Na aprovação o diretor chama o corpo real (__base) com os
-- argumentos — podendo corrigir o valor antes, como em qualquer pendência.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.enfileirar_acao(
  p_acao text, p_args jsonb, p_resumo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cond uuid := public.jwt_condominio();
begin
  if v_cond is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_condominio');
  end if;
  insert into public.alteracoes_pendentes
    (condominio_id, tabela, operacao, alvo_id, payload, resumo, solicitado_por)
  values
    (v_cond, p_acao, 'ACAO', nullif(p_args ->> 'cobranca_id', '')::uuid,
     p_args, left(p_resumo, 200), public.jwt_usuario());
  /* `na_fila` é o que a tela lê para dizer "enviado ao diretor" em vez de
     "pronto" — o ok:true sozinho seria uma mentira educada */
  return jsonb_build_object('ok', true, 'na_fila', true);
end $$;
grant execute on function public.enfileirar_acao(text, jsonb, text) to authenticated;

/* Executa a ação aprovada. Allowlist EXPLÍCITA: `tabela` vem de uma linha
   do banco e nunca pode virar nome de função executável — por isso um
   `case` fechado, e não `execute format(...)`. */
create or replace function public.executar_acao(p_acao text, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_acao = 'financeiro.baixar' then
    return public.registrar_pagamento_manual__base(
      (p_args ->> 'cobranca_id')::uuid,
      (p_args ->> 'forma')::forma_pagamento,
      (p_args ->> 'valor')::numeric,
      (p_args ->> 'pago_em')::timestamptz,
      p_args ->> 'justificativa',
      (nullif(p_args ->> 'tx', ''))::varchar,
      nullif(p_args ->> 'informado_id', '')::uuid);
  elsif p_acao = 'cobranca.cancelar' then
    return public.cancelar_cobranca__base(
      (p_args ->> 'cobranca_id')::uuid, p_args ->> 'justificativa');
  elsif p_acao = 'pagamento.rejeitar' then
    return public.rejeitar_pagamento_informado__base(
      (p_args ->> 'informado_id')::uuid, p_args ->> 'motivo');
  end if;
  raise exception 'Ação desconhecida na fila: %', p_acao using errcode = '22023';
end $$;

/* Embrulhos: mantêm a checagem de permissão de supabase-permissoes.sql
   (marcador __permissoes_embrulho__, que impede o rename para __base lá) e
   acrescentam o desvio para a fila.
   ATENÇÃO: re-rodar supabase-permissoes.sql REFAZ estes embrulhos SEM o
   desvio — rode este arquivo depois dele, sempre. */
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
begin
  -- __permissoes_embrulho__
  if public.jwt_role() <> 'service_role' and not public.jwt_pode('financeiro.baixar') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  -- __aprovacao_embrulho__
  if public.jwt_perfil() = any(public.perfis_sob_aprovacao()) then
    return public.enfileirar_acao('financeiro.baixar', jsonb_build_object(
      'cobranca_id', p_cobranca_id, 'forma', p_forma, 'valor', p_valor,
      'pago_em', p_pago_em, 'justificativa', p_justificativa,
      'tx', p_tx, 'informado_id', p_informado_id),
      'baixa de ' || coalesce(p_valor::text, '?'));
  end if;
  return public.registrar_pagamento_manual__base(
    p_cobranca_id, p_forma, p_valor, p_pago_em, p_justificativa, p_tx, p_informado_id);
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'cancelar_cobranca__base') then
    execute $f$
      create or replace function public.cancelar_cobranca(
        p_cobranca_id uuid, p_justificativa text
      ) returns jsonb
      language plpgsql security definer set search_path = public as $corpo$
      begin
        -- __permissoes_embrulho__
        if public.jwt_role() <> 'service_role' and not public.jwt_pode('cobranca.cancelar') then
          return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
        end if;
        -- __aprovacao_embrulho__
        if public.jwt_perfil() = any(public.perfis_sob_aprovacao()) then
          return public.enfileirar_acao('cobranca.cancelar', jsonb_build_object(
            'cobranca_id', p_cobranca_id, 'justificativa', p_justificativa), p_justificativa);
        end if;
        return public.cancelar_cobranca__base(p_cobranca_id, p_justificativa);
      end $corpo$;
    $f$;
  else
    raise notice '[aprovacoes] cancelar_cobranca__base não existe — rode supabase-planilha-sync.sql e supabase-permissoes.sql, depois repita este arquivo.';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rejeitar_pagamento_informado__base') then
    execute $f$
      create or replace function public.rejeitar_pagamento_informado(
        p_informado_id uuid, p_motivo text
      ) returns jsonb
      language plpgsql security definer set search_path = public as $corpo$
      begin
        -- __permissoes_embrulho__
        if public.jwt_role() <> 'service_role' and not public.jwt_pode('financeiro.baixar') then
          return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
        end if;
        -- __aprovacao_embrulho__
        if public.jwt_perfil() = any(public.perfis_sob_aprovacao()) then
          return public.enfileirar_acao('pagamento.rejeitar', jsonb_build_object(
            'informado_id', p_informado_id, 'motivo', p_motivo), p_motivo);
        end if;
        return public.rejeitar_pagamento_informado__base(p_informado_id, p_motivo);
      end $corpo$;
    $f$;
  else
    raise notice '[aprovacoes] rejeitar_pagamento_informado__base não existe — rode supabase-permissoes.sql e repita este arquivo.';
  end if;
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
  v_res    jsonb;
  v_cols   text;
  v_cols_r text;
begin
  /* ninguém aprova a si mesmo: o veto ao administrador é CRAVADO aqui, e
     não só na tela de permissões — se um dia alguém marcar
     `alteracao.aprovar` para ele por engano, continua valendo */
  if public.jwt_perfil() = any(public.perfis_sob_aprovacao())
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

  -- correção do diretor sobrepõe o que o solicitante mandou
  v_final := a.payload || coalesce(p_correcao, '{}'::jsonb);

  /* AÇÃO (baixa, cancelamento, rejeição): não há linha a montar — o corpo
     real da RPC faz o trabalho inteiro, com os argumentos já corrigidos.
     Se ele devolver ok:false, a pendência CONTINUA aberta com o motivo à
     vista: "cobrança já paga" não pode virar um carimbo de aprovada. */
  if a.operacao = 'ACAO' then
    begin
      v_res := public.executar_acao(a.tabela, v_final);
    exception when others then
      update public.alteracoes_pendentes set erro = left(sqlerrm, 400) where id = p_id;
      return jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar', 'detalhe', left(sqlerrm, 400));
    end;
    if coalesce(v_res ->> 'ok', 'false') <> 'true' then
      update public.alteracoes_pendentes
         set erro = left(coalesce(v_res ->> 'erro', 'recusada'), 400) where id = p_id;
      return jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar',
                                'detalhe', coalesce(v_res ->> 'erro', 'recusada'));
    end if;
    update public.alteracoes_pendentes
       set status = 'aprovada', decidido_por = public.jwt_usuario(), decidido_em = now(),
           parecer = left(p_parecer, 400), aplicado = v_final, erro = null
     where id = p_id;
    return jsonb_build_object('ok', true, 'operacao', 'ACAO', 'acao', a.tabela,
                              'corrigida', p_correcao is not null and p_correcao <> '{}'::jsonb);
  end if;

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
  if public.jwt_perfil() = any(public.perfis_sob_aprovacao())
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
