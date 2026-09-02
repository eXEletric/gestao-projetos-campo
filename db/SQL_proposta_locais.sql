-- =====================================================================
-- PROPOSTA × LUGAR — amarração de verdade dos endereços
--
-- Princípios ratificados (02/09/26):
--   · Não existe base efetiva da empresa. CADA PROPOSTA escolhe e pontua
--     a sua base — e ela pode ser qualquer município, não só capital.
--   · Uma proposta pode ser LOTE: várias unidades, em várias cidades,
--     dentro das regiões contratadas. O acréscimo do lote sai da MÉDIA
--     das distâncias dessas cidades até a base daquela proposta.
--   · Cada proposta guarda a SUA configuração. Mudar a régua depois NÃO
--     altera proposta nenhuma já feita — o passado fica como foi vendido.
--
-- Ordem: rodar SQL_municipios.sql e SQL_abrangencia.sql ANTES deste.
-- Idempotente.
-- =====================================================================

-- 1) A BASE DAQUELA PROPOSTA -------------------------------------------
alter table public.orcamentos
  add column if not exists base_municipio_id integer references public.municipios(codigo_ibge),
  add column if not exists base_nome         text,      -- rótulo da base escolhida
  add column if not exists abrangencia_snap  jsonb;     -- régua congelada desta proposta

comment on column public.orcamentos.base_municipio_id is
  'Município de onde a equipe sai NESTA proposta. Escolhido caso a caso; não é cadastro fixo da empresa.';
comment on column public.orcamentos.abrangencia_snap is
  'Cópia congelada da régua no momento em que a proposta foi feita: franquia, anéis e percentuais. Reajuste futuro da régua não mexe aqui.';

-- 2) OS LUGARES DA PROPOSTA (o lote) -----------------------------------
-- Uma linha por cidade atendida. Proposta de obra única = uma linha só.
create table if not exists public.orcamento_locais (
  id            uuid primary key default gen_random_uuid(),
  orcamento_id  uuid not null references public.orcamentos(id) on delete cascade,
  municipio_id  integer references public.municipios(codigo_ibge),
  cidade        text,          -- exibição; a verdade é o municipio_id
  uf            char(2),
  unidades      integer not null default 1,   -- quantas obras nesta cidade
  km_rodado     integer,       -- km real da base até aqui; nulo = usa a estimativa
  km_estimado   integer,       -- o que o sistema calculou na hora
  anel          integer,       -- em qual anel caiu, congelado com a proposta
  obs           text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists orcamento_locais_orc_idx on public.orcamento_locais (orcamento_id);
create index if not exists orcamento_locais_mun_idx on public.orcamento_locais (municipio_id);

alter table public.orcamento_locais enable row level security;
drop policy if exists iso_emp on public.orcamento_locais;
create policy iso_emp on public.orcamento_locais
  for all
  using (exists (select 1 from public.orcamentos o
                 where o.id = orcamento_locais.orcamento_id
                   and (eh_fundador() or o.empresa_id = empresa_atual())))
  with check (exists (select 1 from public.orcamentos o
                 where o.id = orcamento_locais.orcamento_id
                   and (eh_fundador() or o.empresa_id = empresa_atual())));

-- 3) A MÉDIA DO LOTE ---------------------------------------------------
-- Média ponderada pelo número de unidades: dez obras em Goiânia pesam
-- dez vezes mais que uma obra em Palmas. Usa o km real quando existir.
create or replace view public.orcamento_distancia as
select
  l.orcamento_id,
  count(*)                                             as cidades,
  sum(l.unidades)                                      as unidades,
  round(sum(coalesce(l.km_rodado, l.km_estimado, 0) * l.unidades)::numeric
        / nullif(sum(l.unidades),0))                   as km_medio,
  min(coalesce(l.km_rodado, l.km_estimado))            as km_min,
  max(coalesce(l.km_rodado, l.km_estimado))            as km_max
from public.orcamento_locais l
group by l.orcamento_id;

-- 4) CONFERÊNCIA -------------------------------------------------------
select 'orcamentos.base_municipio_id' as item,
       (select count(*) from information_schema.columns
        where table_name='orcamentos' and column_name='base_municipio_id') as ok
union all
select 'orcamento_locais',
       (select count(*) from information_schema.tables where table_name='orcamento_locais')
union all
select 'view orcamento_distancia',
       (select count(*) from information_schema.views where table_name='orcamento_distancia');
