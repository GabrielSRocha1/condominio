-- ═══════════════════════════════════════════════════════════════
-- HISTÓRICO DE ALTERAÇÕES — trilha de CRUD + aba do diretor + desfazer.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que instala:
--   · endurece a tabela `auditoria` (nasceu no schema e estava órfã, com
--     as policies genéricas do loop de RLS: QUALQUER perfil do condomínio
--     lia a trilha) — leitura só com jwt_pode('tela.historico'), escrita
--     nenhuma (só gatilho security definer), append-only de verdade;
--   · gatilho genérico trg_historico em 23 tabelas do domínio: grava quem
--     (usuario + perfil do JWT), o quê (antes/depois inteiros), quando e a
--     ação (INSERT/UPDATE/DELETE) — pulando consequências de outros
--     gatilhos e UPDATEs cosméticos (só atualizado_em);
--   · view historico_unificado (security_invoker): auditoria (CRUD) +
--     auditoria_eventos (segurança/eventos da seguranca3) numa linha só —
--     é o que a aba Histórico pagina;
--   · troca a policy de leitura de auditoria_eventos: decidia por NOME de
--     perfil ('diretor','sindico'); passa a decidir pela matriz
--     (jwt_pode('tela.historico') — padrão: só o diretor, delegável);
--   · RPC desfazer_alteracao(id): reverte criou/editou/excluiu de
--     CADASTROS com checagem otimista (só se nada mudou depois) e grava
--     entrada nova 'DESFAZ' — a trilha nunca é apagada. DINHEIRO fica
--     fora (cobrancas, lancamentos, fundos, planilhas_cobranca,
--     acessos_portaria): baixa/cancelamento/rejeição mexem em várias
--     tabelas dentro de RPCs próprias e desfazer só a parte auditada
--     deixaria o caixa sem lastro. Espelho: ENTIDADES_SEM_DESFAZER em
--     src/lib/historico.js (a sonda compara os dois);
--   · `reservas` saiu desse bloqueio em 12/11/2026 e ganhou guarda pelo
--     PAR antes/depois: desfazer a confirmação CANCELA a cobrança da taxa
--     na mesma transação; taxa paga ou com informe pendente recusa
--     (taxa_paga / taxa_informe_pendente) e desfazer um cancelamento
--     também (taxa_cancelada — re-emitir é pela tela Reservas). Recusar
--     um pedido nunca tocou em dinheiro e agora é desfazível;
--   · catálogo: permissões tela.historico e historico.desfazer (fora do
--     padrão de todos os perfis — só o diretor, até delegar pela matriz;
--     VEDADAS ao administrador predial em src/lib/permissoes.js: a trilha
--     fiscaliza justamente quem administra).
--
-- Limites aceitos nesta versão (documentados de propósito):
--   · desfazer uma EXCLUSÃO recria a linha-mãe; filhas que caíram por
--     cascade na exclusão original NÃO voltam (desfaça as exclusões
--     filhas antes, se foram auditadas);
--   · entrada 'DESFAZ' não tem botão de desfazer (undo de undo fica para
--     depois);
--   · jsonb acima de ~100 KB é gravado como marcador {_grande: true}
--     com as chaves de resumo — a linha fica legível, mas não desfazível.
--
-- Sem este RUN o app continua inteiro: a aba Histórico aparece só para o
-- diretor e mostra o aviso para rodar este arquivo; nada mais muda.
--
-- Ordem: passo 12 — depois de schema, rls, seguranca 1→5, permissoes
-- (jwt_pode) e aprovacoes. ⚠️ RE-EXECUÇÃO: re-rodar supabase-rls.sql OU
-- supabase-seguranca3.sql derruba/recria policies que este arquivo
-- substitui — re-rode este arquivo DEPOIS deles.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A) Catálogo de permissões (idempotente; também listado em
--    src/lib/permissoes.js — scripts/testar-permissoes.mjs compara)
-- ─────────────────────────────────────────────────────────────────
insert into public.permissoes (codigo, descricao) values
  ('tela.historico',     'Ver a tela Histórico de alterações'),
  ('historico.desfazer', 'Desfazer alterações pelo Histórico')
on conflict (codigo) do update set descricao = excluded.descricao, atualizado_em = now();
-- nenhuma linha em perfil_permissoes: padrão = só o diretor (anti-trava)

-- ─────────────────────────────────────────────────────────────────
-- B) Endurecimento da tabela `auditoria` (supabase-schema.sql:657)
-- ─────────────────────────────────────────────────────────────────
-- a entrada 'DESFAZ' aponta para a entrada que ela reverte
alter table public.auditoria add column if not exists ref_id bigint references public.auditoria(id);

create index if not exists idx_historico_cond_ts  on public.auditoria (condominio_id, ts desc);
create index if not exists idx_historico_entidade on public.auditoria (condominio_id, entidade, ts desc);

alter table public.auditoria enable row level security;
-- fora das policies genéricas: `auditoria` está nas listas de exclusão dos
-- loops de supabase-rls.sql e supabase-permissoes.sql; aqui derrubamos o
-- que uma execução ANTIGA desses arquivos tiver deixado
drop policy if exists tenant_select  on public.auditoria;
drop policy if exists tenant_escrita on public.auditoria;
drop policy if exists historico_select on public.auditoria;
create policy historico_select on public.auditoria for select to authenticated
  using (condominio_id = public.jwt_condominio() and public.jwt_pode('tela.historico'));
-- escrita: NENHUMA policy — só o gatilho e a RPC (security definer)

-- Append-only no molde da seguranca3: UPDATE proibido, DELETE só >365d --
create or replace function public.historico_protege() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'auditoria é append-only — UPDATE proibido';
  end if;
  if old.ts > now() - interval '365 days' then
    raise exception 'auditoria é append-only — DELETE só para linhas com mais de 365 dias';
  end if;
  return old;
end $$;
drop trigger if exists trg_historico_protege on public.auditoria;
create trigger trg_historico_protege
  before update or delete on public.auditoria
  for each row execute function public.historico_protege();

create or replace function public.historico_protege_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'auditoria é append-only — TRUNCATE proibido';
end $$;
drop trigger if exists trg_historico_protege_truncate on public.auditoria;
create trigger trg_historico_protege_truncate
  before truncate on public.auditoria
  for each statement execute function public.historico_protege_truncate();

-- ─────────────────────────────────────────────────────────────────
-- C) O gatilho genérico
-- ─────────────────────────────────────────────────────────────────
-- Guarda de tamanho: antes/depois são gravados INTEIROS (o desfazer precisa
-- do valor fiel); só um jsonb anômalo (>100 KB) vira marcador com o resumo.
create or replace function public.historico_cabe(j jsonb) returns jsonb
language plpgsql immutable as $$
begin
  if j is null or pg_column_size(j) <= 100000 then return j; end if;
  return jsonb_build_object('_grande', true)
      || coalesce((select jsonb_object_agg(k, j -> k)
                     from unnest(array['id','nome','titulo','descricao','numero','competencia']) k
                    where j ? k), '{}'::jsonb);
end $$;

create or replace function public.historico_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_linha jsonb; v_cond uuid; v_hdr jsonb; v_ip inet; v_ua varchar(300);
begin
  /* o desfazer grava a própria entrada 'DESFAZ' — não duplicar */
  if current_setting('app.desfazendo', true) = '1' then return coalesce(new, old); end if;
  /* escrita feita por OUTRO gatilho (sync planilha ⇄ cobranças, feed do
     sino, saldo de fundo) é CONSEQUÊNCIA da operação já gravada — mesmo
     racional do desviar_para_aprovacao */
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  /* UPDATE cosmético (só o carimbo atualizado_em) não é história */
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'atualizado_em') = (to_jsonb(old) - 'atualizado_em') then
    return new;
  end if;

  v_linha := to_jsonb(coalesce(new, old));
  /* condomínio da linha — molde do desviar_para_aprovacao: `condominios`
     guarda em `id`; as duas filhas sem a coluna valem a sessão (o RLS já
     impede tocar linha de outro prédio); nas demais, a própria coluna */
  if tg_table_name = 'condominios' then
    v_cond := (v_linha ->> 'id')::uuid;
  elsif tg_table_name in ('penalidade_provas', 'comunicado_destinatarios') then
    v_cond := public.jwt_condominio();
  else
    v_cond := (v_linha ->> 'condominio_id')::uuid;
  end if;

  /* ip e user-agent: melhor esforço a partir dos headers do PostgREST */
  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip  := nullif(split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1), '')::inet;
    v_ua  := left(v_hdr ->> 'user-agent', 300);
  exception when others then
    v_ip := null; v_ua := null;
  end;

  insert into public.auditoria
    (condominio_id, usuario_id, perfil, acao, entidade, entidade_id, antes, depois, ip, user_agent)
  values
    (v_cond, public.jwt_usuario(),
     coalesce(nullif(public.jwt_perfil(), ''), 'sistema'),
     tg_op, tg_table_name, nullif(v_linha ->> 'id', '')::uuid,
     case when tg_op = 'INSERT' then null else public.historico_cabe(to_jsonb(old)) end,
     case when tg_op = 'DELETE' then null else public.historico_cabe(to_jsonb(new)) end,
     v_ip, v_ua);
  return coalesce(new, old);
exception when others then
  /* a trilha NUNCA derruba a escrita que a gerou */
  return coalesce(new, old);
end $$;
revoke all on function public.historico_registrar() from public, anon, authenticated;

-- Tabelas cobertas. Lista EXPLÍCITA (incluir tabela nova é decisão, não
-- acidente — molde de supabase-aprovacoes.sql). Fora, com motivo:
--   · planilha_cobranca_linhas — importação em massa = milhares de linhas
--     de ruído por sessão (planilhas_cobranca já conta a história);
--   · pagamentos, pagamentos_informados, usuario_perfis — já têm gatilho
--     próprio → auditoria_eventos (um fato = uma entrada na aba).
-- reservas, areas_comuns, assembleias e atas entraram em 09/11/2026, junto
-- com as telas de Reservas e Assembleias (supabase-reservas-assembleias.sql).
do $$
declare t text;
begin
  foreach t in array array[
    'condominios','blocos','unidades','vagas','pessoas','pessoa_vinculos',
    'categorias_financeiras','fundos','lancamentos','cobrancas','penalidades',
    'penalidade_provas','comunicados','comunicado_destinatarios','documentos',
    'chamados','pre_autorizacoes',
    'areas_comuns','reservas','assembleias','atas']
  loop
    if to_regclass('public.' || t) is null then
      raise notice '[historico] tabela % não existe — pulada.', t;
      continue;
    end if;
    execute format('drop trigger if exists trg_historico on public.%I', t);
    execute format(
      'create trigger trg_historico after insert or update or delete on public.%I
       for each row execute function public.historico_registrar()', t);
  end loop;
end $$;

-- planilhas_cobranca: SÓ delete (criar/atualizar já viram planilha_criada /
-- planilha_atualizada em auditoria_eventos — supabase-planilhas.sql)
do $$
begin
  if to_regclass('public.planilhas_cobranca') is null then
    raise notice '[historico] planilhas_cobranca não existe — pulada.';
  else
    drop trigger if exists trg_historico on public.planilhas_cobranca;
    create trigger trg_historico after delete on public.planilhas_cobranca
      for each row execute function public.historico_registrar();
  end if;
end $$;

-- acessos_portaria: SÓ update/delete (o INSERT é o registro operacional
-- normal da tela Portaria; adulterar ou apagar é o que a trilha deve pegar)
do $$
begin
  if to_regclass('public.acessos_portaria') is null then
    raise notice '[historico] acessos_portaria não existe — pulada.';
  else
    drop trigger if exists trg_historico on public.acessos_portaria;
    create trigger trg_historico after update or delete on public.acessos_portaria
      for each row execute function public.historico_registrar();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- D) auditoria_eventos passa a decidir pela MATRIZ (era por nome de perfil)
-- ─────────────────────────────────────────────────────────────────
-- Síndico perde a leitura que tinha pelo nome, a menos que o diretor
-- delegue tela.historico — é o requisito ("padrão: só o diretor").
do $$
begin
  if to_regclass('public.auditoria_eventos') is null then
    raise notice '[historico] auditoria_eventos não existe (rode a seguranca3) — policy não trocada.';
  else
    drop policy if exists auditoria_select on public.auditoria_eventos;
    create policy auditoria_select on public.auditoria_eventos for select to authenticated
      using (condominio_id = public.jwt_condominio() and public.jwt_pode('tela.historico'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- E) A view unificada que a aba pagina
-- ─────────────────────────────────────────────────────────────────
-- security_invoker: o RLS das DUAS tabelas-base (e de usuarios/pessoas,
-- que dão nome e e-mail ao autor) vale para quem consulta. O left join
-- degrada: sem direito de ler usuarios, a linha aparece com e-mail nulo.
do $$
begin
  if to_regclass('public.auditoria_eventos') is not null then
    execute $v$
      create or replace view public.historico_unificado with (security_invoker = true) as
      select 'dados'::text as fonte, 'd' || a.id::text as id, a.id as ref,
             a.ts, a.condominio_id, a.usuario_id,
             pe.nome as autor_nome, u.email as autor_email,
             a.perfil, a.acao, a.entidade, a.entidade_id,
             a.antes, a.depois, null::jsonb as detalhe,
             null::varchar as severidade, a.ref_id as desfaz_de
        from public.auditoria a
        left join public.usuarios u on u.id = a.usuario_id
        left join public.pessoas pe on pe.id = u.pessoa_id
      union all
      select 'eventos', 'e' || e.id::text, null, e.quando, e.condominio_id, e.usuario_id,
             pe.nome, u.email, null, 'EVENTO', e.evento, null,
             null, null, e.detalhe, e.severidade, null
        from public.auditoria_eventos e
        left join public.usuarios u on u.id = e.usuario_id
        left join public.pessoas pe on pe.id = u.pessoa_id
    $v$;
  else
    execute $v$
      create or replace view public.historico_unificado with (security_invoker = true) as
      select 'dados'::text as fonte, 'd' || a.id::text as id, a.id as ref,
             a.ts, a.condominio_id, a.usuario_id,
             pe.nome as autor_nome, u.email as autor_email,
             a.perfil, a.acao, a.entidade, a.entidade_id,
             a.antes, a.depois, null::jsonb as detalhe,
             null::varchar as severidade, a.ref_id as desfaz_de
        from public.auditoria a
        left join public.usuarios u on u.id = a.usuario_id
        left join public.pessoas pe on pe.id = u.pessoa_id
    $v$;
    raise notice '[historico] view criada SÓ com a metade de dados (sem auditoria_eventos).';
  end if;
end $$;
grant select on public.historico_unificado to authenticated;
revoke all on public.historico_unificado from anon;

-- ─────────────────────────────────────────────────────────────────
-- F) Desfazer
-- ─────────────────────────────────────────────────────────────────
create or replace function public.desfazer_alteracao(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a record; v_cols text; v_cols_r text; v_atual jsonb;
  v_cob_status text; v_cob jsonb;   -- taxa da reserva (ver a guarda de `reservas`)
begin
  if public.jwt_role() <> 'service_role' and not public.jwt_pode('historico.desfazer') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;

  select * into a from public.auditoria where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'inexistente');
  end if;
  if public.jwt_role() <> 'service_role'
     and (a.condominio_id is null or a.condominio_id is distinct from public.jwt_condominio()) then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;

  if a.acao not in ('INSERT', 'UPDATE', 'DELETE') or a.entidade_id is null
     or coalesce(a.antes ? '_grande', false) or coalesce(a.depois ? '_grande', false) then
    return jsonb_build_object('ok', false, 'erro', 'nao_desfazivel');
  end if;
  /* dinheiro fica fora — espelho de ENTIDADES_SEM_DESFAZER (src/lib/historico.js) */
  if a.entidade in ('cobrancas','lancamentos','fundos','planilhas_cobranca','acessos_portaria') then
    return jsonb_build_object('ok', false, 'erro', 'entidade_bloqueada');
  end if;
  /* allowlist dura: só as tabelas do gatilho (fecha qualquer injeção via
     `entidade` e recusa entrada forjada) */
  if a.entidade not in ('condominios','blocos','unidades','vagas','pessoas','pessoa_vinculos',
      'categorias_financeiras','penalidades','penalidade_provas','comunicados',
      'comunicado_destinatarios','documentos','chamados','pre_autorizacoes',
      'areas_comuns','reservas','assembleias','atas') then
    return jsonb_build_object('ok', false, 'erro', 'nao_desfazivel');
  end if;

  /* ── reservas: guarda pelo PAR antes/depois, não pela relação ──
     `reservas` ficou bloqueada inteira de 09 a 12/11/2026 porque confirmar
     GERA a cobrança 'extra' da taxa. Mas recusar um pedido não toca em
     dinheiro nenhum, e estava tão indesfazível quanto a confirmação. Agora
     o recorte é cirúrgico, e a cobrança é conferida ANTES de qualquer
     escrita (a função roda na transação do PostgREST: `return` depois de
     escrever não desfaz o que foi escrito). */
  if a.entidade = 'reservas' then
    /* desfazer um CANCELAMENTO exigiria RE-EMITIR a taxa cancelada — o
       Histórico não emite cobrança: confirmar de novo é pela tela Reservas */
    /* `antes` nulo (INSERT) ou sem a chave já cai fora: ->> devolve null */
    if a.antes ->> 'cobranca_id' is not null
       and exists (select 1 from public.cobrancas c
                    where c.id = (a.antes ->> 'cobranca_id')::uuid and c.status = 'cancelada') then
      return jsonb_build_object('ok', false, 'erro', 'taxa_cancelada');
    end if;
    /* desfazer a CONFIRMAÇÃO: a taxa tem de poder ser cancelada junto */
    if a.acao = 'UPDATE' and a.antes ->> 'cobranca_id' is null
       and a.depois ->> 'cobranca_id' is not null then
      select status::text into v_cob_status from public.cobrancas
       where id = (a.depois ->> 'cobranca_id')::uuid;
      if v_cob_status in ('paga', 'paga_em_atraso') then
        return jsonb_build_object('ok', false, 'erro', 'taxa_paga');
      end if;
      if v_cob_status in ('pagamento_informado', 'pagamento_divergente') then
        return jsonb_build_object('ok', false, 'erro', 'taxa_informe_pendente');
      end if;
      /* cancelar a cobrança exige cobranca.cancelar (o corpo de
         cancelar_cobranca cobra a permissão, e deve cobrar). Conferir AQUI
         troca um 'falha_ao_desfazer' opaco por uma recusa que diz o que
         falta — o diretor, padrão da aba, tem tudo. */
      if public.jwt_role() <> 'service_role' and not public.jwt_pode('cobranca.cancelar') then
        return jsonb_build_object('ok', false, 'erro', 'taxa_sem_permissao');
      end if;
    end if;
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', a.entidade)
    into v_atual using a.entidade_id;

  /* o gatilho trg_historico pula as escritas abaixo — a entrada é o DESFAZ */
  perform set_config('app.desfazendo', '1', true);

  begin
    if a.acao = 'UPDATE' then
      /* CHECAGEM OTIMISTA: só volta ao `antes` se a linha ainda está como o
         `depois` gravado — senão alguém mexeu depois e o desfazer pisaria
         em cima ("desfaça as mais recentes primeiro") */
      if v_atual is null or (v_atual - 'atualizado_em') is distinct from (a.depois - 'atualizado_em') then
        return jsonb_build_object('ok', false, 'erro', 'registro_mudou');
      end if;
      /* restauração integral pela técnica de aprovar_alteracao: colunas da
         tabela menos a chave; jsonb_populate_record respeita os tipos */
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
             string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
        into v_cols, v_cols_r
      from information_schema.columns
      where table_schema = 'public' and table_name = a.entidade and column_name <> 'id';
      execute format(
        'update public.%I as t set (%s) = (select %s from jsonb_populate_record(t::public.%I, $1) as r)
          where t.id = $2', a.entidade, v_cols, v_cols_r, a.entidade) using a.antes, a.entidade_id;

    elsif a.acao = 'INSERT' then
      if v_atual is null then
        return jsonb_build_object('ok', false, 'erro', 'ja_removido');
      end if;
      if (v_atual - 'atualizado_em') is distinct from (a.depois - 'atualizado_em') then
        return jsonb_build_object('ok', false, 'erro', 'registro_mudou');
      end if;
      execute format('delete from public.%I where id = $1', a.entidade) using a.entidade_id;

    else /* DELETE: recria com o MESMO id, só se ninguém recriou antes */
      if v_atual is not null then
        return jsonb_build_object('ok', false, 'erro', 'registro_mudou');
      end if;
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
        a.entidade, a.entidade) using a.antes;
    end if;

    /* A TAXA, por último de propósito: desfazer a confirmação de uma reserva
       tem de cancelar a cobrança que ela gerou, e todas as recusas acima
       saem por `return` — que NÃO desfaz escrita já feita. Cancelando aqui,
       qualquer recusa anterior acontece antes de a cobrança ser tocada, e
       uma falha daqui para frente rola a reserva atrás junto (a exceção
       volta ao início deste bloco). A guarda de taxa paga/informe já rodou
       lá acima; se mudou no meio (alguém pagou agora), a recusa sobe como
       exceção e nada é gravado. */
    if a.entidade = 'reservas' and a.acao = 'UPDATE'
       and a.antes ->> 'cobranca_id' is null and a.depois ->> 'cobranca_id' is not null then
      if to_regprocedure('public.cancelar_cobranca__base(uuid,text)') is not null then
        v_cob := public.cancelar_cobranca__base((a.depois ->> 'cobranca_id')::uuid,
                   'Confirmação de reserva desfeita pelo Histórico de alterações');
      else
        v_cob := public.cancelar_cobranca((a.depois ->> 'cobranca_id')::uuid,
                   'Confirmação de reserva desfeita pelo Histórico de alterações');
      end if;
      if coalesce((v_cob ->> 'ok')::boolean, false) is not true then
        raise exception 'taxa nao pudo ser cancelada: %', coalesce(v_cob ->> 'erro', '?');
      end if;
    end if;
  exception
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'erro',
        case when a.acao = 'INSERT' then 'tem_dependencias' else 'dependencia_ausente' end);
    when others then
      /* gatilhos de decisão continuam valendo (multa.aprovar, proteção da
         pessoa do diretor…): o veto deles sobe aqui com o motivo à vista */
      return jsonb_build_object('ok', false, 'erro', 'falha_ao_desfazer', 'detalhe', left(sqlerrm, 400));
  end;

  insert into public.auditoria
    (condominio_id, usuario_id, perfil, acao, entidade, entidade_id, antes, depois, ref_id)
  values
    (a.condominio_id, public.jwt_usuario(),
     coalesce(nullif(public.jwt_perfil(), ''), 'sistema'),
     'DESFAZ', a.entidade, a.entidade_id, a.depois, a.antes, a.id);

  return jsonb_build_object('ok', true, 'acao', a.acao, 'entidade', a.entidade);
end $$;
revoke all on function public.desfazer_alteracao(bigint) from public, anon;
grant execute on function public.desfazer_alteracao(bigint) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- Verificação rápida (opcional):
--   select tgrelid::regclass as tabela from pg_trigger
--    where tgname = 'trg_historico' order by 1;            -- 23 tabelas (09/11/2026: +reservas/areas/assembleias/atas)
--   select count(*) from public.permissoes
--    where codigo in ('tela.historico','historico.desfazer');  -- 2
--   update public.auditoria set perfil = 'x'
--    where id = (select max(id) from public.auditoria);         -- deve FALHAR se houver linhas (append-only)
--   select fonte, acao, entidade from public.historico_unificado limit 3;
-- ═══════════════════════════════════════════════════════════════
