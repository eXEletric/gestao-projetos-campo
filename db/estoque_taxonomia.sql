-- =====================================================================
-- eX Estoque — TAXONOMIA (Segmento > Grupo > Tipo) + numeração do item
-- Segmento = linha de negócio (Elétrica/Automação hoje; Construção/Ferragens depois)
-- Código dentro do segmento: Grupo.Tipo.TipoBase.Item  (ex.: 7.01.03.02)
-- Rodar no SQL Editor do Supabase. SUBSTITUI a versão anterior. Idempotente.
-- =====================================================================

-- recria a taxonomia com o segmento por cima (sem dados reais ainda)
drop table if exists estoque_tipos cascade;
drop table if exists estoque_grupos cascade;

create table if not exists estoque_segmentos(
  id uuid primary key default gen_random_uuid(),
  numero int not null unique,
  nome text not null,
  slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table estoque_grupos(
  id uuid primary key default gen_random_uuid(),
  segmento_numero int not null references estoque_segmentos(numero) on update cascade,
  numero int not null,
  nome text not null,
  slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(segmento_numero, numero)
);

create table estoque_tipos(
  id uuid primary key default gen_random_uuid(),
  segmento_numero int not null,
  grupo_numero    int not null,
  numero          int not null,
  nome            text not null,
  codigo text generated always as (grupo_numero::text || '.' || lpad(numero::text,2,'0')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(segmento_numero, grupo_numero, numero)
);

-- numeração no item
alter table itens add column if not exists segmento_numero int;
alter table itens add column if not exists grupo_numero    int;
alter table itens add column if not exists tipo_numero      int;
alter table itens add column if not exists item_seq         int;

-- ---------- SEED segmento ----------
insert into estoque_segmentos(numero,nome,slug) values
 (1,'Elétrica e automação','ELETRICA_AUTOMACAO')
on conflict (numero) do update set nome=excluded.nome, slug=excluded.slug;

-- ---------- SEED grupos (todos sob o segmento 1) ----------
insert into estoque_grupos(segmento_numero,numero,nome,slug) values
 (1,1,'Infra','INFRA'),
 (1,2,'Condutores e acessórios','CONDUTORES_E_ACESSORIOS'),
 (1,3,'Proteção de circuitos','PROTECAO_DE_CIRCUITOS'),
 (1,4,'Comandos elétricos','COMANDOS_ELETRICOS'),
 (1,5,'Caixas e armários','CAIXAS_E_ARMARIOS'),
 (1,6,'Tomadas e interruptores','TOMADAS_E_INTERRUPTORES'),
 (1,7,'Acessórios de instalações','ACESSORIOS_DE_INSTALACOES'),
 (1,8,'Ferramentas e instrumentos','FERRAMENTAS_E_INSTRUMENTOS'),
 (1,9,'EPIs','EPIs'),
 (1,10,'Itens suporte automação','ITENS_SUPORTE_AUTOMACAO')
on conflict (segmento_numero,numero) do update set nome=excluded.nome, slug=excluded.slug;

-- ---------- SEED tipos (segmento 1) ----------
insert into estoque_tipos(segmento_numero,grupo_numero,numero,nome) values
 (1,1,1,'Eletroduto zincado'),(1,1,2,'Eletroduto galv. à fogo'),(1,1,3,'Eletroduto alumínio'),(1,1,4,'Seal tubo'),(1,1,5,'Eletroduto PVC'),(1,1,6,'PVC flexível'),(1,1,7,'Spiraflex'),(1,1,8,'PEAD'),(1,1,9,'Perfilados'),(1,1,10,'Eletrocalha'),(1,1,11,'Leitos'),(1,1,12,'Conduletes alumínio'),(1,1,13,'Conduletes PVC'),(1,1,14,'Caixas de passagem'),(1,1,15,'Fixação'),(1,1,16,'Buxas e parafusos'),
 (1,2,1,'Fios'),(1,2,2,'Cabos'),(1,2,3,'Bornes e conexões'),(1,2,4,'Terminais'),(1,2,5,'Anilhas'),(1,2,6,'Isolantes e fitas'),(1,2,7,'Prensa cabos'),
 (1,3,1,'Disjuntores DIN'),
 (1,4,1,'Acionamentos e acessórios'),(1,4,2,'Relés e acessórios'),(1,4,3,'Botões e acessórios'),
 (1,5,1,'Suporte para caixa de montagem'),
 (1,6,1,'Tomadas'),(1,6,2,'Interruptores'),
 (1,7,1,'Organizadores de instalação'),(1,7,2,'Placas'),(1,7,3,'Tags'),(1,7,4,'Adesivos'),
 (1,8,1,'Chaves manuais'),(1,8,2,'Alicates'),(1,8,3,'Ferramentas de corte'),(1,8,4,'Parafusadeira e furadeira'),(1,8,5,'Martelete'),(1,8,6,'Bits e canhões'),(1,8,7,'Instrumentos e testadores'),(1,8,8,'Kits ferramentas'),(1,8,9,'Outros'),
 (1,9,1,'Calçado de segurança'),(1,9,2,'Luva de segurança'),(1,9,3,'Protetor auditivo'),(1,9,4,'Óculos de proteção'),(1,9,5,'Capacete'),(1,9,6,'Protetor facial'),(1,9,7,'Vestimenta'),(1,9,8,'Cinto de segurança'),
 (1,10,1,'Informática'),(1,10,2,'Cabos'),(1,10,3,'Internet')
on conflict (segmento_numero,grupo_numero,numero) do update set nome=excluded.nome;

-- ---------- triggers updated_at ----------
do $$ begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    execute 'drop trigger if exists trg_estoque_segmentos_upd on estoque_segmentos';
    execute 'create trigger trg_estoque_segmentos_upd before update on estoque_segmentos for each row execute function set_updated_at()';
    execute 'drop trigger if exists trg_estoque_grupos_upd on estoque_grupos';
    execute 'create trigger trg_estoque_grupos_upd before update on estoque_grupos for each row execute function set_updated_at()';
    execute 'drop trigger if exists trg_estoque_tipos_upd on estoque_tipos';
    execute 'create trigger trg_estoque_tipos_upd before update on estoque_tipos for each row execute function set_updated_at()';
  end if;
end $$;

-- ---------- RLS ----------
alter table estoque_segmentos enable row level security;
alter table estoque_grupos    enable row level security;
alter table estoque_tipos     enable row level security;
drop policy if exists acesso_app on estoque_segmentos;
create policy acesso_app on estoque_segmentos for all to anon, authenticated using (true) with check (true);
drop policy if exists acesso_app on estoque_grupos;
create policy acesso_app on estoque_grupos for all to anon, authenticated using (true) with check (true);
drop policy if exists acesso_app on estoque_tipos;
create policy acesso_app on estoque_tipos for all to anon, authenticated using (true) with check (true);
