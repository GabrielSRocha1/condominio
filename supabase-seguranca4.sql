-- ═══════════════════════════════════════════════════════════════
-- SEGURANÇA — Etapa 4: recuperação de senha por código.
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que este arquivo faz:
--   A) auth_recuperacao → códigos de recuperação de senha de uso único.
--      Não há provedor de e-mail no produto (e o morador nem tem e-mail
--      real), então a recuperação NÃO usa link por e-mail:
--      · AUTONOMIA (caminho principal): logo após entrar, quem ainda não
--        tem código é convidado a gerar o próprio código PERMANENTE
--        (POST /api/auth/codigo, qualquer perfil) — se esquecer a senha,
--        se recupera sozinho, sem acionar o diretor;
--      · plano B: se a pessoa perdeu a senha E o código, o diretor gera
--        um código de 24h em Gerenciar Acessos e o entrega a ela
--        (o diretor não tem plano B — ninguém o reseta; o código
--        permanente dele é a única porta de volta).
--      A pessoa usa o código em "Esqueci minha senha" na tela de entrada
--      (POST /api/auth/recuperar) para definir a senha nova. O uso marca
--      usado_em, regrava senha_hash em scrypt e revoga todas as sessões
--      vivas (auth_sessoes) da conta.
--
-- Só o HASH (sha256) do código é gravado — o código puro aparece uma
-- única vez na tela de quem o gerou. Um código ativo por conta: gerar
-- um novo apaga o anterior ainda não usado.
--
-- Sem este RUN o app continua funcionando (os endpoints respondem 503
-- com aviso) — apenas a recuperação de senha fica indisponível.
-- ═══════════════════════════════════════════════════════════════

-- A) Códigos de recuperação (uso único, hash apenas) ---------------
create table if not exists auth_recuperacao (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references usuarios(id) on delete cascade,
  codigo_hash  varchar(64) not null,          -- sha256 do código (nunca o código puro)
  criado_por   uuid references usuarios(id) on delete set null,
  expira_em    timestamptz,                   -- null = permanente (código do diretor)
  usado_em     timestamptz,                   -- preenchido no uso; código é de uso único
  criado_em    timestamptz not null default now()
);
create index if not exists idx_auth_recuperacao_usuario on auth_recuperacao (usuario_id);

alter table auth_recuperacao enable row level security;
-- sem policies: só a service role dos endpoints /api/auth enxerga

-- ═══════════════════════════════════════════════════════════════
-- Verificação rápida (opcional):
--   select count(*) from auth_recuperacao;  -- deve responder 0 (e não erro)
--   -- Como authenticated: select * from auth_recuperacao;  -- deve voltar vazio (RLS)
-- ═══════════════════════════════════════════════════════════════
