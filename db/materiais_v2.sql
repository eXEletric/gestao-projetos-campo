-- =====================================================================
-- eX Cronograma — Materiais v2: grupos, marcas, código interno auto, qtd mínima
-- Rodar DEPOIS de materiais.sql. Seguro rodar de novo.
-- =====================================================================

-- ---------- GRUPOS / TIPOS DE MATERIAL (com sigla p/ o código interno) ----------
create table if not exists grupos_materiais (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  sigla      text not null,            -- prefixo do código interno (ex: CAB -> CAB/001)
  ordem      int not null default 0,
  ativo      bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- MARCAS (lista controlada, evita nomes diferentes) ----------
create table if not exists marcas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ativo      bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- AJUSTES NA TABELA materiais ----------
alter table materiais add column if not exists grupo_material_id uuid references grupos_materiais(id);
-- qtd_padrao -> quantidade_minima (renomeia se ainda existir)
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='materiais' and column_name='qtd_padrao') then
    alter table materiais rename column qtd_padrao to quantidade_minima;
  end if;
end $$;
alter table materiais add column if not exists quantidade_minima numeric(12,3);
alter table materiais add column if not exists seq_grupo int;  -- número sequencial dentro do grupo (p/ o código)

-- ---------- gatilhos updated_at ----------
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_grupos_materiais_updated') then
    create trigger trg_grupos_materiais_updated before update on grupos_materiais for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_marcas_updated') then
    create trigger trg_marcas_updated before update on marcas for each row execute function set_updated_at();
  end if;
end $$;

-- ---------- RLS ----------
alter table grupos_materiais enable row level security;
drop policy if exists acesso_app on grupos_materiais;
create policy acesso_app on grupos_materiais for all to anon, authenticated using (true) with check (true);
alter table marcas enable row level security;
drop policy if exists acesso_app on marcas;
create policy acesso_app on marcas for all to anon, authenticated using (true) with check (true);

-- ---------- grupos e marcas iniciais (exemplos — pode editar/adicionar) ----------
insert into grupos_materiais (nome, sigla, ordem) values
  ('Cabos','CAB',1),('Eletrocalha','ELC',2),('Eletroduto','EDT',3),
  ('Tomadas / Interruptores','TOM',4),('Disjuntores','DJ',5),
  ('Sensores','SEN',6),('Quadros','QD',7),('Conectores','CON',8)
on conflict (nome) do nothing;

insert into marcas (nome) values
  ('Prysmian'),('Sil'),('Schneider'),('Steck'),('Pial Legrand'),('WEG'),('Tramontina')
on conflict (nome) do nothing;

update schema_version set descricao='Materiais v2: grupos, marcas, código auto, qtd mínima' where versao='1.1';
