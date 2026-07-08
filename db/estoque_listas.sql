-- =====================================================================
-- eX Estoque — LISTAS DE APOIO (cadastros dos campos do item)
-- campo: tipo_base | material | cor | unidade  (escolher/cadastrar/editar/deletar)
-- Rodar no SQL Editor do Supabase. Seguro rodar de novo.
-- =====================================================================

create table if not exists estoque_listas(
  id         uuid primary key default gen_random_uuid(),
  campo      text not null,          -- tipo_base | material | cor | unidade
  valor      text not null,
  ordem      int  not null default 0,
  ativo      bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campo, valor)
);
create index if not exists idx_estoque_listas_campo on estoque_listas(campo);

-- ---------- SEED cores padrão ----------
insert into estoque_listas(campo,valor,ordem) values
 ('cor','Preta',1),('cor','Branca',2),('cor','Cinza',3),('cor','Vermelha',4),('cor','Azul',5),
 ('cor','Verde',6),('cor','Amarela',7),('cor','Laranja',8),('cor','Marrom',9),('cor','Transparente',10)
on conflict (campo,valor) do nothing;

-- ---------- SEED unidades padrão ----------
insert into estoque_listas(campo,valor,ordem) values
 ('unidade','UND',1),('unidade','m',2),('unidade','cm',3),('unidade','mm',4),('unidade','kg',5),
 ('unidade','g',6),('unidade','par',7),('unidade','rolo',8),('unidade','cx',9),('unidade','pç',10),
 ('unidade','L',11),('unidade','kit',12),('unidade','jogo',13),('unidade','m²',14)
on conflict (campo,valor) do nothing;

-- ---------- SEED materiais (matéria-prima) padrão ----------
insert into estoque_listas(campo,valor,ordem) values
 ('material','Nylon',1),('material','Aço',2),('material','Aço inox',3),('material','Aço galvanizado',4),
 ('material','PVC',5),('material','Alumínio',6),('material','Latão',7),('material','Cobre',8),
 ('material','Borracha',9),('material','Policarbonato',10),('material','Poliéster',11)
on conflict (campo,valor) do nothing;

-- (tipo_base começa vazio — cresce conforme você cadastra)

-- ---------- trigger updated_at ----------
do $$ begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    execute 'drop trigger if exists trg_estoque_listas_upd on estoque_listas';
    execute 'create trigger trg_estoque_listas_upd before update on estoque_listas for each row execute function set_updated_at()';
  end if;
end $$;

-- ---------- RLS ----------
alter table estoque_listas enable row level security;
drop policy if exists acesso_app on estoque_listas;
create policy acesso_app on estoque_listas for all to anon, authenticated using (true) with check (true);
