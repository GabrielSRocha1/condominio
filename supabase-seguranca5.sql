-- ═══════════════════════════════════════════════════════════════
-- SEGURANÇA — Etapa 5: recuperação de senha por LINK DE E-MAIL
-- (diretor e síndico). Rode no SQL Editor do Supabase (um único RUN,
-- idempotente).
--
-- O que muda em relação à Etapa 4:
--   · DIRETOR e SÍNDICO deixam de usar código de recuperação: em
--     "Esqueci minha senha" informam o e-mail da conta e recebem um
--     LINK de redefinição (POST /api/auth/esqueci envia por SMTP
--     próprio — envs SMTP_HOST/PORT/USER/PASS), válido por 60 minutos
--     e de uso único. O POST /api/auth/redefinir consome o token,
--     regrava a senha em scrypt e revoga todas as sessões vivas
--     (auth_sessoes) da conta;
--   · TESOURARIA e MORADOR continuam exatamente como na Etapa 4
--     (código permanente próprio + código de 24h gerado pelo diretor).
--
-- O que este arquivo faz:
--   A) coluna auth_recuperacao.canal — distingue o que a linha guarda:
--      'codigo' (padrão; todas as linhas existentes) ou 'email' (token
--      do link). Só o sha256 do token vai ao banco — o token puro
--      viaja uma única vez, na URL dentro do e-mail. Um token de
--      e-mail ativo por conta: pedir de novo substitui o anterior.
--   B) índice por codigo_hash — /api/auth/redefinir localiza o token
--      direto pelo hash (o link não carrega a identidade da conta).
--   C) higiene da transição: apaga códigos AINDA NÃO USADOS de contas
--      de diretor e de síndico (inclui contas sem perfil — diretor
--      recém-cadastrado). Os endpoints já recusam código para esses
--      perfis; isto só remove hashes que nunca mais seriam aceitos.
--
-- Sem este RUN o app continua funcionando (esqueci/redefinir
-- respondem 503 com aviso) — apenas a recuperação por e-mail fica
-- indisponível.
-- ═══════════════════════════════════════════════════════════════

-- A) canal: 'codigo' (tesouraria/morador) | 'email' (diretor/síndico)
alter table auth_recuperacao
  add column if not exists canal varchar(12) not null default 'codigo';
do $$ begin
  alter table auth_recuperacao
    add constraint auth_recuperacao_canal_chk check (canal in ('codigo', 'email'));
exception when duplicate_object then null; end $$;

-- B) busca do token do link pelo hash (uso único, prazo curto)
create index if not exists idx_auth_recuperacao_hash on auth_recuperacao (codigo_hash);

-- C) transição: códigos não usados de diretor/síndico morrem agora
delete from auth_recuperacao ar
 where ar.usado_em is null
   and ar.canal = 'codigo'
   and (
     exists (select 1
               from usuario_perfis up
               join perfis p on p.id = up.perfil_id
              where up.usuario_id = ar.usuario_id
                and p.nome in ('diretor', 'sindico'))
     or not exists (select 1 from usuario_perfis up
                     where up.usuario_id = ar.usuario_id)
   );

-- ═══════════════════════════════════════════════════════════════
-- Verificação rápida (opcional):
--   select canal, count(*) from auth_recuperacao group by canal;
--   -- linhas antigas aparecem como 'codigo'; nenhum código NÃO USADO
--   -- de diretor/síndico deve restar
-- ═══════════════════════════════════════════════════════════════
