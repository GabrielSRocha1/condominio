-- ═══════════════════════════════════════════════════════════════
-- O ADMINISTRADOR OPERA COMO O DIRETOR — MENOS O QUE É DO DIRETOR
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- `administrador_predial` (rótulo "Administrador") é o perfil de quem
-- administra o prédio por contrato. Ele enxerga e escreve como o diretor, e
-- o que ele faz VALE NA HORA — criar, alterar e excluir, sem segunda
-- assinatura. O síndico opera do mesmo jeito.
--
-- São quatro as exceções, e nenhuma delas é um código de permissão
-- (02/11/2026, decisão do usuário):
--   1. não CRIA acesso de Diretor — api/auth/acessos.js, por PERFIL de quem
--      pede (um diretor novo decidiria a matriz e removeria quem o criou);
--   2. não EXCLUI acesso de Diretor — mesmo arquivo, e a conta de diretor
--      nem aparece na listagem dele;
--   3. não EXCLUI a pessoa ligada ao Diretor — seção E deste arquivo, por
--      gatilho, porque esse caminho sai direto do navegador;
--   4. não vê a tela PLANOS — `tela.planos` e `licenca.gerir` ficam fora do
--      conjunto dele e são vedadas em src/lib/permissoes.js. As duas são
--      uma exceção só: sem a segunda o Paywall ainda mostraria o botão de
--      pagar. Licença e plano são do dono do condomínio.
--
-- ── A FILA DE APROVAÇÃO ESTÁ INSTALADA E INERTE ──
-- Até 02/11/2026 este arquivo fazia outra coisa: um gatilho CANCELAVA cada
-- escrita do administrador (e do síndico) e a guardava em
-- `alteracoes_pendentes` até o diretor aprovar na tela Aprovações. A
-- mecânica inteira continua aqui — tabela, 18 gatilhos, embrulhos de RPC,
-- aprovar/rejeitar — porque:
--   · os dados já enfileirados são PRESERVADOS (nenhuma linha é apagada);
--   · voltar atrás é uma linha: devolva perfis a `perfis_sob_aprovacao()`
--     (seção A0) e o desvio re-arma por inteiro, no banco e no app.
-- O que desliga tudo é aquela lista estar VAZIA. A tela Aprovações saiu do
-- menu (CondoMasterPro.jsx) e as pendências abertas ficam congeladas: não
-- aprove nada por SQL sem ler a seção D.
--
-- Por que as três exceções de código vivem fora do banco, e a terceira
-- dentro: ~29 pontos de escrita do app saem direto do navegador com o JWT
-- do usuário. Onde o caminho é um endpoint com service role (acessos,
-- stripe), a guarda fica no endpoint, que é o único caminho. Onde o caminho
-- é o supabase-js do navegador — excluir pessoa —, checar na tela seria
-- teatro: o administrador abriria o console e escreveria igual, porque o
-- RLS libera (ele TEM `dados.escrever`). Aí só gatilho resolve.
--
-- Depende de supabase-permissoes.sql (usa jwt_pode/jwt_perfil). Rode DEPOIS
-- dele. Sem este arquivo nada muda: o perfil não existe e o app segue igual.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- A0) O INTERRUPTOR — quem opera sob aprovação
--     Lista única, consultada pelo gatilho (seção C), pelos três embrulhos
--     de RPC (C4) e pelas RPCs de decisão (D). Espelhada em
--     PERFIS_SOB_APROVACAO de src/lib/aprovacoes.js E de
--     src/lib/permissoes.js (o backend não carrega o primeiro módulo) — a
--     sonda compara os três e falha se divergirem.
--
--     VAZIA desde 02/11/2026: ninguém opera sob aprovação. Acrescentar um
--     perfil aqui re-arma o desvio inteiro — mas aí os dois espelhos JS têm
--     de voltar junto, senão a tela promete o que o banco não faz (ou o
--     contrário, que é pior: a escrita é cancelada e a tela diz "salvo").
--     Era: array['administrador_predial', 'sindico'].
--
--     O cast é obrigatório: `array[]` puro não compila (o Postgres não tem
--     como saber o tipo de um array vazio).
-- ─────────────────────────────────────────────────────────────────
create or replace function public.perfis_sob_aprovacao() returns text[]
language sql immutable as $$ select array[]::text[] $$;
grant execute on function public.perfis_sob_aprovacao() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- A) Perfil e permissões
-- ─────────────────────────────────────────────────────────────────
insert into public.perfis (nome, descricao, sistema) values
  ('administrador_predial', 'Administra o prédio: opera como o diretor, menos licença e acesso de diretor', true)
on conflict (nome) do update set descricao = excluded.descricao, atualizado_em = now();

insert into public.permissoes (codigo, descricao) values
  ('alteracao.aprovar', 'Aprovar, corrigir ou rejeitar alterações pendentes')
on conflict (codigo) do update set descricao = excluded.descricao, atualizado_em = now();

/* O PAPEL da pessoa no condomínio (`pessoa_vinculos.papel`) e o PERFIL de
   acesso são eixos separados: o papel diz o que a pessoa É no prédio, o
   perfil diz o que a conta dela PODE. Diretor, síndico e tesouraria já
   existiam como papel; o administrador predial faltava, e sem ele a tela
   Pessoas não tinha como registrar quem de fato administra o prédio.
   `add value` é idempotente aqui pela checagem — repetir sem ela seria erro. */
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'vinculo_papel' and e.enumlabel = 'administrador_predial'
  ) then
    alter type public.vinculo_papel add value 'administrador_predial';
  end if;
end $$;

/* Conjunto do administrador: 26 dos 33 códigos do catálogo — todas as telas
   de operação e todas as escritas, inclusive `financeiro.baixar` e
   `cobranca.cancelar`, que entraram em 02/11/2026 (sem fila, não havia mais
   motivo para segurá-las; `pagamento.rejeitar` não tem código próprio, a RPC
   dela exige financeiro.baixar).
   FORA, de propósito:
     · `tela.planos` + `licenca.gerir` — a 4ª exceção. Licença e plano são do
       dono do condomínio, e as duas andam juntas: o Paywall decide por
       `licenca.gerir`, o menu por `tela.planos`;
     · `alteracao.aprovar` — a fila está congelada e esse código passou a ser
       indelegável (`fixo: true` em src/lib/permissoes.js, e o veto por perfil
       dentro de aprovar/rejeitar_alteracao, seção D);
     · `permissao.gerir` e `saas.gerir` — indelegáveis por catálogo;
     · `tela.portal` e `pagamento.informar` — são do morador.
   Espelho exato de MATRIZ_PADRAO.administrador_predial (src/lib/permissoes.js);
   scripts/testar-permissoes.mjs compara os dois lados. */
create or replace view public._padrao_administrador as
select c as codigo from unnest(array[
  'tela.dashboard','tela.condominio','tela.unidades','tela.pessoas','tela.financeiro',
  'tela.cobrancas','tela.multas','tela.comunicados','tela.documentos','tela.chamados',
  'tela.portaria','tela.acessos',
  -- Reservas e Assembleias (09/11/2026): ele opera como o diretor
  'tela.reservas','tela.assembleias','reserva.decidir',
  'condominio.editar','unidade.criar','financeiro.lancar','financeiro.aprovar',
  'financeiro.baixar','cobranca.emitir','cobranca.cancelar',
  'multa.registrar','multa.aprovar','comunicado.publicar',
  'documento.emitir','chamado.abrir','dados.escrever','acesso.gerir']) c;
revoke all on public._padrao_administrador from anon, authenticated;

insert into public.perfil_permissoes (condominio_id, perfil_id, permissao_id)
select null, pf.id, pm.id
from public._padrao_administrador d
join public.perfis pf     on pf.nome = 'administrador_predial'
join public.permissoes pm on pm.codigo = d.codigo
on conflict do nothing;

delete from public.perfil_permissoes pp
using public.perfis pf, public.permissoes pm
where pp.condominio_id is null and pf.id = pp.perfil_id and pm.id = pp.permissao_id
  and pf.nome = 'administrador_predial'
  and not exists (select 1 from public._padrao_administrador d where d.codigo = pm.codigo);

/* `alteracao.aprovar` é INDELEGÁVEL, não só "não dada por padrão": com a
   fila congelada, deixar alguém decidir pendência é dar a ele o poder de
   aplicar escritas antigas sem ninguém olhando. O código continua no
   catálogo porque as RPCs da seção D o exigem, mas:
     · `fixo: true` em src/lib/permissoes.js tira do editor de permissões e
       faz sanearPerms descartá-lo para todo perfil;
     · aprovar/rejeitar_alteracao vetam por PERFIL (seção D);
     · e as concessões que já existirem no banco saem aqui — inclusive
       override de condomínio, porque a linha vive na mesma tabela.
   O diretor não depende de linha nenhuma: jwt_pode devolve tudo para ele. */
delete from public.perfil_permissoes pp
using public.permissoes pm
where pm.id = pp.permissao_id and pm.codigo = 'alteracao.aprovar';

-- ─────────────────────────────────────────────────────────────────
-- B) A fila
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.alteracoes_pendentes (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references public.condominios(id) on delete cascade,
  /* operacao = INSERT/UPDATE/DELETE → `tabela` é a tabela e `payload` é a
     linha. operacao = ACAO → `tabela` carrega o CÓDIGO DA AÇÃO
     ('financeiro.baixar', 'cobranca.cancelar', …) e `payload` são os
     argumentos da RPC. Ver a seção C2. */
  tabela         varchar(63) not null,
  operacao       varchar(6)  not null check (operacao in ('INSERT','UPDATE','DELETE','ACAO')),
  alvo_id        uuid,                       -- linha afetada (UPDATE/DELETE/ACAO)
  payload        jsonb not null,             -- linha proposta (NEW), a que sairia (OLD) ou os args da ação
  anterior       jsonb,                      -- OLD, para o diff na tela
  resumo         varchar(200),               -- texto curto para a lista
  /* on delete set null: a fila guarda HISTÓRICO, e histórico não pode
     impedir o diretor de remover um acesso. Sem isso, tirar o acesso de
     um administrador que deixou pendências falha com erro de chave
     estrangeira — e ele continua entrando. Perde-se o nome, não o fato. */
  solicitado_por uuid references public.usuarios(id) on delete set null,
  solicitado_em  timestamptz not null default now(),
  status         varchar(10) not null default 'pendente'
                 check (status in ('pendente','aprovada','rejeitada')),
  decidido_por   uuid references public.usuarios(id) on delete set null,
  decidido_em    timestamptz,
  parecer        varchar(400),
  aplicado       jsonb,                      -- o que o diretor REALMENTE aplicou
  erro           varchar(400)                -- falha ao aplicar (fica pendente)
);
create index if not exists alteracoes_pendentes_fila
  on public.alteracoes_pendentes (condominio_id, status, solicitado_em desc);

/* instalações que já criaram a tabela não ganham nem o `on delete set null`
   nem a operação ACAO pelo create acima (ele é if not exists) — refaz aqui */
do $$
begin
  alter table public.alteracoes_pendentes
    drop constraint if exists alteracoes_pendentes_operacao_check;
  alter table public.alteracoes_pendentes
    add constraint alteracoes_pendentes_operacao_check
      check (operacao in ('INSERT','UPDATE','DELETE','ACAO'));
  alter table public.alteracoes_pendentes
    drop constraint if exists alteracoes_pendentes_solicitado_por_fkey,
    drop constraint if exists alteracoes_pendentes_decidido_por_fkey;
  alter table public.alteracoes_pendentes
    add constraint alteracoes_pendentes_solicitado_por_fkey
      foreign key (solicitado_por) references public.usuarios(id) on delete set null,
    add constraint alteracoes_pendentes_decidido_por_fkey
      foreign key (decidido_por) references public.usuarios(id) on delete set null;
end $$;

alter table public.alteracoes_pendentes enable row level security;
drop policy if exists alteracoes_leitura on public.alteracoes_pendentes;
/* qualquer perfil de gestão do condomínio LÊ a fila (o administrador
   precisa ver o que mandou); escrita, só pelas RPCs abaixo */
create policy alteracoes_leitura on public.alteracoes_pendentes for select to authenticated
  using (condominio_id = public.jwt_condominio());

-- ─────────────────────────────────────────────────────────────────
-- C) O gatilho que desvia
--    INERTE desde 02/11/2026: a segunda checagem do corpo consulta
--    perfis_sob_aprovacao(), que está vazia (seção A0), então toda escrita
--    passa direto. Continua instalado nas 18 tabelas de propósito — é o que
--    faz a volta atrás ser uma linha, sem re-rodar DDL em tabela nenhuma.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.desviar_para_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_linha    jsonb;
  v_anterior jsonb;
  v_cond     uuid;
  v_alvo     uuid;
  v_resumo   text;
begin
  -- backend (service role) e qualquer outro perfil passam direto
  if public.jwt_role() = 'service_role' then return coalesce(new, old); end if;
  if not (public.jwt_perfil() = any(public.perfis_sob_aprovacao())) then
    return coalesce(new, old);
  end if;

  /* Escrita feita por OUTRO GATILHO (profundidade > 1) é CONSEQUÊNCIA de
     uma operação já aceita — sincronização planilha ⇄ cobranças, feed de
     movimentações, saldo do fundo. Ninguém decidiu isso: decidiu-se a
     operação que a disparou. Enfileirar encheria a tela do diretor com
     efeitos colaterais que ele não escolheu e, pior, quebraria a
     sincronização no meio do caminho (a linha da planilha nunca apontaria
     para a cobrança que acabou de nascer). */
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  /* ── O QUE NÃO ESPERA ──────────────────────────────────────────────
     Montar o prédio é trabalho operacional do administrador: o diretor
     quer ver as unidades prontas, não aprovar apartamento por apartamento.
     ALTERAR e EXCLUIR continuam esperando SEMPRE, em toda tabela — o risco
     não está no cadastro novo, está no que muda de valor ou some.

     `blocos` entra por MECÂNICA, não por escolha: criar unidade cria o
     bloco junto, e um bloco preso na fila deixaria a unidade apontando
     para uma linha que não existe — a chave estrangeira recusaria na hora.
     Espelhado em IMEDIATAS (src/lib/aprovacoes.js); a sonda compara os dois. */
  if tg_op = 'INSERT' and tg_table_name in
     ('blocos', 'unidades', 'pessoas', 'pessoa_vinculos') then
    return new;
  end if;

  /* Cobrança do administrador NASCE RASCUNHO: entra na lista do diretor na
     hora, mas o portal do morador e o checkout não a enxergam até ele
     emitir. Forçado AQUI, e não na tela, porque a escrita sai do navegador
     com o JWT dele — pela tela ele mandaria 'emitida' pelo console e a
     cobrança chegaria ao morador sem ninguém ter olhado.
     O UPDATE continua na fila, então rascunho→emitida não é dele. */
  if tg_op = 'INSERT' and tg_table_name = 'cobrancas' then
    new.status := 'rascunho';
    return new;
  end if;

  /* Fração ideal é consequência ARITMÉTICA de uma unidade já aceita, não
     decisão: o app refaz o rateio de todas as unidades a cada inclusão.
     Enfileirar encheria a tela do diretor com N pendências por unidade
     criada, nenhuma delas uma escolha dele. Qualquer outro campo que mude
     junto tira a linha desta exceção e ela volta para a fila. */
  if tg_op = 'UPDATE' and tg_table_name = 'unidades'
     and (to_jsonb(new) - 'fracao_ideal' - 'atualizado_em')
       = (to_jsonb(old) - 'fracao_ideal' - 'atualizado_em') then
    return new;
  end if;

  v_linha    := to_jsonb(coalesce(new, old));
  v_anterior := case when old is null then null else to_jsonb(old) end;

  /* condomínio da linha, para escopar a fila:
       · `condominios` guarda em `id`;
       · `penalidade_provas` e `comunicado_destinatarios` NÃO têm a coluna —
         e consultar a mãe não serve, porque ela pode estar na fila também
         (ainda não existe). Nesses dois casos vale o condomínio da SESSÃO:
         o RLS já impede o administrador de tocar em linha de outro prédio,
         então não há como forjar escopo por aqui.
       · nas demais, a própria coluna — conferida contra a sessão. */
  if tg_table_name = 'condominios' then
    v_cond := (v_linha ->> 'id')::uuid;
  elsif tg_table_name in ('penalidade_provas', 'comunicado_destinatarios') then
    v_cond := public.jwt_condominio();
  else
    v_cond := (v_linha ->> 'condominio_id')::uuid;
  end if;
  if v_cond is null or v_cond is distinct from public.jwt_condominio() then
    raise exception 'Alteração fora do seu condomínio.' using errcode = '42501';
  end if;

  v_alvo := case when old is null then null else (to_jsonb(old) ->> 'id')::uuid end;
  v_resumo := left(coalesce(
    v_linha ->> 'nome', v_linha ->> 'nome_fantasia', v_linha ->> 'titulo',
    v_linha ->> 'descricao', v_linha ->> 'numero', v_linha ->> 'competencia', ''), 200);

  insert into public.alteracoes_pendentes
    (condominio_id, tabela, operacao, alvo_id, payload, anterior, resumo, solicitado_por)
  values
    (v_cond, tg_table_name, tg_op, v_alvo, v_linha, v_anterior, nullif(v_resumo, ''),
     public.jwt_usuario());

  return null; -- CANCELA a operação original: a linha não nasce/muda/some
end $$;

/* Tabelas cobertas. Lista EXPLÍCITA (e não "tudo que tem condominio_id")
   para que incluir uma tabela nova seja uma decisão, não um acidente. */
do $$
declare t text;
begin
  foreach t in array array[
    'condominios','blocos','unidades','vagas','pessoas','pessoa_vinculos',
    'categorias_financeiras','fundos','lancamentos','cobrancas','penalidades',
    'penalidade_provas','comunicados','comunicado_destinatarios','documentos',
    'chamados','planilhas_cobranca','planilha_cobranca_linhas']
  loop
    if to_regclass('public.' || t) is null then
      raise notice '[aprovacoes] tabela % não existe — pulada.', t;
      continue;
    end if;
    execute format('drop trigger if exists trg_aprovacao on public.%I', t);
    execute format(
      'create trigger trg_aprovacao before insert or update or delete on public.%I
       for each row execute function public.desviar_para_aprovacao()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- C2) AÇÕES DE RPC na fila — também INERTE (ver A0)
--
-- Os três embrulhos consultam perfis_sob_aprovacao(), hoje vazia, então as
-- RPCs vão direto ao corpo real. O desenho fica documentado porque é o que
-- volta a valer se a lista voltar a ter gente.
--
-- Baixar pagamento, cancelar cobrança e rejeitar pagamento informado NÃO
-- são uma escrita só: cada uma mexe em pagamentos, cobranças, lançamentos
-- e fundos dentro de uma RPC. O gatilho ALCANÇA essas escritas (jwt_perfil
-- lê o claim, e SECURITY DEFINER não troca o claim) — e é justamente por
-- isso que deixá-las correr seria pior que bloquear: `pagamentos` não está
-- na lista coberta e entraria, enquanto a baixa da cobrança ficaria na
-- fila. Resultado: pagamento registrado numa cobrança que continua em
-- aberto. Estado corrompido, não "pendente".
--
-- Então a ação inteira vira UMA pendência, antes de qualquer escrita:
-- `operacao = 'ACAO'`, `tabela` = o código da ação, `payload` = os
-- argumentos. Na aprovação o diretor chama o corpo real (__base) com os
-- argumentos — podendo corrigir o valor antes, como em qualquer pendência.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.enfileirar_acao(
  p_acao text, p_args jsonb, p_resumo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cond uuid := public.jwt_condominio();
begin
  if v_cond is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_condominio');
  end if;
  insert into public.alteracoes_pendentes
    (condominio_id, tabela, operacao, alvo_id, payload, resumo, solicitado_por)
  values
    (v_cond, p_acao, 'ACAO', nullif(p_args ->> 'cobranca_id', '')::uuid,
     p_args, left(p_resumo, 200), public.jwt_usuario());
  /* `na_fila` é o que a tela lê para dizer "enviado ao diretor" em vez de
     "pronto" — o ok:true sozinho seria uma mentira educada */
  return jsonb_build_object('ok', true, 'na_fila', true);
end $$;
grant execute on function public.enfileirar_acao(text, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- C3) REMOVER ACESSO — hoje sem uso corrente, mantida pelo passivo
--
-- Enquanto a fila valia, o endpoint /api/auth/acessos (que roda com SERVICE
-- ROLE, onde o gatilho nem dispara) enfileirava a remoção por conta própria
-- — operacao = 'ACAO', tabela = 'acesso.remover' — e não removia nada; quem
-- removia era esta função, chamada por executar_acao na aprovação, com o
-- token do diretor e na mesma transação, para que "aprovada" e "removida"
-- nunca divergissem.
--
-- Desde 02/11/2026 o endpoint remove na hora e não enfileira mais nada.
-- A função fica por duas razões: pendências 'acesso.remover' que já estavam
-- abertas continuam no banco (congeladas), e sem ela aprovar uma delas por
-- SQL falharia com erro cru em vez de executar; e porque re-armar a fila é
-- uma linha na seção A0, que traria este caminho de volta inteiro.
--
-- Não tem guarda de permissão própria: ela é inalcançável de fora (revoke
-- abaixo, e executar_acao também revogada). Quem confere quem pode é
-- aprovar_alteracao, um nível acima — hoje só o diretor.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.remover_acesso__base(p_usuario_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cond   uuid := public.jwt_condominio();
  v_perfis text[];
  v_pessoa uuid;
begin
  if v_cond is null or p_usuario_id is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_condominio');
  end if;
  /* o alvo tem de ser acesso DESTE condomínio — a pendência pode ter sido
     criada muito antes, e nada garante que a conta ainda esteja lá */
  select array_agg(pf.nome) into v_perfis
    from public.usuario_perfis up
    join public.perfis pf on pf.id = up.perfil_id
   where up.usuario_id = p_usuario_id and up.condominio_id = v_cond;
  if v_perfis is null then
    return jsonb_build_object('ok', false, 'erro', 'acesso_inexistente');
  end if;
  /* a conta do diretor não sai por aqui: é ela que aprova. E ninguém se
     remove a si mesmo — seria o condomínio ficando sem quem aprova. */
  if 'diretor' = any(v_perfis) then
    return jsonb_build_object('ok', false, 'erro', 'diretor_nao_removivel');
  end if;
  if p_usuario_id = public.jwt_usuario() then
    return jsonb_build_object('ok', false, 'erro', 'nao_remove_a_si_mesmo');
  end if;

  select pessoa_id into v_pessoa from public.usuarios where id = p_usuario_id;

  /* derruba as sessões vivas: sem isto o JWT de 1h continua valendo depois
     de a conta sumir. A tabela vem do supabase-seguranca.sql — instalação
     sem ela não tem sessão para derrubar. */
  if to_regclass('public.auth_sessoes') is not null then
    execute 'update public.auth_sessoes set revogada = true where usuario_id = $1'
      using p_usuario_id;
  end if;

  delete from public.usuario_perfis where usuario_id = p_usuario_id and condominio_id = v_cond;
  /* RAISE (não return) de propósito: o erro sobe para aprovar_alteracao,
     que desfaz o que já foi apagado e deixa a pendência aberta com o
     motivo à vista. Devolver ok:false aqui deixaria a conta sem perfil —
     viva, sem conseguir entrar e sem ninguém ter decidido isso. */
  begin
    delete from public.usuarios where id = p_usuario_id;
  exception when foreign_key_violation then
    raise exception 'Esta conta assinou operações do condomínio (cobranças, multas, comunicados ou portaria) e apagá-la apagaria esse histórico. Troque a senha dela em Gerenciar Acessos.'
      using errcode = '23503';
  end;

  if v_pessoa is not null then
    delete from public.pessoa_vinculos where pessoa_id = v_pessoa and condominio_id = v_cond;
    /* a PESSOA é outro eixo: ela pode ser responsável de unidade, ter
       cobrança ou multa. Sai só se nada mais a referenciar — o que o
       diretor aprovou foi tirar o acesso, não apagar o histórico. */
    begin
      delete from public.pessoas where id = v_pessoa;
    exception when foreign_key_violation then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'usuario_id', p_usuario_id);
end $$;
revoke all on function public.remover_acesso__base(uuid) from public, anon, authenticated;

/* Executa a ação aprovada. Allowlist EXPLÍCITA: `tabela` vem de uma linha
   do banco e nunca pode virar nome de função executável — por isso um
   `case` fechado, e não `execute format(...)`. */
create or replace function public.executar_acao(p_acao text, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_acao = 'acesso.remover' then
    return public.remover_acesso__base((p_args ->> 'usuario_id')::uuid);
  elsif p_acao = 'financeiro.baixar' then
    return public.registrar_pagamento_manual__base(
      (p_args ->> 'cobranca_id')::uuid,
      (p_args ->> 'forma')::forma_pagamento,
      (p_args ->> 'valor')::numeric,
      (p_args ->> 'pago_em')::timestamptz,
      p_args ->> 'justificativa',
      (nullif(p_args ->> 'tx', ''))::varchar,
      nullif(p_args ->> 'informado_id', '')::uuid);
  elsif p_acao = 'cobranca.cancelar' then
    return public.cancelar_cobranca__base(
      (p_args ->> 'cobranca_id')::uuid, p_args ->> 'justificativa');
  elsif p_acao = 'pagamento.rejeitar' then
    return public.rejeitar_pagamento_informado__base(
      (p_args ->> 'informado_id')::uuid, p_args ->> 'motivo');
  end if;
  raise exception 'Ação desconhecida na fila: %', p_acao using errcode = '22023';
end $$;

/* REVOKE obrigatório, não higiene: o Supabase concede execute em função
   nova a anon/authenticated por default privilege. Sem isto, qualquer
   logado chama executar_acao('financeiro.baixar', …) direto do navegador e
   o SECURITY DEFINER roda o corpo real — a fila inteira viraria enfeite, e
   com 'acesso.remover' na allowlist ele apagaria contas sem aprovação
   nenhuma. Só aprovar_alteracao (definer, um nível acima) a alcança. */
revoke all on function public.executar_acao(text, jsonb) from public, anon, authenticated;

/* Embrulhos: mantêm a checagem de permissão de supabase-permissoes.sql
   (marcador __permissoes_embrulho__, que impede o rename para __base lá) e
   acrescentam o desvio para a fila.
   ATENÇÃO: re-rodar supabase-permissoes.sql REFAZ estes embrulhos SEM o
   desvio — rode este arquivo depois dele, sempre. */
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
  -- __aprovacao_embrulho__
  if public.jwt_perfil() = any(public.perfis_sob_aprovacao()) then
    return public.enfileirar_acao('financeiro.baixar', jsonb_build_object(
      'cobranca_id', p_cobranca_id, 'forma', p_forma, 'valor', p_valor,
      'pago_em', p_pago_em, 'justificativa', p_justificativa,
      'tx', p_tx, 'informado_id', p_informado_id),
      'baixa de ' || coalesce(p_valor::text, '?'));
  end if;
  return public.registrar_pagamento_manual__base(
    p_cobranca_id, p_forma, p_valor, p_pago_em, p_justificativa, p_tx, p_informado_id);
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
        -- __aprovacao_embrulho__
        if public.jwt_perfil() = any(public.perfis_sob_aprovacao()) then
          return public.enfileirar_acao('cobranca.cancelar', jsonb_build_object(
            'cobranca_id', p_cobranca_id, 'justificativa', p_justificativa), p_justificativa);
        end if;
        return public.cancelar_cobranca__base(p_cobranca_id, p_justificativa);
      end $corpo$;
    $f$;
  else
    raise notice '[aprovacoes] cancelar_cobranca__base não existe — rode supabase-planilha-sync.sql e supabase-permissoes.sql, depois repita este arquivo.';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rejeitar_pagamento_informado__base') then
    execute $f$
      create or replace function public.rejeitar_pagamento_informado(
        p_informado_id uuid, p_motivo text
      ) returns jsonb
      language plpgsql security definer set search_path = public as $corpo$
      begin
        -- __permissoes_embrulho__
        if public.jwt_role() <> 'service_role' and not public.jwt_pode('financeiro.baixar') then
          return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
        end if;
        -- __aprovacao_embrulho__
        if public.jwt_perfil() = any(public.perfis_sob_aprovacao()) then
          return public.enfileirar_acao('pagamento.rejeitar', jsonb_build_object(
            'informado_id', p_informado_id, 'motivo', p_motivo), p_motivo);
        end if;
        return public.rejeitar_pagamento_informado__base(p_informado_id, p_motivo);
      end $corpo$;
    $f$;
  else
    raise notice '[aprovacoes] rejeitar_pagamento_informado__base não existe — rode supabase-permissoes.sql e repita este arquivo.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- D) Aplicar / rejeitar (só quem tem alteracao.aprovar — o diretor)
--    O diretor aplica com o PRÓPRIO token: o gatilho nem dispara para ele.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.aprovar_alteracao(
  p_id       uuid,
  p_correcao jsonb default null,   -- campos que o diretor quis corrigir
  p_parecer  text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        public.alteracoes_pendentes%rowtype;
  v_final  jsonb;
  v_res    jsonb;
  v_cols   text;
  v_cols_r text;
begin
  /* SÓ O DIRETOR decide pendência, e isto é cravado por PERFIL, não pela
     matriz. Era `jwt_perfil() = any(perfis_sob_aprovacao())` — com a lista
     vazia (seção A0) essa metade virou inerte e sobraria só o jwt_pode, que
     uma linha inserida à mão em perfil_permissoes derrubaria. Com a fila
     congelada, aprovar pendência antiga é aplicar escrita sem ninguém
     olhando: o poder fica com quem já tem tudo. */
  if public.jwt_perfil() <> 'diretor'
     or not public.jwt_pode('alteracao.aprovar') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  select * into a from public.alteracoes_pendentes where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'inexistente'); end if;
  if a.condominio_id is distinct from public.jwt_condominio() then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  if a.status <> 'pendente' then
    return jsonb_build_object('ok', true, 'ja_decidida', true, 'status', a.status);
  end if;

  -- correção do diretor sobrepõe o que o solicitante mandou
  v_final := a.payload || coalesce(p_correcao, '{}'::jsonb);

  /* AÇÃO (baixa, cancelamento, rejeição): não há linha a montar — o corpo
     real da RPC faz o trabalho inteiro, com os argumentos já corrigidos.
     Se ele devolver ok:false, a pendência CONTINUA aberta com o motivo à
     vista: "cobrança já paga" não pode virar um carimbo de aprovada. */
  if a.operacao = 'ACAO' then
    begin
      v_res := public.executar_acao(a.tabela, v_final);
    exception when others then
      update public.alteracoes_pendentes set erro = left(sqlerrm, 400) where id = p_id;
      return jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar', 'detalhe', left(sqlerrm, 400));
    end;
    if coalesce(v_res ->> 'ok', 'false') <> 'true' then
      update public.alteracoes_pendentes
         set erro = left(coalesce(v_res ->> 'erro', 'recusada'), 400) where id = p_id;
      return jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar',
                                'detalhe', coalesce(v_res ->> 'erro', 'recusada'));
    end if;
    update public.alteracoes_pendentes
       set status = 'aprovada', decidido_por = public.jwt_usuario(), decidido_em = now(),
           parecer = left(p_parecer, 400), aplicado = v_final, erro = null
     where id = p_id;
    return jsonb_build_object('ok', true, 'operacao', 'ACAO', 'acao', a.tabela,
                              'corrigida', p_correcao is not null and p_correcao <> '{}'::jsonb);
  end if;

  /* colunas da tabela alvo, menos a chave: jsonb_populate_record parte da
     linha ATUAL e sobrepõe só o que vier no jsonb, então campo ausente não
     é zerado e o tipo de cada coluna é respeitado sem cast manual */
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols, v_cols_r
  from information_schema.columns
  where table_schema = 'public' and table_name = a.tabela and column_name <> 'id';

  begin
    if a.operacao = 'INSERT' then
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
        a.tabela, a.tabela) using v_final;
    elsif a.operacao = 'UPDATE' then
      execute format(
        'update public.%I as t set (%s) = (select %s from jsonb_populate_record(t::public.%I, $1) as r)
          where t.id = $2', a.tabela, v_cols, v_cols_r, a.tabela) using v_final, a.alvo_id;
    else
      execute format('delete from public.%I where id = $1', a.tabela) using a.alvo_id;
    end if;
  exception when others then
    /* a alteração CONTINUA pendente com o motivo à vista — melhor que
       sumir da fila dando a impressão de que foi aplicada */
    update public.alteracoes_pendentes
       set erro = left(sqlerrm, 400) where id = p_id;
    return jsonb_build_object('ok', false, 'erro', 'falha_ao_aplicar', 'detalhe', left(sqlerrm, 400));
  end;

  update public.alteracoes_pendentes
     set status = 'aprovada', decidido_por = public.jwt_usuario(), decidido_em = now(),
         parecer = left(p_parecer, 400), aplicado = v_final, erro = null
   where id = p_id;

  return jsonb_build_object('ok', true, 'operacao', a.operacao, 'tabela', a.tabela,
                            'corrigida', p_correcao is not null and p_correcao <> '{}'::jsonb);
end $$;

create or replace function public.rejeitar_alteracao(
  p_id uuid, p_parecer text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alteracoes_pendentes%rowtype;
begin
  /* SÓ O DIRETOR decide pendência, e isto é cravado por PERFIL, não pela
     matriz. Era `jwt_perfil() = any(perfis_sob_aprovacao())` — com a lista
     vazia (seção A0) essa metade virou inerte e sobraria só o jwt_pode, que
     uma linha inserida à mão em perfil_permissoes derrubaria. Com a fila
     congelada, aprovar pendência antiga é aplicar escrita sem ninguém
     olhando: o poder fica com quem já tem tudo. */
  if public.jwt_perfil() <> 'diretor'
     or not public.jwt_pode('alteracao.aprovar') then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  select * into a from public.alteracoes_pendentes where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'inexistente'); end if;
  if a.condominio_id is distinct from public.jwt_condominio() then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  if a.status <> 'pendente' then
    return jsonb_build_object('ok', true, 'ja_decidida', true, 'status', a.status);
  end if;
  update public.alteracoes_pendentes
     set status = 'rejeitada', decidido_por = public.jwt_usuario(), decidido_em = now(),
         parecer = left(p_parecer, 400)
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.aprovar_alteracao(uuid, jsonb, text) to authenticated;
grant execute on function public.rejeitar_alteracao(uuid, text)       to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- E) A PESSOA DO DIRETOR não sai pela mão de quem não é diretor
--
-- Esta é a 3ª exceção, e a única que precisa de gatilho. As outras duas de
-- acesso (não cria, não exclui conta de diretor) vivem em
-- api/auth/acessos.js, que roda com service role e é o ÚNICO caminho para
-- `usuarios`/`usuario_perfis` — o navegador não escreve nessas duas tabelas
-- (supabase-seguranca.sql revoga a escrita; usuario_perfis só tem policy de
-- leitura). Já `pessoas` e `pessoa_vinculos` o navegador escreve direto:
-- caem no coringa `dados.escrever` pelo laço de supabase-permissoes.sql, e o
-- administrador TEM essa permissão. Enquanto a fila existia, quem segurava
-- era o desvio cancelar o DELETE. Com a fila inerte, o freio volta aqui.
--
-- Protege pelas DUAS ligações (escolha do usuário, 02/11/2026):
--   · o PAPEL no prédio   — pessoa_vinculos.papel = 'diretor';
--   · o PERFIL de acesso  — pessoas → usuarios.pessoa_id → usuario_perfis
--                           → perfis.nome = 'diretor'.
--
-- Cobre `pessoa_vinculos` no UPDATE e no DELETE, não só `pessoas`, por dois
-- motivos independentes: rebaixar o papel e excluir em seguida seria a rota
-- de fuga óbvia; e removerPessoa (src/lib/api.js) apaga os VÍNCULOS antes da
-- pessoa, em duas chamadas sem transação — proteger só `pessoas` deixaria o
-- vínculo do diretor morrer e só então a exclusão falhar.
--
-- O que este gatilho NÃO faz, de propósito: impedir EDIÇÃO. Alterar os dados
-- da pessoa do diretor (nome, telefone, unidade) continua valendo na hora —
-- a exceção que o usuário pediu é sobre excluir. No UPDATE do vínculo só o
-- rebaixamento do papel é barrado; a ligação B só vale no DELETE.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.proteger_pessoa_de_diretor() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pessoa uuid;
begin
  /* SQL Editor/psql (sem claim nenhum) e backend passam. O bypass de service
     role NÃO é higiene: api/auth/acessos.js apaga pessoa_vinculos e pessoas
     com service role quando um DIRETOR remove o acesso de OUTRO diretor —
     é a única forma legítima de apagar a pessoa de um diretor, e barrá-la
     aqui a mataria. A autorização ali já foi conferida no endpoint. */
  if nullif(current_setting('request.jwt.claims', true), '') is null
     or public.jwt_role() = 'service_role' then return coalesce(new, old); end if;
  /* o diretor é o dono: a regra é "quem NÃO é diretor não mexe no diretor".
     Critério por PERFIL, como em podeCriarPerfil — não existe código de
     permissão para isto justamente porque não deve ser delegável. Isentar o
     diretor é a mesma regra anti-trava do resto do produto: o dono nunca
     pode ficar sem conseguir corrigir o próprio cadastro. */
  if public.jwt_perfil() = 'diretor' then return coalesce(new, old); end if;

  /* ── ligação A, o PAPEL ──
     Os ramos são ANINHADOS, não uma condição só com `and`/`case`: OLD é um
     record e o campo é resolvido na execução da expressão — `old.papel` num
     gatilho de `pessoas` estouraria com "record old has no field papel"
     mesmo que o lado esquerdo do `and` fosse falso. */
  if tg_table_name = 'pessoa_vinculos' then
    /* o próprio OLD responde, sem consulta. Os ramos de tg_op também são
       aninhados: em DELETE o NEW não está atribuído, e tocá-lo estouraria
       com "record new is not assigned yet". */
    if old.papel::text = 'diretor' then
      /* DELETE entra porque removerPessoa apaga o vínculo ANTES da pessoa
         (ver cabeçalho): sem isto, o diretor perderia o papel e só então a
         exclusão falharia. */
      if tg_op = 'DELETE' then
        raise exception 'O vínculo de diretor do condomínio só o próprio diretor remove.'
          using errcode = '42501';
      /* no UPDATE só o REBAIXAMENTO é barrado — seria a fuga óbvia (tiro o
         papel, depois excluo). Editar a pessoa do diretor continua valendo
         na hora: atualizarPessoa reescreve `papel` em toda gravação, e
         barrar o UPDATE inteiro impediria até corrigir o telefone dele. */
      elsif new.papel::text <> 'diretor' then
        raise exception 'Tirar o papel de diretor do condomínio é do próprio diretor.'
          using errcode = '42501';
      end if;
    end if;
    v_pessoa := old.pessoa_id;
  else
    v_pessoa := old.id;
    if exists (select 1 from public.pessoa_vinculos v
                where v.pessoa_id = v_pessoa and v.papel::text = 'diretor') then
      raise exception 'Esta pessoa é diretor do condomínio — só um diretor pode excluí-la.'
        using errcode = '42501';
    end if;
  end if;

  /* ── ligação B, a CONTA com perfil diretor ──
     Só na EXCLUSÃO, de propósito: a exceção que o usuário pediu é sobre
     excluir, e editar continua valendo na hora — barrar UPDATE aqui
     impediria o administrador de corrigir até a unidade do diretor. A rota
     de fuga "rebaixo o papel e depois excluo" segue fechada pela ligação A,
     que cobre o UPDATE do vínculo de diretor.
     Dois passos de propósito: o primeiro toca o índice único de
     usuarios.pessoa_id e descarta quase todos os casos; o join em
     usuario_perfis/perfis só roda para pessoa que TEM conta.
     SECURITY DEFINER é indispensável: supabase-seguranca.sql revoga select
     de `usuarios` para authenticated e a policy restante só atende diretor
     e síndico — sem definer este exists veria nada exatamente para o perfil
     que se quer barrar. (A chave estrangeira usuarios.pessoa_id → pessoas
     já recusa o delete da PESSOA com 23503; esta cláusula serve para dar a
     mensagem certa e para alcançar o VÍNCULO, que a FK não protege.)
     A mensagem não pode conter "foreign key" nem "violates": removerPessoa
     reescreve qualquer erro que case com isso por um texto genérico. */
  if tg_op = 'DELETE'
     and exists (select 1 from public.usuarios u where u.pessoa_id = v_pessoa)
     and exists (
       select 1 from public.usuarios u
         join public.usuario_perfis up on up.usuario_id = u.id
         join public.perfis pf         on pf.id = up.perfil_id
        where u.pessoa_id = v_pessoa and pf.nome = 'diretor') then
    raise exception 'Esta pessoa tem a conta de diretor do condomínio — só um diretor pode removê-la, em Gerenciar Acessos.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end $$;

/* O "_a_" no nome é funcional, não estético: gatilho BEFORE dispara em ordem
   ALFABÉTICA, e 'trg_a_protege_diretor' < 'trg_aprovacao'. Se um dia a lista
   da seção A0 voltar a ter gente, o desvio devolve null e CANCELA a operação
   antes de qualquer gatilho posterior — rodando depois deste guarda, a
   exclusão do diretor é recusada; rodando antes, viraria pendência na fila e
   seria aprovada pelo diretor, que é justamente quem o guarda isenta. */
drop trigger if exists trg_a_protege_diretor on public.pessoas;
create trigger trg_a_protege_diretor before delete on public.pessoas
  for each row execute function public.proteger_pessoa_de_diretor();

drop trigger if exists trg_a_protege_diretor on public.pessoa_vinculos;
create trigger trg_a_protege_diretor before update or delete on public.pessoa_vinculos
  for each row execute function public.proteger_pessoa_de_diretor();

-- ═══════════════════════ FIM ═══════════════════════
-- Confira com:
--   select nome from perfis where nome = 'administrador_predial';
--   -- a fila tem de estar DESARMADA (vazio) e os dados intactos:
--   select public.perfis_sob_aprovacao();                      -- esperado: {}
--   select status, count(*) from alteracoes_pendentes group by status;
--   select count(*) from perfil_permissoes pp join perfis pf on pf.id = pp.perfil_id
--    where pf.nome = 'administrador_predial' and pp.condominio_id is null;  -- esperado: 26
--   -- ninguém, em nenhum condomínio, tem alteracao.aprovar por linha:
--   select count(*) from perfil_permissoes pp join permissoes pm on pm.id = pp.permissao_id
--    where pm.codigo = 'alteracao.aprovar';                    -- esperado: 0
--   -- o mecanismo segue instalado (18 tabelas) e a guarda nova, nas duas:
--   select tgrelid::regclass from pg_trigger where tgname = 'trg_aprovacao' order by 1;
--   select tgrelid::regclass from pg_trigger where tgname = 'trg_a_protege_diretor' order by 1;
--   -- nenhuma das duas pode ter anon/authenticated na ACL:
--   select proname, proacl from pg_proc
--    where proname in ('executar_acao', 'remover_acesso__base');
