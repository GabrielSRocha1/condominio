-- ═══════════════════════════════════════════════════════════════
-- HISTÓRICO DE COBRANÇAS POR PLANILHA
-- Rode no SQL Editor do Supabase (um único RUN, idempotente).
--
-- O que este arquivo faz:
--   A) planilhas_cobranca        → a planilha do condomínio: nome e a
--      DEFINIÇÃO das colunas (jsonb), espelhando o arquivo que o gestor
--      subiu. Uma por condomínio: a segunda carga ACRESCENTA linhas na
--      mesma tabela, com dedupe por unidade + competência.
--   B) planilha_cobranca_linhas  → uma linha por linha da planilha, com
--      os valores em jsonb (dados) e as três colunas RESOLVIDAS que a
--      conciliação usa: unidade_id, competencia e cobranca_id.
--
-- Por que jsonb: as colunas são as do arquivo de cada condomínio — não
-- há esquema fixo a modelar. A conciliação não depende do jsonb: ela usa
-- unidade_id + competencia, que a importação resolve e grava em coluna
-- de verdade (com índice).
--
-- Esta planilha NÃO é a verdade do financeiro: a cobrança criada a
-- partir dela NÃO gera lançamento no caixa (decisão de produto: o saldo
-- do dashboard segue refletindo só o que o app recebeu). Com o
-- supabase-planilha-sync.sql (arquivo seguinte da ordem), ela passa a
-- REFLETIR as cobranças: pagamento carimba a linha, a baixa indevida
-- cancela a cobrança (e zera a linha) e cobrança nova vira linha.
--
-- RLS: as policies deste arquivo espelham exatamente o loop do
-- supabase-rls.sql (tenant_select para todo perfil do condomínio;
-- tenant_escrita para diretor/síndico/tesouraria), com os MESMOS nomes.
-- Por isso NÃO é preciso re-rodar o supabase-rls.sql — e, se um dia ele
-- for re-executado, recria o equivalente por conta própria.
--
-- Sem este RUN o app continua funcionando: a aba "Histórico (planilha)"
-- da tela Cobranças mostra o aviso para rodar este arquivo, e nada mais
-- muda.
-- ═══════════════════════════════════════════════════════════════

-- A) Definição da planilha ----------------------------------------
create table if not exists planilhas_cobranca (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  nome           varchar(120) not null,
  -- [{ chave, titulo, tipo: texto|numero|data, papel, ordem, formato?, calculada? }]
  -- papel: unidade|competencia|valor|valor_base|percentual_fr|taxa_mora|meses|ano
  --        |pago|vencimento|status (ou ausente)
  -- formato: percent|moeda (ausente = automático) — percent em escala humana (10 = 10%)
  -- calculada v1: { esq, op, dir } — A op B; operando = chave de coluna OU número fixo
  -- calculada v2: { modelo: "mora", saida: monto|interes|total, base,
  --   fr|taxa|meses: {col}|{num}, regime: simples|composto, incluiFr,
  --   verifica?, tol? } — cálculo de expensas + fundo de reserva + juros,
  --   com os parâmetros do reglamento ajustáveis (meses {col, dinamico:true}:
  --   célula vazia conta competência→hoje; preenchida trava no digitado)
  colunas        jsonb not null default '[]'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (condominio_id)
);

-- B) Linhas --------------------------------------------------------
create table if not exists planilha_cobranca_linhas (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references condominios(id),
  planilha_id    uuid not null references planilhas_cobranca(id) on delete cascade,
  dados          jsonb not null default '{}'::jsonb,   -- { chave_da_coluna: valor }
  unidade_id     uuid references unidades(id),         -- resolvido na importação
  competencia    char(7) check (competencia is null or competencia ~ '^\d{4}-\d{2}$'),
  cobranca_id    uuid references cobrancas(id) on delete set null,  -- preenchido ao criar/casar a cobrança
  origem         varchar(20) not null default 'planilha',  -- planilha | manual
  ordem          integer not null default 0,           -- posição na planilha (ordem de exibição)
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  -- dedupe da 2ª carga: mesma unidade + competência atualiza em vez de
  -- duplicar. NULL é distinto de NULL em unique do Postgres, então linha
  -- sem unidade/competência resolvidas (ex.: uma totalizadora da planilha
  -- original) nunca conflita — e a prévia a sinaliza.
  -- É constraint, não índice parcial, porque o upsert do PostgREST só
  -- infere o conflito a partir de um unique SEM predicado.
  unique (planilha_id, unidade_id, competencia)
);
create index if not exists idx_planilha_linhas_planilha on planilha_cobranca_linhas (planilha_id, ordem);
create index if not exists idx_planilha_linhas_cond on planilha_cobranca_linhas (condominio_id);

-- C) RLS — espelha o loop do supabase-rls.sql ----------------------
alter table planilhas_cobranca        enable row level security;
alter table planilha_cobranca_linhas  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['planilhas_cobranca', 'planilha_cobranca_linhas']
  loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format(
      'create policy tenant_select on public.%I for select to authenticated
       using (condominio_id = public.jwt_condominio())', t);
    execute format('drop policy if exists tenant_escrita on public.%I', t);
    execute format(
      'create policy tenant_escrita on public.%I for all to authenticated
       using (condominio_id = public.jwt_condominio()
              and public.jwt_perfil() in (''diretor'',''sindico'',''tesouraria''))
       with check (condominio_id = public.jwt_condominio()
              and public.jwt_perfil() in (''diretor'',''sindico'',''tesouraria''))', t);
  end loop;
end $$;

-- D) Auditoria da planilha (só a tabela-mãe) -----------------------
-- Importação e mudança de colunas são eventos raros e relevantes. A
-- edição de célula NÃO é auditada de propósito: uma sessão de trabalho
-- gravaria milhares de eventos e afogaria a trilha.
-- Guardado por um IF: sem o supabase-seguranca3.sql (auditoria_eventos)
-- este bloco é pulado, e o resto do arquivo continua valendo.
do $$
begin
  if to_regclass('public.auditoria_eventos') is null then
    raise notice 'auditoria_eventos ausente (rode o supabase-seguranca3.sql) — trigger de auditoria da planilha nao criado';
    return;
  end if;

  execute $f$
    create or replace function public.auditoria_planilha() returns trigger
    language plpgsql security definer set search_path = public as $body$
    begin
      insert into auditoria_eventos (evento, severidade, usuario_id, condominio_id, detalhe)
        values (case when tg_op = 'INSERT' then 'planilha_criada' else 'planilha_atualizada' end,
                'info', public.jwt_usuario(), new.condominio_id,
                jsonb_build_object('planilha_id', new.id, 'nome', new.nome,
                                   'colunas', jsonb_array_length(new.colunas)));
      return new;
    end $body$;
  $f$;

  drop trigger if exists trg_auditoria_planilha on planilhas_cobranca;
  create trigger trg_auditoria_planilha
    after insert or update on planilhas_cobranca
    for each row execute function public.auditoria_planilha();
end $$;

-- Verificação rápida (opcional):
--   select count(*) from planilhas_cobranca;
--   select count(*) from planilha_cobranca_linhas;
