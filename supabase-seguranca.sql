-- ═══════════════════════════════════════════════════════════════
-- SEGURANÇA — Etapa 1: autenticação, sessões e blindagem de dados.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que este arquivo faz:
--   A) auth_sessoes    → refresh tokens com ROTAÇÃO (JWT de acesso passa a
--      durar 1h; o cookie HttpOnly renova a sessão por até 30 dias; roubo
--      de refresh token é detectado pelo reuso e derruba a família inteira)
--   B) auth_protecao   → contadores de força bruta/rate-limit (lockout de
--      login, limite de registro por IP e da verificação cripto on-chain)
--   C) usuarios        → o navegador NUNCA mais lê senha_hash (grant por
--      coluna) e NUNCA mais escreve na tabela (criação/remoção de acessos
--      migrou para /api/auth/acessos, com service role)
--   D) usuario_perfis  → escrita só pelo backend (fecha a escalação de
--      privilégio em que síndico/tesouraria podiam se promover a diretor)
--
-- Sem nada disso rodado o app continua funcionando (os endpoints degradam
-- com aviso no log), mas as proteções só valem depois deste RUN.
-- ═══════════════════════════════════════════════════════════════

-- A) Sessões de refresh (rotação + detecção de reuso) --------------
create table if not exists auth_sessoes (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references usuarios(id) on delete cascade,
  familia        uuid not null,                 -- cadeia de rotação (1 login = 1 família)
  token_hash     varchar(64) not null unique,   -- sha256 do refresh token (nunca o token puro)
  perfil         varchar(30) not null,
  condominio_id  uuid,
  expira_em      timestamptz not null,
  usado_em       timestamptz,                   -- preenchido na rotação; reuso = roubo
  revogada       boolean not null default false,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_auth_sessoes_usuario on auth_sessoes (usuario_id);
create index if not exists idx_auth_sessoes_familia on auth_sessoes (familia);

alter table auth_sessoes enable row level security;
-- sem policies: só a service role dos endpoints /api/auth enxerga

-- B) Proteção contra força bruta / rate-limit ----------------------
create table if not exists auth_protecao (
  chave         varchar(160) primary key,       -- ex.: 'login:email@x', 'login:ip:1.2.3.4'
  tentativas    int not null default 0,
  janela_inicio timestamptz not null default now(),
  bloqueado_ate timestamptz
);

alter table auth_protecao enable row level security;
-- sem policies: só a service role

-- contador atômico: incrementa dentro da janela e devolve o estado; o
-- chamador decide o bloqueio (security definer para rodar via RPC do backend)
create or replace function public.registrar_tentativa(
  p_chave        varchar,
  p_janela_seg   int,
  p_max          int,
  p_bloqueio_seg int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r auth_protecao%rowtype;
begin
  insert into auth_protecao (chave, tentativas, janela_inicio)
    values (p_chave, 1, now())
  on conflict (chave) do update set
    tentativas    = case when auth_protecao.janela_inicio < now() - make_interval(secs => p_janela_seg)
                         then 1 else auth_protecao.tentativas + 1 end,
    janela_inicio = case when auth_protecao.janela_inicio < now() - make_interval(secs => p_janela_seg)
                         then now() else auth_protecao.janela_inicio end
  returning * into r;

  if r.bloqueado_ate is not null and r.bloqueado_ate > now() then
    return jsonb_build_object('bloqueado', true, 'ate', r.bloqueado_ate);
  end if;

  if r.tentativas >= p_max then
    update auth_protecao set bloqueado_ate = now() + make_interval(secs => p_bloqueio_seg)
      where chave = p_chave;
    return jsonb_build_object('bloqueado', true, 'ate', now() + make_interval(secs => p_bloqueio_seg));
  end if;

  return jsonb_build_object('bloqueado', false, 'tentativas', r.tentativas, 'restantes', p_max - r.tentativas);
end $$;

revoke all on function public.registrar_tentativa(varchar, int, int, int) from public, anon, authenticated;
grant execute on function public.registrar_tentativa(varchar, int, int, int) to service_role;

-- sucesso zera o contador (login correto limpa o lockout do e-mail)
create or replace function public.limpar_tentativas(p_chave varchar) returns void
language sql security definer set search_path = public as $$
  delete from auth_protecao where chave = p_chave;
$$;
revoke all on function public.limpar_tentativas(varchar) from public, anon, authenticated;
grant execute on function public.limpar_tentativas(varchar) to service_role;

-- C) usuarios: navegador só lê colunas inofensivas, nunca escreve ---
--    (a criação/remoção de acessos passou para /api/auth/acessos)
drop policy if exists usuarios_tenant on public.usuarios;
create policy usuarios_select on public.usuarios for select to authenticated
  using (exists (select 1 from public.pessoas p
                 where p.id = usuarios.pessoa_id and p.condominio_id = public.jwt_condominio())
         and public.jwt_perfil() in ('diretor','sindico'));

-- grant por coluna: senha_hash fica invisível para o client (o PostgREST
-- devolve erro se alguém pedir a coluna; a service role não é afetada)
revoke select, insert, update, delete on table public.usuarios from anon, authenticated;
grant select (id, email, pessoa_id, criado_em) on table public.usuarios to authenticated;

-- D) usuario_perfis: leitura do tenant, escrita SÓ backend ----------
--    (remove a tenant_escrita criada pelo laço genérico do supabase-rls.sql)
drop policy if exists tenant_escrita on public.usuario_perfis;

-- ═══════════════════════════════════════════════════════════════
-- Verificação rápida (opcional):
--   select public.registrar_tentativa('teste:probe', 60, 5, 60);  -- deve responder bloqueado=false
--   select public.limpar_tentativas('teste:probe');
--   -- Como authenticated: select senha_hash from usuarios limit 1;  -- deve FALHAR
-- ═══════════════════════════════════════════════════════════════
