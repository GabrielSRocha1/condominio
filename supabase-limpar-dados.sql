-- ═══════════════════════════════════════════════════════════════
-- LIMPA TODOS OS DADOS do CondoMaster Pro (deixa as tabelas vazias,
-- como recém-criadas pelo supabase-schema.sql).
--
-- Como usar: Supabase → SQL Editor → colar e executar.
-- ATENÇÃO: apaga TODOS os registros, sem volta.
--
-- Mantém intactas as 3 tabelas de referência que o próprio schema
-- popula: saas_planos, perfis e permissoes.
-- Para repor os dados de demonstração depois: node scripts/seed.mjs
-- ═══════════════════════════════════════════════════════════════

truncate table
  auditoria,
  acessos_portaria,
  pre_autorizacoes,
  atas,
  assembleias,
  reservas,
  areas_comuns,
  chamados,
  envios_log,
  notificacoes,
  comunicado_destinatarios,
  comunicados,
  penalidade_provas,
  penalidades,
  integracoes_pagamento,
  pagamentos,
  cobrancas,
  documentos,
  lancamentos,
  fundos,
  categorias_financeiras,
  usuario_perfis,
  perfil_permissoes,
  usuarios,
  pessoa_vinculos,
  vagas,
  unidades,
  pessoas,
  blocos,
  saas_assinaturas,
  condominios
restart identity cascade;
