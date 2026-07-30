-- ═══════════════════════════════════════════════════════════════
-- STORAGE: bucket "documentos" (todos os uploads do app)
--
-- Como usar: Supabase → SQL Editor → colar e executar (idempotente).
--
-- Modelo: os arquivos são gravados em <condominio_id>/<pasta>/<uuid>.<ext>,
-- onde <pasta> é pessoas · identidade · notas-fiscais · provas · chamados.
-- A política de escrita exige que a primeira pasta do caminho seja o
-- condominio_id do token (mesmas claims do supabase-rls.sql): perfis de
-- gestão escrevem em qualquer pasta; morador só em chamados/ (foto do
-- chamado do portal). A leitura é pública (as URLs ficam nas tabelas).
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', true, 26214400, -- 25 MB (provas podem ser vídeo/áudio)
        array['image/png','image/jpeg','image/webp','image/heic','image/gif','application/pdf',
              'video/mp4','video/quicktime','video/webm','video/3gpp',
              'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Escrita: perfis de gestão, somente dentro da pasta do próprio condomínio
drop policy if exists documentos_upload on storage.objects;
create policy documentos_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = public.jwt_condominio()::text
    and public.jwt_perfil() in ('diretor','sindico','tesouraria')
  );

-- Morador: só pode subir arquivo para a pasta chamados/ do próprio condomínio
drop policy if exists documentos_upload_morador on storage.objects;
create policy documentos_upload_morador on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = public.jwt_condominio()::text
    and (storage.foldername(name))[2] = 'chamados'
    and public.jwt_perfil() = 'morador'
  );

-- Leitura via API (a URL pública já funciona por o bucket ser public)
drop policy if exists documentos_select on storage.objects;
create policy documentos_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'documentos');

-- Remoção/substituição: mesmos perfis de gestão, mesma pasta
drop policy if exists documentos_delete on storage.objects;
create policy documentos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documentos'
    and (storage.foldername(name))[1] = public.jwt_condominio()::text
    and public.jwt_perfil() in ('diretor','sindico','tesouraria')
  );
