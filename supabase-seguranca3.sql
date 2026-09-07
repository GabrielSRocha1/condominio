-- ═══════════════════════════════════════════════════════════════
-- SEGURANÇA — Etapa 3: trilha de auditoria imutável.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- auditoria_eventos é APPEND-ONLY: um trigger bloqueia UPDATE/DELETE — nem
-- a service role consegue reescrever a história (só expurgo de linhas com
-- mais de 365 dias é permitido, para retenção controlada).
--
-- Quem grava:
--   · endpoints /api (service role): eventos de autenticação — login
--     sucesso/falha/bloqueio, REUSO de refresh token (indício de roubo),
--     logout, conta criada, acesso criado/removido — com IP;
--   · TRIGGERS nas tabelas sensíveis: pagamentos (baixa registrada),
--     pagamentos_informados (informe criado/decidido) e usuario_perfis
--     (perfil concedido/removido). Trigger pega TODOS os caminhos,
--     inclusive as RPCs chamadas direto do navegador pelo gestor.
-- ═══════════════════════════════════════════════════════════════

create table if not exists auditoria_eventos (
  id             uuid primary key default gen_random_uuid(),
  quando         timestamptz not null default now(),
  evento         varchar(60) not null,      -- ex.: login_falha, sessao_reuso_detectado
  severidade     varchar(10) not null default 'info'
                 check (severidade in ('info','aviso','alta')),
  usuario_id     uuid,
  condominio_id  uuid,
  ip             varchar(64),
  detalhe        jsonb
);
create index if not exists idx_auditoria_quando on auditoria_eventos (quando desc);
create index if not exists idx_auditoria_evento on auditoria_eventos (evento, quando desc);
create index if not exists idx_auditoria_cond on auditoria_eventos (condominio_id, quando desc);

alter table auditoria_eventos enable row level security;
-- leitura pelo tenant: gestão vê a trilha do próprio condomínio (telas futuras)
drop policy if exists auditoria_select on auditoria_eventos;
create policy auditoria_select on auditoria_eventos for select to authenticated
  using (condominio_id = public.jwt_condominio()
         and public.jwt_perfil() in ('diretor','sindico'));
-- escrita: nenhuma policy — só service role e triggers (security definer)

-- Imutabilidade: reescrever/apagar história é proibido; expurgo só >365d --
create or replace function public.auditoria_protege() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'auditoria_eventos é append-only — UPDATE proibido';
  end if;
  if old.quando > now() - interval '365 days' then
    raise exception 'auditoria_eventos é append-only — DELETE só para linhas com mais de 365 dias';
  end if;
  return old;
end $$;
drop trigger if exists trg_auditoria_protege on auditoria_eventos;
create trigger trg_auditoria_protege
  before update or delete on auditoria_eventos
  for each row execute function public.auditoria_protege();

create or replace function public.auditoria_protege_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'auditoria_eventos é append-only — TRUNCATE proibido';
end $$;
drop trigger if exists trg_auditoria_protege_truncate on auditoria_eventos;
create trigger trg_auditoria_protege_truncate
  before truncate on auditoria_eventos
  for each statement execute function public.auditoria_protege_truncate();

-- Registrador comum dos triggers (security definer ignora o RLS da tabela) --
create or replace function public.auditoria_registrar(
  p_evento varchar, p_severidade varchar, p_condominio uuid, p_detalhe jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
    values (p_evento, coalesce(p_severidade, 'info'), public.jwt_usuario(), p_condominio, p_detalhe);
$$;
revoke all on function public.auditoria_registrar(varchar, varchar, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.auditoria_registrar(varchar, varchar, uuid, jsonb) to service_role;

-- Triggers das tabelas sensíveis ----------------------------------
create or replace function public.auditoria_pagamentos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
    values ('pagamento_registrado', 'info', coalesce(new.baixado_por, public.jwt_usuario()), new.condominio_id,
            jsonb_build_object('cobranca_id', new.cobranca_id, 'valor', new.valor_pago,
                               'origem', new.origem, 'evento_provider', new.provider_event_id));
  return new;
end $$;
drop trigger if exists trg_auditoria_pagamentos on pagamentos;
create trigger trg_auditoria_pagamentos
  after insert on pagamentos
  for each row execute function public.auditoria_pagamentos();

create or replace function public.auditoria_informes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
      values ('informe_criado', 'info', public.jwt_usuario(), new.condominio_id,
              jsonb_build_object('cobranca_id', new.cobranca_id, 'forma', new.forma,
                                 'valor', new.valor_informado, 'tx_hash', new.tx_hash));
  elsif new.situacao is distinct from old.situacao then
    insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
      values ('informe_' || new.situacao, 'info', public.jwt_usuario(), new.condominio_id,
              jsonb_build_object('cobranca_id', new.cobranca_id, 'motivo', new.motivo_rejeicao));
  end if;
  return new;
end $$;
drop trigger if exists trg_auditoria_informes on pagamentos_informados;
create trigger trg_auditoria_informes
  after insert or update on pagamentos_informados
  for each row execute function public.auditoria_informes();

create or replace function public.auditoria_perfis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
      values ('perfil_concedido', 'aviso', public.jwt_usuario(), new.condominio_id,
              jsonb_build_object('usuario_alvo', new.usuario_id, 'perfil_id', new.perfil_id));
    return new;
  end if;
  insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
    values ('perfil_removido', 'aviso', public.jwt_usuario(), old.condominio_id,
            jsonb_build_object('usuario_alvo', old.usuario_id, 'perfil_id', old.perfil_id));
  return old;
end $$;
drop trigger if exists trg_auditoria_perfis on usuario_perfis;
create trigger trg_auditoria_perfis
  after insert or delete on usuario_perfis
  for each row execute function public.auditoria_perfis();

-- Verificação rápida (opcional):
--   select public.auditoria_registrar('probe', 'info', null, '{"ok":true}'::jsonb);
--   update auditoria_eventos set evento = 'x' where evento = 'probe';  -- deve FALHAR
-- ═══════════════════════════════════════════════════════════════
