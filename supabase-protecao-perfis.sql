-- ═══════════════════════════════════════════════════════════════
-- Proteção contra exclusão acidental dos perfis nativos do sistema
-- (sistema = true). Rode UMA VEZ no SQL Editor do Supabase
-- (Dashboard → SQL Editor → New query → colar → Run).
-- Idempotente: pode rodar de novo sem efeito colateral.
-- Já incluído no supabase-schema.sql para instalações novas.
-- ═══════════════════════════════════════════════════════════════

create or replace function bloquear_delete_perfil_sistema() returns trigger
language plpgsql as $$
begin
  if old.sistema then
    raise exception 'O perfil "%" é nativo do sistema e não pode ser excluído.', old.nome;
  end if;
  return old;
end $$;

drop trigger if exists trg_perfis_protege_sistema on perfis;
create trigger trg_perfis_protege_sistema
  before delete on perfis
  for each row execute function bloquear_delete_perfil_sistema();

-- Teste (opcional): a linha abaixo deve falhar com a mensagem de proteção.
-- delete from perfis where nome = 'diretor';
