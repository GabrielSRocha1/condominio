-- ═══════════════════════════════════════════════════════════════
-- RLS POR CONDOMÍNIO (produção) — substitui a política aberta de dev.
--
-- Como usar: Supabase → SQL Editor → colar e executar (idempotente).
--
-- Modelo: o login (funções /api/auth) emite um JWT com as claims
--   condominio_id  → prédio da conta logada
--   perfil         → diretor | sindico | tesouraria | administradora | morador
-- O navegador envia esse token; o banco então só enxerga/aceita linhas
-- do próprio condomínio. A service_role (backend) ignora RLS.
--
-- Regras:
--   · tabelas com condominio_id  → leitura/escrita só do próprio prédio;
--     escrita restrita aos perfis de gestão (morador só lê + abre chamados)
--   · condominios                → vê/edita só o próprio (admin. vê todos)
--   · usuarios (senhas!)         → só contas vinculadas ao próprio prédio
--   · filhas sem condominio_id   → herdam o escopo da tabela-mãe
--   · saas_planos/perfis/permissoes → referência, leitura liberada
--   · INSERT de condominios e de usuarios "pendentes" → só via backend
-- ═══════════════════════════════════════════════════════════════

-- Claims do token ------------------------------------------------
create or replace function public.jwt_condominio() returns uuid
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'condominio_id', ''), '')::uuid
$$;

create or replace function public.jwt_perfil() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'perfil', '')
$$;

-- Remove TODAS as políticas atuais (inclusive dev_acesso_total) ---
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Tabelas com condominio_id --------------------------------------
do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'condominio_id'
      and table_name not in ('condominios')
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    -- leitura: qualquer perfil do próprio condomínio
    execute format(
      'create policy tenant_select on public.%I for select to authenticated
       using (condominio_id = public.jwt_condominio())', t.table_name);
    -- escrita: perfis de gestão do próprio condomínio
    execute format(
      'create policy tenant_escrita on public.%I for all to authenticated
       using (condominio_id = public.jwt_condominio()
              and public.jwt_perfil() in (''diretor'',''sindico'',''tesouraria''))
       with check (condominio_id = public.jwt_condominio()
              and public.jwt_perfil() in (''diretor'',''sindico'',''tesouraria''))', t.table_name);
  end loop;
end $$;

-- Morador pode abrir chamados do próprio prédio
create policy morador_abre_chamado on public.chamados for insert to authenticated
  with check (condominio_id = public.jwt_condominio() and public.jwt_perfil() = 'morador');

-- Administradora (dona do SaaS) lê o que o painel precisa
create policy admin_select on public.unidades for select to authenticated
  using (public.jwt_perfil() = 'administradora');
create policy admin_select on public.saas_assinaturas for select to authenticated
  using (public.jwt_perfil() = 'administradora');

-- condominios ----------------------------------------------------
alter table public.condominios enable row level security;
create policy cond_select on public.condominios for select to authenticated
  using (id = public.jwt_condominio() or public.jwt_perfil() = 'administradora');
create policy cond_update on public.condominios for update to authenticated
  using (id = public.jwt_condominio() and public.jwt_perfil() = 'diretor')
  with check (id = public.jwt_condominio());
-- insert: apenas backend (service_role)

-- usuarios (guarda hash de senha — o mais sensível) ---------------
alter table public.usuarios enable row level security;
create policy usuarios_tenant on public.usuarios for all to authenticated
  using (exists (select 1 from public.pessoas p
                 where p.id = usuarios.pessoa_id and p.condominio_id = public.jwt_condominio())
         and public.jwt_perfil() in ('diretor','sindico'))
  with check (exists (select 1 from public.pessoas p
                 where p.id = usuarios.pessoa_id and p.condominio_id = public.jwt_condominio()));
-- contas "pendentes" (pessoa_id nulo) não aparecem para ninguém: só backend

-- Filhas sem condominio_id: herdam o escopo da mãe ----------------
alter table public.penalidade_provas enable row level security;
create policy provas_tenant on public.penalidade_provas for all to authenticated
  using (exists (select 1 from public.penalidades x
                 where x.id = penalidade_provas.penalidade_id and x.condominio_id = public.jwt_condominio()))
  with check (exists (select 1 from public.penalidades x
                 where x.id = penalidade_provas.penalidade_id and x.condominio_id = public.jwt_condominio()));

alter table public.comunicado_destinatarios enable row level security;
create policy dest_tenant on public.comunicado_destinatarios for all to authenticated
  using (exists (select 1 from public.comunicados x
                 where x.id = comunicado_destinatarios.comunicado_id and x.condominio_id = public.jwt_condominio()))
  with check (exists (select 1 from public.comunicados x
                 where x.id = comunicado_destinatarios.comunicado_id and x.condominio_id = public.jwt_condominio()));

alter table public.envios_log enable row level security;
create policy envios_tenant on public.envios_log for select to authenticated
  using (exists (select 1 from public.notificacoes x
                 where x.id = envios_log.notificacao_id and x.condominio_id = public.jwt_condominio()));

-- Referência: leitura livre, escrita nenhuma ----------------------
do $$
declare t text;
begin
  foreach t in array array['saas_planos','perfis','permissoes','perfil_permissoes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy ref_select on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
