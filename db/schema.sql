-- =====================================================================
-- eX Cronograma — Schema de produção (PostgreSQL / Supabase)
-- Versão 1.0  |  17/06/2026
--
-- Princípios de longevidade (à prova de migração):
--  - IDs UUID estáveis (nunca reusados)
--  - created_at / updated_at em tudo; exclusão SUAVE (deleted_at)
--  - Integridade referencial por chaves estrangeiras
--  - Tabela schema_version para evoluir sem perder dado
--  - Listas controladas (funcoes, niveis, categorias) => zero erro de digitação
--  - Exportável a qualquer momento (pg_dump / CSV) — sem lock-in
--
-- Aplicar no Supabase: SQL Editor -> colar este arquivo -> Run.
-- =====================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------- controle de versão do schema ----------
create table if not exists schema_version (
  versao      text primary key,
  aplicado_em timestamptz not null default now(),
  descricao   text
);
insert into schema_version (versao, descricao)
values ('1.0', 'Estrutura inicial de produção') on conflict do nothing;

-- ---------- gatilho updated_at (reutilizável) ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- =====================================================================
-- LISTAS CONTROLADAS (globais)
-- =====================================================================
create table funcoes (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ordem      int  not null default 0,
  ativo      bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table niveis (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ordem      int  not null default 0,
  ativo      bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table categorias (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  icone      text,
  ordem      int  not null default 0,
  ativo      bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- =====================================================================
-- COLABORADORES (e suas funções/valores — multi-linha)
-- =====================================================================
create table colaboradores (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  gera_custo  bool not null default true,   -- false = cliente/fabricante
  ativo       bool not null default true,
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- cada linha = função + nível + valor/hora próprio (um colaborador tem várias)
create table colaborador_funcoes (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id) on delete cascade,
  funcao_id       uuid not null references funcoes(id),
  nivel_id        uuid references niveis(id),
  valor_hora      numeric(12,2),            -- null = pendente
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =====================================================================
-- CATÁLOGO DE SERVIÇOS (serviço + variações)
-- =====================================================================
create table servicos (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  categoria_id uuid not null references categorias(id),
  unidade      text not null default 'UND',
  observacao   text,
  ativo        bool not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table servico_variacoes (
  id               uuid primary key default gen_random_uuid(),
  servico_id       uuid not null references servicos(id) on delete cascade,
  nome             text not null,           -- a "dificuldade"
  horas_por_unidade numeric(10,3) not null default 0,
  ordem            int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- =====================================================================
-- PROJETOS / OBRAS
-- =====================================================================
create type status_projeto as enum ('em_andamento','aguardando','concluido','suspenso');

create table projetos (
  id               uuid primary key default gen_random_uuid(),
  numero_externo   text,                    -- vem de outro sistema
  nome             text not null,
  contratante      text,                    -- quem contrata/paga (ex: Copeland)
  contemplado      text,                    -- onde executa (ex: Atacadão 906)
  local            text,                    -- cidade/UF
  endereco         text,                    -- endereço completo da unidade
  localizacao      text,                    -- coordenadas ou link de mapa
  lider_id         uuid references colaboradores(id),
  gestor           text,                    -- gestor da execução (loja)
  data_inicio      date,
  data_fim_prevista date,
  status           status_projeto not null default 'aguardando',
  observacoes      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- =====================================================================
-- GRUPOS (tarefas-pai) e TAREFAS
-- =====================================================================
create table grupos (
  id             uuid primary key default gen_random_uuid(),
  projeto_id     uuid not null references projetos(id) on delete cascade,
  nome           text not null,
  categoria_id   uuid references categorias(id),  -- filtra serviços
  responsavel_id uuid references colaboradores(id), -- responsável do grupo (sem custo)
  ordem          int not null default 0,
  aberto         bool not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create type status_tarefa as enum ('a_fazer','em_andamento','concluida','congelada');
create type prioridade_tarefa as enum ('alta','media','baixa');

create table tarefas (
  id                    uuid primary key default gen_random_uuid(),
  projeto_id            uuid not null references projetos(id) on delete cascade,
  grupo_id              uuid not null references grupos(id) on delete cascade,
  nivel                 int  not null default 1,   -- 1 = tarefa, 2 = subtarefa
  is_header             bool not null default false, -- tarefa-pai agrupadora (sem serviço/custo)
  servico_id            uuid references servicos(id),
  variacao_id           uuid references servico_variacoes(id),
  nome                  text not null,
  quantidade            numeric(12,3) not null default 1,
  unidade               text,
  tempo_previsto        numeric(10,3) not null default 0, -- baseline, editável só no cadastro
  tempo_atual           numeric(10,3) not null default 0, -- ajuste de campo
  executor_id           uuid references colaboradores(id),
  colaborador_funcao_id uuid references colaborador_funcoes(id), -- qual valor/hora aplicado
  responsavel_id        uuid references colaboradores(id),       -- gestor da tarefa
  prioridade            prioridade_tarefa not null default 'media',
  progresso             int not null default 0 check (progresso between 0 and 100),
  status                status_tarefa not null default 'a_fazer',
  data_inicio           date,
  data_fim_prevista     date,
  data_fim_real         date,                                    -- previsto x realizado
  notas                 text,
  ordem                 int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

-- =====================================================================
-- MATERIAIS (2ª fase) — catálogo genérico + lista por tarefa
-- =====================================================================
create table materiais (
  id               uuid primary key default gen_random_uuid(),
  sku              text,                    -- código interno
  codigo_barras    text,                    -- EAN/UPC (lido pela câmera)
  qr_code          text,                    -- conteúdo do QR (lido pela câmera)
  nome             text not null,
  descricao        text,
  unidade          text not null default 'UND',
  categoria_material text,
  fabricante       text,
  ativo            bool not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index on materiais (codigo_barras);
create index on materiais (qr_code);

create type status_material_tarefa as enum ('planejado','adquirir','adquirido','utilizado');

create table tarefa_materiais (
  id                   uuid primary key default gen_random_uuid(),
  tarefa_id            uuid not null references tarefas(id) on delete cascade,
  material_id          uuid not null references materiais(id),
  quantidade_prevista  numeric(12,3) not null default 0, -- lista padrão
  quantidade_utilizada numeric(12,3) not null default 0, -- preenchido em campo
  status               status_material_tarefa not null default 'planejado',
  observacao           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- =====================================================================
-- ÍNDICES (performance com volume) e GATILHOS updated_at
-- =====================================================================
create index on colaborador_funcoes (colaborador_id);
create index on servico_variacoes (servico_id);
create index on grupos (projeto_id);
create index on tarefas (projeto_id);
create index on tarefas (grupo_id);
create index on tarefa_materiais (tarefa_id);
create index on tarefa_materiais (material_id);

do $$
declare t text;
begin
  foreach t in array array[
    'funcoes','niveis','categorias','colaboradores','colaborador_funcoes',
    'servicos','servico_variacoes','projetos','grupos','tarefas',
    'materiais','tarefa_materiais'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- =====================================================================
-- Pronto. Próximo: db/seed.sql (listas iniciais) e wiring do app.
-- =====================================================================
