-- =====================================================================
-- eX Cronograma — MÓDULO MATERIAIS + LISTAS PADRÃO + CHECKLISTS
-- Versão 1.1  |  Rodar no SQL Editor DEPOIS do instalar.sql.
-- Seguro rodar de novo (recria as tabelas deste módulo).
-- =====================================================================

-- recria o que existia do esboço de materiais
drop table if exists checklist_uso, checklist_itens, checklists cascade;
drop table if exists materiais_uso, listas_padrao_itens, listas_padrao cascade;
drop table if exists tarefa_materiais cascade;     -- substituído por materiais_uso
drop table if exists materiais cascade;            -- recriado com as colunas reais

-- ---------- CATÁLOGO GLOBAL DE MATERIAIS (colunas reais do usuário) ----------
-- Importável: estrutura casa com a planilha. Descrição padronizada = base.
create table materiais (
  id                   uuid primary key default gen_random_uuid(),
  codigo_fabrica       text,
  codigo_interno       text,
  descricao_padronizada text,          -- DESCRIÇÃO base (principal)
  descricao_fabricante text,
  material_cor         text,
  medida               text,
  modelo               text,
  marca                text,
  qtd_padrao           numeric(12,3),   -- QTD de referência (opcional)
  unidade              text default 'UND',
  codigo_barras        text,            -- EAN/UPC — lido pela câmera
  qr_code              text,            -- QR — lido pela câmera
  obs                  text,            -- observações
  ativo                bool not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index on materiais (codigo_interno);
create index on materiais (codigo_barras);
create index on materiais (qr_code);

-- ---------- BIBLIOTECA DE LISTAS PADRÃO (modelos reutilizáveis/duplicáveis) ----------
create table listas_padrao (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  descricao    text,
  categoria_id uuid references categorias(id),  -- vínculo opcional ao tipo de grupo/título
  origem_id    uuid references listas_padrao(id),-- se foi duplicada de outra (base)
  ativo        bool not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create table listas_padrao_itens (
  id           uuid primary key default gen_random_uuid(),
  lista_id     uuid not null references listas_padrao(id) on delete cascade,
  material_id  uuid references materiais(id),
  quantidade   numeric(12,3) not null default 0,
  obs          text,
  ordem        int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on listas_padrao_itens (lista_id);

-- ---------- USO DE MATERIAIS NA OBRA (por GRUPO ou por TAREFA — escolha do projeto) ----------
-- A lista geral da obra = agregação por projeto_id.
create type status_material as enum ('planejado','a_solicitar','providenciado','aplicado');
create table materiais_uso (
  id                   uuid primary key default gen_random_uuid(),
  projeto_id           uuid not null references projetos(id) on delete cascade,
  grupo_id             uuid references grupos(id) on delete cascade,   -- nulo se for por tarefa
  tarefa_id            uuid references tarefas(id) on delete cascade,  -- nulo se for por grupo
  material_id          uuid not null references materiais(id),
  quantidade_prevista  numeric(12,3) not null default 0,  -- da lista padrão
  quantidade_utilizada numeric(12,3) not null default 0,  -- preenchido em campo
  status               status_material not null default 'planejado',
  obs                  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on materiais_uso (projeto_id);
create index on materiais_uso (grupo_id);
create index on materiais_uso (tarefa_id);

-- ---------- CHECKLISTS (modelos configuráveis) ----------
create table checklists (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  descricao           text,
  categoria_id        uuid references categorias(id),
  obrigatorio_concluir bool not null default false,  -- true = trava conclusão até marcar tudo
  ativo               bool not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
-- itens com descrição-base + colunas extras editáveis + obs (estilo planilha simples)
create table checklist_itens (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  descricao    text not null,        -- coluna base
  info1        text,                 -- colunas adicionais livres
  info2        text,
  info3        text,
  obrigatorio  bool not null default true,
  obs          text,
  ordem        int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on checklist_itens (checklist_id);

-- ---------- USO DE CHECKLIST NA OBRA (por grupo ou tarefa-pai) ----------
create table checklist_uso (
  id           uuid primary key default gen_random_uuid(),
  projeto_id   uuid not null references projetos(id) on delete cascade,
  grupo_id     uuid references grupos(id) on delete cascade,
  tarefa_id    uuid references tarefas(id) on delete cascade,
  item_id      uuid not null references checklist_itens(id),
  marcado      bool not null default false,
  marcado_em   timestamptz,
  marcado_por  text,
  obs          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on checklist_uso (projeto_id);

-- ---------- gatilhos updated_at ----------
do $$ declare t text; begin
  foreach t in array array['materiais','listas_padrao','listas_padrao_itens','materiais_uso',
    'checklists','checklist_itens','checklist_uso'] loop
    execute format('create trigger trg_%1$s_updated before update on %1$s for each row execute function set_updated_at();', t);
  end loop; end $$;

-- ---------- RLS (libera a chave pública, igual ao acesso.sql) ----------
do $$ declare t text; begin
  foreach t in array array['materiais','listas_padrao','listas_padrao_itens','materiais_uso',
    'checklists','checklist_itens','checklist_uso'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists acesso_app on %I;', t);
    execute format('create policy acesso_app on %I for all to anon, authenticated using (true) with check (true);', t);
  end loop; end $$;

update schema_version set descricao='Estrutura + módulo materiais/checklists' where versao='1.0';
insert into schema_version (versao, descricao) values ('1.1','Materiais, listas padrão e checklists') on conflict do nothing;
