-- ═══════════════════════════════════════════════════════════════
-- MATRIZ DE PERMISSÕES LIGADA DE VERDADE
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que este arquivo resolve: `perfis`, `permissoes` e `perfil_permissoes`
-- existem desde o schema, com 8 códigos de exemplo semeados — e NINGUÉM
-- lia a matriz. A permissão efetiva era o NOME do perfil, repetido em três
-- camadas (NAV.roles no front, jwt_perfil() nas policies/RPCs,
-- claims.perfil na API). Daqui para frente a matriz é a autoridade:
--
--   A) perfil_permissoes ganha `condominio_id` — nulo = padrão do SaaS,
--      preenchido = override daquele prédio (SUBSTITUI o padrão);
--   B) catálogo real de permissões (telas + ações sensíveis) semeado;
--   C) padrão de cada perfil semeado REPRODUZINDO o comportamento anterior
--      — rodar este arquivo não muda poder de ninguém (ver a exceção no
--      bloco F, que é o aperto deliberado);
--   D) public.jwt_pode(codigo) — a resolução, usada pelas policies, pelos
--      gatilhos e pelas RPCs;
--   E) policies de escrita recriadas por permissão (não mais por perfil);
--   F) gatilhos de aprovação (lançamento e multa) — esconder botão não é
--      controle, então aprovar/decidir é barrado no banco;
--   G) as 3 RPCs com guarda de perfil ganham guarda granular por EMBRULHO
--      (o corpo real é renomeado para <nome>__base e continua morando no
--      arquivo que o define — zero cópia, zero drift com o
--      supabase-fundo-reserva.sql, que é o definitivo das baixas).
--
-- Sem este RUN o app continua funcionando: o front cai no MATRIZ_PADRAO de
-- src/lib/permissoes.js, a API degrada aberta para a regra antiga e o banco
-- segue com as policies por perfil. Nada trava.
--
-- Ordem: depois de supabase-rls.sql (ele derruba TODAS as policies, então
-- re-rodar o rls exige re-rodar seguranca 1→5 E este arquivo).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A) perfil_permissoes por condomínio
-- ─────────────────────────────────────────────────────────────────
alter table public.perfil_permissoes
  add column if not exists condominio_id uuid references public.condominios(id) on delete cascade;

-- a unique antiga (perfil_id, permissao_id) impediria o override coexistir
-- com o padrão; vira (condominio_id, perfil_id, permissao_id) com NULL
-- comparável — mesmo idioma de usuario_perfis no schema.
-- O loop derruba TODAS as uniques da tabela (inclusive a criada por um RUN
-- anterior deste arquivo), então o add abaixo é idempotente.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.perfil_permissoes'::regclass and contype = 'u'
  loop
    execute format('alter table public.perfil_permissoes drop constraint %I', c);
  end loop;
end $$;

alter table public.perfil_permissoes
  add constraint perfil_permissoes_unico
  unique nulls not distinct (condominio_id, perfil_id, permissao_id);

create index if not exists perfil_permissoes_busca
  on public.perfil_permissoes (perfil_id, condominio_id);

-- "este condomínio customizou este perfil" precisa ser um FATO próprio:
-- sem esta tabela, override VAZIO (perfil zerado de propósito) e ausência
-- de override seriam a mesma coisa — zero linhas — e zerar um perfil
-- cairia de volta no padrão, liberando o que o diretor quis tirar.
create table if not exists public.perfil_overrides (
  id            uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  perfil_id     uuid not null references public.perfis(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (condominio_id, perfil_id)
);

-- ─────────────────────────────────────────────────────────────────
-- B) Catálogo de permissões (espelho de PERMISSOES em src/lib/permissoes.js)
-- ─────────────────────────────────────────────────────────────────
insert into public.permissoes (codigo, descricao) values
  ('tela.dashboard',     'Ver a tela Dashboard'),
  ('tela.condominio',    'Ver a tela Condomínio'),
  ('tela.unidades',      'Ver a tela Unidades'),
  ('tela.pessoas',       'Ver a tela Pessoas'),
  ('tela.financeiro',    'Ver a tela Financeiro'),
  ('tela.cobrancas',     'Ver a tela Cobranças QR'),
  ('tela.multas',        'Ver a tela Multas'),
  ('tela.comunicados',   'Ver a tela Comunicados'),
  ('tela.documentos',    'Ver a tela Documentos'),
  ('tela.chamados',      'Ver a tela Manutenção'),
  ('tela.portaria',      'Ver a tela Portaria'),
  ('tela.acessos',       'Ver a tela Gerenciar Acessos'),
  ('tela.planos',        'Ver a tela Planos e licença'),
  ('tela.portal',        'Entrar no portal do morador'),
  ('condominio.editar',  'Editar o cadastro do condomínio'),
  ('unidade.criar',      'Criar unidades e editar área privativa'),
  ('financeiro.lancar',  'Criar lançamentos de receita e despesa'),
  ('financeiro.aprovar', 'Aprovar ou rejeitar lançamentos'),
  ('financeiro.baixar',  'Dar baixa em pagamentos'),
  ('cobranca.emitir',    'Gerar e emitir cobranças'),
  ('cobranca.cancelar',  'Cancelar cobrança indevida'),
  ('multa.registrar',    'Registrar multas e advertências'),
  ('multa.aprovar',      'Decidir multas após a defesa'),
  ('comunicado.publicar','Publicar comunicados e convocações'),
  ('documento.emitir',   'Emitir documentos timbrados'),
  ('chamado.abrir',      'Abrir chamado de manutenção'),
  ('pagamento.informar', 'Informar pagamento com comprovante'),
  ('acesso.gerir',       'Criar e remover acessos'),
  ('licenca.gerir',      'Contratar, trocar e cancelar a licença'),
  ('dados.escrever',     'Escrever nos dados do condomínio (coringa)'),
  ('permissao.gerir',    'Editar a matriz de permissões'),
  ('saas.gerir',         'Administrar planos, assinaturas e clientes do SaaS')
on conflict (codigo) do update set descricao = excluded.descricao, atualizado_em = now();

-- ─────────────────────────────────────────────────────────────────
-- C) Padrão do SaaS (condominio_id nulo) = comportamento anterior
--    Espelha MATRIZ_PADRAO de src/lib/permissoes.js. O diretor NÃO tem
--    linhas: jwt_pode libera tudo para ele (regra anti-trava — quem é dono
--    do prédio não pode se fechar fora da tela de permissões).
-- ─────────────────────────────────────────────────────────────────
-- a view do padrão é inline (nada de tabela temporária: o SQL Editor pode
-- rodar o arquivo fora de uma transação única)
create or replace view public._padrao_permissoes as
select 'sindico'::text as perfil, c as codigo from unnest(array[
  'tela.dashboard','tela.condominio','tela.unidades','tela.pessoas','tela.financeiro',
  'tela.cobrancas','tela.multas','tela.comunicados','tela.documentos','tela.chamados','tela.portaria',
  'dados.escrever','financeiro.lancar','financeiro.aprovar','financeiro.baixar',
  'cobranca.emitir','cobranca.cancelar','multa.registrar','multa.aprovar',
  'comunicado.publicar','documento.emitir']) c
union all
select 'tesouraria', c from unnest(array[
  'tela.dashboard','tela.unidades','tela.financeiro','tela.cobrancas','tela.documentos',
  'dados.escrever','financeiro.lancar','financeiro.aprovar','financeiro.baixar',
  'cobranca.emitir','cobranca.cancelar','documento.emitir']) c
union all
select 'morador', c from unnest(array['tela.portal','chamado.abrir','pagamento.informar']) c
union all
select 'administradora', c from unnest(array['saas.gerir']) c;

-- insere o que falta
insert into public.perfil_permissoes (condominio_id, perfil_id, permissao_id)
select null, pf.id, pm.id
from public._padrao_permissoes d
join public.perfis pf     on pf.nome = d.perfil
join public.permissoes pm on pm.codigo = d.codigo
on conflict do nothing;

-- e remove linha PADRÃO que não está mais no espelho (re-rodar conserta
-- drift); overrides de condomínio nunca são tocados aqui
delete from public.perfil_permissoes pp
using public.perfis pf, public.permissoes pm
where pp.condominio_id is null
  and pf.id = pp.perfil_id and pm.id = pp.permissao_id
  and pf.nome in ('sindico','tesouraria','morador','administradora')
  and not exists (select 1 from public._padrao_permissoes d
                  where d.perfil = pf.nome and d.codigo = pm.codigo);

-- a view é só andaime do seed; a sonda a usa para provar a paridade com o JS
revoke all on public._padrao_permissoes from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- D) public.jwt_pode(codigo) — a resolução
--    MESMA ordem de src/lib/permissoes.js:
--      service_role → tudo (é o backend);
--      diretor      → tudo (anti-trava);
--      override do condomínio existe → vale SÓ ele;
--      senão        → padrão do SaaS;
--      matriz vazia → degrada ABERTO no comportamento anterior.
--    SECURITY DEFINER porque é chamada DENTRO das policies: precisa ler
--    perfil_permissoes sem passar pelo RLS da própria tabela.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.jwt_pode(p_codigo text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil text := public.jwt_perfil();
  v_cond   uuid := public.jwt_condominio();
  v_pid    uuid;
  v_tem    boolean;
begin
  if public.jwt_role() = 'service_role' then return true; end if;
  if v_perfil = '' or v_perfil is null then return false; end if;
  if v_perfil = 'diretor' then return true; end if;

  -- SQL não rodado / matriz zerada à mão: comportamento anterior
  if not exists (select 1 from perfil_permissoes where condominio_id is null) then
    return case
      when v_perfil = 'morador' then p_codigo in ('tela.portal','chamado.abrir','pagamento.informar')
      when v_perfil in ('sindico','tesouraria') then p_codigo not in ('permissao.gerir','saas.gerir')
      when v_perfil = 'administradora' then p_codigo = 'saas.gerir'
      else false end;
  end if;

  -- editar a matriz nunca é delegável (um perfil se promoveria a tudo)
  if p_codigo = 'permissao.gerir' then return false; end if;

  select id into v_pid from perfis where nome = v_perfil;
  if v_pid is null then return false; end if;

  -- o override é declarado em perfil_overrides, não inferido da contagem:
  -- assim um perfil ZERADO pelo diretor continua zerado
  if v_cond is not null
     and exists (select 1 from perfil_overrides
                 where perfil_id = v_pid and condominio_id = v_cond) then
    select exists (
      select 1 from perfil_permissoes pp join permissoes pm on pm.id = pp.permissao_id
      where pp.perfil_id = v_pid and pp.condominio_id = v_cond and pm.codigo = p_codigo
    ) into v_tem;
    return v_tem;
  end if;

  select exists (
    select 1 from perfil_permissoes pp join permissoes pm on pm.id = pp.permissao_id
    where pp.perfil_id = v_pid and pp.condominio_id is null and pm.codigo = p_codigo
  ) into v_tem;
  return v_tem;
end $$;

grant execute on function public.jwt_pode(text) to anon, authenticated;

-- mapa tabela → permissão de escrita (espelho de PERMISSAO_DA_TABELA)
create or replace function public.permissao_da_tabela(p_tabela text) returns text
language sql immutable as $$
  select case p_tabela
    when 'lancamentos' then 'financeiro.lancar'
    when 'cobrancas'   then 'cobranca.emitir'
    when 'penalidades' then 'multa.registrar'
    when 'comunicados' then 'comunicado.publicar'
    when 'documentos'  then 'documento.emitir'
    else 'dados.escrever' end
$$;

-- ─────────────────────────────────────────────────────────────────
-- E) Leitura da matriz: catálogo é público para quem está logado; as
--    linhas, só do próprio condomínio (+ o padrão). Escrita: nunca pelo
--    navegador — o editor passa por /api/auth/permissoes (service role).
-- ─────────────────────────────────────────────────────────────────
alter table public.perfis             enable row level security;
alter table public.permissoes         enable row level security;
alter table public.perfil_permissoes  enable row level security;

drop policy if exists perfis_leitura on public.perfis;
create policy perfis_leitura on public.perfis for select to authenticated using (true);

drop policy if exists permissoes_leitura on public.permissoes;
create policy permissoes_leitura on public.permissoes for select to authenticated using (true);

drop policy if exists perfil_permissoes_leitura on public.perfil_permissoes;
create policy perfil_permissoes_leitura on public.perfil_permissoes for select to authenticated
  using (condominio_id is null or condominio_id = public.jwt_condominio());

alter table public.perfil_overrides enable row level security;
drop policy if exists perfil_overrides_leitura on public.perfil_overrides;
create policy perfil_overrides_leitura on public.perfil_overrides for select to authenticated
  using (condominio_id = public.jwt_condominio());

-- ─────────────────────────────────────────────────────────────────
-- F) Escrita por PERMISSÃO (recria o tenant_escrita do supabase-rls.sql)
--    Tabela sem permissão própria cai em dados.escrever — que síndico e
--    tesouraria têm por padrão, então nada muda para elas.
--    APERTO DELIBERADO: `penalidades` e `comunicados` passam a exigir
--    multa.registrar / comunicado.publicar, que a TESOURARIA não tem no
--    padrão (ela nunca teve essas telas; o banco é que era mais frouxo
--    que a interface).
-- ─────────────────────────────────────────────────────────────────
do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'condominio_id'
      -- as 3 últimas são a PRÓPRIA matriz e os vínculos de perfil: escrita
      -- só pelo backend (/api/auth/permissoes e /api/auth/acessos, service
      -- role). No loop, um síndico com dados.escrever editaria o próprio
      -- override e se promoveria a tudo.
      and table_name not in ('condominios', 'integracoes_pagamento',
                             'saas_assinaturas', 'pagamentos_informados',
                             'auth_sessoes', 'auditoria_eventos',
                             'perfil_permissoes', 'perfil_overrides', 'usuario_perfis')
  loop
    execute format('drop policy if exists tenant_escrita on public.%I', t.table_name);
    execute format(
      'create policy tenant_escrita on public.%I for all to authenticated
       using (condominio_id = public.jwt_condominio()
              and public.jwt_pode(public.permissao_da_tabela(%L)))
       with check (condominio_id = public.jwt_condominio()
              and public.jwt_pode(public.permissao_da_tabela(%L)))',
      t.table_name, t.table_name, t.table_name);
  end loop;
end $$;

-- condominios fica de fora do loop porque a chave dele é `id`, não
-- `condominio_id` — e por isso a policy de supabase-rls.sql, que decide por
-- NOME de perfil ('diretor'), nunca era substituída. Isso passou a divergir
-- da matriz em 02/11/2026: `condominio.editar` entrou no conjunto do
-- administrador predial, a tela Condomínio abre editável para ele e o UPDATE
-- casava ZERO linha. RLS não acusa erro — só não encontra a linha —, então a
-- tela dizia "Salvo!" e nada mudava, em TODAS as abas (o formulário é um só).
-- Agora decide pela permissão, como todo o resto.
drop policy if exists cond_update on public.condominios;
create policy cond_update on public.condominios for update to authenticated
  using (id = public.jwt_condominio() and public.jwt_pode('condominio.editar'))
  with check (id = public.jwt_condominio());

-- usuario_perfis fica de fora do loop: quem mexe em perfil de usuário é o
-- backend (api/auth/acessos.js, service role). Escrita pelo navegador = não.
alter table public.usuario_perfis enable row level security;
drop policy if exists tenant_escrita on public.usuario_perfis;
drop policy if exists usuario_perfis_leitura on public.usuario_perfis;
create policy usuario_perfis_leitura on public.usuario_perfis for select to authenticated
  using (condominio_id = public.jwt_condominio());

-- morador: o chamado agora passa por chamado.abrir
drop policy if exists morador_abre_chamado on public.chamados;
create policy morador_abre_chamado on public.chamados for insert to authenticated
  with check (condominio_id = public.jwt_condominio() and public.jwt_pode('chamado.abrir'));

-- penalidade_provas não tem condominio_id (herda o escopo da mãe), então
-- ficou fora do loop — sem isto, quem não pode escrever em `penalidades`
-- ainda anexaria provas nelas
drop policy if exists provas_tenant on public.penalidade_provas;
create policy provas_tenant on public.penalidade_provas for all to authenticated
  using (exists (select 1 from public.penalidades x
                 where x.id = penalidade_provas.penalidade_id
                   and x.condominio_id = public.jwt_condominio())
         and public.jwt_pode('multa.registrar'))
  with check (exists (select 1 from public.penalidades x
                 where x.id = penalidade_provas.penalidade_id
                   and x.condominio_id = public.jwt_condominio())
         and public.jwt_pode('multa.registrar'));
-- leitura das provas continua para qualquer perfil do condomínio
drop policy if exists provas_leitura on public.penalidade_provas;
create policy provas_leitura on public.penalidade_provas for select to authenticated
  using (exists (select 1 from public.penalidades x
                 where x.id = penalidade_provas.penalidade_id
                   and x.condominio_id = public.jwt_condominio()));

-- Storage (bucket documentos): upload/remoção passam a pedir
-- documento.emitir, e o anexo do morador, chamado.abrir
drop policy if exists documentos_upload on storage.objects;
create policy documentos_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = public.jwt_condominio()::text
    and public.jwt_pode('documento.emitir')
  );

drop policy if exists documentos_delete on storage.objects;
create policy documentos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = public.jwt_condominio()::text
    and public.jwt_pode('documento.emitir')
  );

drop policy if exists documentos_upload_morador on storage.objects;
create policy documentos_upload_morador on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = public.jwt_condominio()::text
    and (storage.foldername(name))[2] = 'chamados'
    and public.jwt_pode('chamado.abrir')
  );

-- ─────────────────────────────────────────────────────────────────
-- G) Aprovação é barrada no BANCO (esconder botão não é controle)
--    lancamentos: aprovado/rejeitado exige financeiro.aprovar;
--                 pago exige financeiro.baixar;
--    penalidades: aprovada/cancelada/lancada exige multa.aprovar.
--    Baixas via RPC entram como service_role e passam direto.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.exigir_permissao_decisao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.jwt_role() = 'service_role' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;

  if tg_table_name = 'lancamentos' then
    if new.status in ('aprovado','rejeitado') and not public.jwt_pode('financeiro.aprovar') then
      raise exception 'Seu perfil não pode aprovar ou rejeitar lançamentos.' using errcode = '42501';
    end if;
    if new.status = 'pago' and not public.jwt_pode('financeiro.baixar') then
      raise exception 'Seu perfil não pode dar baixa em pagamentos.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'penalidades' then
    /* só a DECISÃO após a defesa. 'lancada' fica fora de propósito: é o
       "Enviar ao responsável", cuja parte sensível (emitir a cobrança) já
       é barrada pela policy de `cobrancas` → cobranca.emitir. Exigir
       multa.aprovar aqui faria o envio falhar no meio, depois da cobrança
       já inserida. */
    if new.status in ('aprovada','cancelada') and not public.jwt_pode('multa.aprovar') then
      raise exception 'Seu perfil não pode decidir multas.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_lancamentos_decisao on public.lancamentos;
create trigger trg_lancamentos_decisao before update on public.lancamentos
  for each row execute function public.exigir_permissao_decisao();

drop trigger if exists trg_penalidades_decisao on public.penalidades;
create trigger trg_penalidades_decisao before update on public.penalidades
  for each row execute function public.exigir_permissao_decisao();

-- ─────────────────────────────────────────────────────────────────
-- H) Guarda granular nas RPCs, por EMBRULHO
--    O corpo real é renomeado para <nome>__base (uma vez) e o nome
--    público vira um embrulho que checa a permissão e delega. Assim o
--    corpo continua vivendo no arquivo que o define (fundo-reserva,
--    planilha-sync, schema) — nada é copiado para cá.
--    Re-rodar é seguro: o embrulho é reconhecido pelo marcador no corpo.
--    __base é revogado de todo mundo: o único caminho é o embrulho.
-- ─────────────────────────────────────────────────────────────────

-- H1) registrar_pagamento_manual → financeiro.baixar
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'registrar_pagamento_manual'
               and p.prosrc not like '%__permissoes_embrulho__%') then
    drop function if exists public.registrar_pagamento_manual__base(
      uuid, forma_pagamento, numeric, timestamptz, text, varchar, uuid);
    alter function public.registrar_pagamento_manual(
      uuid, forma_pagamento, numeric, timestamptz, text, varchar, uuid)
      rename to registrar_pagamento_manual__base;
  end if;
end $$;

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
  return public.registrar_pagamento_manual__base(
    p_cobranca_id, p_forma, p_valor, p_pago_em, p_justificativa, p_tx, p_informado_id);
end $$;

-- H2) cancelar_cobranca → cobranca.cancelar
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'cancelar_cobranca'
               and p.prosrc not like '%__permissoes_embrulho__%') then
    drop function if exists public.cancelar_cobranca__base(uuid, text);
    alter function public.cancelar_cobranca(uuid, text) rename to cancelar_cobranca__base;
  end if;
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
        return public.cancelar_cobranca__base(p_cobranca_id, p_justificativa);
      end $corpo$;
    $f$;
  else
    raise notice '[permissoes] cancelar_cobranca não existe — rode supabase-planilha-sync.sql e repita este arquivo.';
  end if;
end $$;

-- H3) rejeitar_pagamento_informado → financeiro.baixar
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rejeitar_pagamento_informado'
               and p.prosrc not like '%__permissoes_embrulho__%') then
    drop function if exists public.rejeitar_pagamento_informado__base(uuid, text);
    alter function public.rejeitar_pagamento_informado(uuid, text)
      rename to rejeitar_pagamento_informado__base;
  end if;
end $$;

create or replace function public.rejeitar_pagamento_informado(
  p_informado_id uuid,
  p_motivo       text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  -- __permissoes_embrulho__
  if public.jwt_role() <> 'service_role' and not public.jwt_pode('financeiro.baixar') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  return public.rejeitar_pagamento_informado__base(p_informado_id, p_motivo);
end $$;

-- o corpo real sai do alcance do navegador: só o embrulho é chamável
do $$
declare f text;
begin
  for f in
    select format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%\_\_base'
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function public.registrar_pagamento_manual(
  uuid, forma_pagamento, numeric, timestamptz, text, varchar, uuid) to anon, authenticated;
grant execute on function public.rejeitar_pagamento_informado(uuid, text) to anon, authenticated;

-- ═══════════════════════ FIM ═══════════════════════
-- Confira com:
--   select pf.nome, count(*) from perfil_permissoes pp
--     join perfis pf on pf.id = pp.perfil_id
--    where pp.condominio_id is null group by 1 order by 1;
--   -- esperado: administradora 1 · morador 3 · sindico 21 · tesouraria 12
