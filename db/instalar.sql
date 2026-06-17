-- =====================================================================
-- eX Cronograma — INSTALAÇÃO COMPLETA (um arquivo só)
-- Faz tudo de uma vez: LIMPA + CRIA + POPULA.
-- É seguro rodar quantas vezes quiser (sempre recomeça limpo).
-- Cole TODO este conteúdo no SQL Editor do Supabase e clique Run.
-- =====================================================================

-- ---------- 1) LIMPEZA (apaga estrutura anterior, se houver) ----------
drop table if exists tarefa_materiais, materiais, tarefas, grupos, projetos,
  servico_variacoes, servicos, colaborador_funcoes, colaboradores,
  categorias, niveis, funcoes, schema_version cascade;
drop type if exists status_projeto, status_tarefa, prioridade_tarefa, status_material_tarefa cascade;
drop function if exists set_updated_at cascade;

create extension if not exists "pgcrypto";

-- ---------- 2) CONTROLE DE VERSÃO ----------
create table schema_version (
  versao      text primary key,
  aplicado_em timestamptz not null default now(),
  descricao   text
);
insert into schema_version (versao, descricao) values ('1.0','Estrutura inicial de produção');

-- ---------- gatilho updated_at ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------- 3) LISTAS CONTROLADAS ----------
create table funcoes (
  id uuid primary key default gen_random_uuid(), nome text not null unique,
  ordem int not null default 0, ativo bool not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

create table niveis (
  id uuid primary key default gen_random_uuid(), nome text not null unique,
  ordem int not null default 0, ativo bool not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

create table categorias (
  id uuid primary key default gen_random_uuid(), nome text not null unique, icone text,
  ordem int not null default 0, ativo bool not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

-- ---------- 4) COLABORADORES ----------
create table colaboradores (
  id uuid primary key default gen_random_uuid(), nome text not null,
  gera_custo bool not null default true, ativo bool not null default true, observacoes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

create table colaborador_funcoes (
  id uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  funcao_id uuid not null references funcoes(id),
  nivel_id uuid references niveis(id),
  valor_hora numeric(12,2),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- ---------- 5) CATÁLOGO ----------
create table servicos (
  id uuid primary key default gen_random_uuid(), nome text not null,
  categoria_id uuid not null references categorias(id), unidade text not null default 'UND',
  observacao text, ativo bool not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

create table servico_variacoes (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references servicos(id) on delete cascade,
  nome text not null, horas_por_unidade numeric(10,3) not null default 0, ordem int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- ---------- 6) PROJETOS ----------
create type status_projeto as enum ('em_andamento','aguardando','concluido','suspenso');
create table projetos (
  id uuid primary key default gen_random_uuid(), numero_externo text, nome text not null,
  contratante text, contemplado text, local text, endereco text, localizacao text,
  lider_id uuid references colaboradores(id), gestor text,
  data_inicio date, data_fim_prevista date, status status_projeto not null default 'aguardando', observacoes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

-- ---------- 7) GRUPOS E TAREFAS ----------
create table grupos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  nome text not null, categoria_id uuid references categorias(id),
  responsavel_id uuid references colaboradores(id),
  ordem int not null default 0, aberto bool not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

create type status_tarefa as enum ('a_fazer','em_andamento','concluida','congelada');
create type prioridade_tarefa as enum ('alta','media','baixa');
create table tarefas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references projetos(id) on delete cascade,
  grupo_id uuid not null references grupos(id) on delete cascade,
  nivel int not null default 1, is_header bool not null default false,
  servico_id uuid references servicos(id), variacao_id uuid references servico_variacoes(id),
  nome text not null, quantidade numeric(12,3) not null default 1, unidade text,
  tempo_previsto numeric(10,3) not null default 0, tempo_atual numeric(10,3) not null default 0,
  executor_id uuid references colaboradores(id), colaborador_funcao_id uuid references colaborador_funcoes(id),
  responsavel_id uuid references colaboradores(id), prioridade prioridade_tarefa not null default 'media',
  progresso int not null default 0 check (progresso between 0 and 100),
  status status_tarefa not null default 'a_fazer',
  data_inicio date, data_fim_prevista date, data_fim_real date, notas text, ordem int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

-- ---------- 8) MATERIAIS ----------
create table materiais (
  id uuid primary key default gen_random_uuid(), sku text, codigo_barras text, qr_code text,
  nome text not null, descricao text, unidade text not null default 'UND',
  categoria_material text, fabricante text, ativo bool not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
create index on materiais (codigo_barras);
create index on materiais (qr_code);

create type status_material_tarefa as enum ('planejado','adquirir','adquirido','utilizado');
create table tarefa_materiais (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references tarefas(id) on delete cascade,
  material_id uuid not null references materiais(id),
  quantidade_prevista numeric(12,3) not null default 0, quantidade_utilizada numeric(12,3) not null default 0,
  status status_material_tarefa not null default 'planejado', observacao text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- ---------- 9) ÍNDICES E GATILHOS ----------
create index on colaborador_funcoes (colaborador_id);
create index on servico_variacoes (servico_id);
create index on grupos (projeto_id);
create index on tarefas (projeto_id);
create index on tarefas (grupo_id);
create index on tarefa_materiais (tarefa_id);
create index on tarefa_materiais (material_id);

do $$ declare t text; begin
  foreach t in array array['funcoes','niveis','categorias','colaboradores','colaborador_funcoes',
    'servicos','servico_variacoes','projetos','grupos','tarefas','materiais','tarefa_materiais'] loop
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at();', t);
  end loop; end $$;

-- ---------- 10) SEED (listas iniciais) ----------
insert into funcoes (nome, ordem) values
  ('Téc. Automação',1),('Engenheiro',2),('Eletrotécnico',3),('Eletricista',4),
  ('Montador',5),('Mecânico',6),('Refrigerista',7),('Ajudante',8);
insert into niveis (nome, ordem) values ('Júnior',1),('Pleno',2),('Sênior',3);
insert into categorias (nome, icone, ordem) values
  ('Supervisório','device-desktop-analytics',1),('Ar Condicionado','snowflake',2),
  ('Iluminação','bulb',3),('Medição','gauge',4),('Infraestrutura','plug',5),
  ('Sensores','temperature',6),('Comissionamento','checklist',7);

-- =====================================================================
-- FIM. Deve retornar "Success. No rows returned".
-- =====================================================================
