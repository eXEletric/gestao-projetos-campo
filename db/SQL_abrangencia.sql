-- =====================================================================
-- ABRANGÊNCIA — FASE 1: camada fiscal por UF
-- Modelo ratificado: "Opção C — duas camadas"
--   camada 1 (esta) = UF  -> o que é jurídico/fiscal (ICMS-DIFAL, IE, ISS, parceiro)
--   camada 2 (fase 2) = km -> o que é custo/logística (evolui orc_abrangencia)
--
-- NÃO cria cadastro paralelo: orc_abrangencia continua sendo a camada de
-- deslocamento e é evoluída na fase 2, não substituída.
--
-- Rodar no SQL Editor do Supabase (projeto ex-Controler_Service).
-- Idempotente: pode rodar mais de uma vez sem duplicar.
-- =====================================================================

-- 1) TABELA -----------------------------------------------------------
create table if not exists public.abrangencia_uf (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid,
  uf                 char(2) not null,
  status             text    not null default 'consulta',
                     -- atende | condicional | consulta | nao_atende
  inscricao_estadual boolean not null default false,
  ie_numero          text,
  icms_obs           text,   -- regra de DIFAL / ST de material naquela UF
  iss_obs            text,   -- alíquota e retenção do serviço (é municipal)
  parceiro           text,   -- quem executa localmente, quando houver
  obs                text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

do $$ begin
  alter table public.abrangencia_uf
    add constraint abrangencia_uf_status_chk
    check (status in ('atende','condicional','consulta','nao_atende'));
exception when duplicate_object then null; end $$;

create unique index if not exists abrangencia_uf_emp_uf_uidx
  on public.abrangencia_uf (empresa_id, uf);

-- 2) RLS — mesmo padrão das demais tabelas do projeto -------------------
alter table public.abrangencia_uf enable row level security;

drop policy if exists iso_emp on public.abrangencia_uf;
create policy iso_emp on public.abrangencia_uf
  for all
  using      (eh_fundador() or (empresa_id = empresa_atual()))
  with check (eh_fundador() or (empresa_id = empresa_atual()));

-- 3) SEED — as 27 UFs para cada empresa que já tem dado no sistema ------
with empresas_ativas as (
  select distinct empresa_id from public.lojas            where empresa_id is not null
  union
  select distinct empresa_id from public.orc_abrangencia  where empresa_id is not null
  union
  select distinct empresa_id from public.clientes         where empresa_id is not null
),
ufs as (
  select unnest(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
                      'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) as uf
)
insert into public.abrangencia_uf (empresa_id, uf, status)
select e.empresa_id, u.uf, 'consulta'
from empresas_ativas e cross join ufs u
on conflict (empresa_id, uf) do nothing;

-- 4) CALIBRAGEM PELA REALIDADE ----------------------------------------
-- Onde a eX já tem loja atendida, o status nasce 'atende'.
-- A UF é extraída da sigla no fim do endereço da loja (é o dado que existe hoje).
with lojas_uf as (
  select l.empresa_id,
         (array_agg(s.uf order by s.ord desc))[1] as uf
  from public.lojas l,
  lateral (
    select (g)[1] as uf, ord
    from regexp_matches(
      upper(l.endereco),
      '\m(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\M',
      'g'
    ) with ordinality as t(g, ord)
  ) s
  where l.deleted_at is null and coalesce(l.endereco,'') <> ''
  group by l.id, l.empresa_id
)
update public.abrangencia_uf a
   set status = 'atende',
       obs = coalesce(nullif(a.obs,''), 'nasceu como atende: já existe loja atendida nesta UF'),
       updated_at = now()
from (select empresa_id, uf, count(*) as n from lojas_uf group by empresa_id, uf) x
where a.empresa_id = x.empresa_id
  and a.uf = x.uf
  and a.status = 'consulta';

-- 5) CAMADA KM — infra mínima na tabela que JÁ EXISTE --------------------
-- orc_abrangencia continua sendo a camada de deslocamento; só ganha o
-- limite superior da faixa (km rodado). Coluna nova e opcional: nada no
-- orçamento atual quebra.
alter table public.orc_abrangencia add column if not exists km_ate integer;

comment on column public.orc_abrangencia.km_ate is
  'Limite superior da faixa em km RODADOS (não linha reta). NULL = faixa aberta (última).';

-- 6) ORIGENS RECORRENTES ------------------------------------------------
-- A eX não tem base fixa: a equipe se monta por obra. Cada proposta escolhe
-- de onde sai. Esta tabela é só a lista de pontos de partida frequentes,
-- para não redigitar cidade a cada proposta — a escolha em si é do orçamento.
create table if not exists public.abrangencia_origens (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid,
  nome       text not null,          -- ex.: "Equipe Bahia", "Sede", "Parceiro DF"
  cidade     text,
  uf         char(2),
  padrao     boolean not null default false,
  ativo      boolean not null default true,
  obs        text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.abrangencia_origens enable row level security;
drop policy if exists iso_emp on public.abrangencia_origens;
create policy iso_emp on public.abrangencia_origens
  for all
  using      (eh_fundador() or (empresa_id = empresa_atual()))
  with check (eh_fundador() or (empresa_id = empresa_atual()));

-- 6b) PRIMEIRA BASE ------------------------------------------------------
-- Anápolis (GO). Se a cidade for outra, troque aqui antes de rodar.
insert into public.abrangencia_origens (empresa_id, nome, cidade, uf, padrao, ativo)
select e.empresa_id, 'Base Anápolis', 'Anápolis', 'GO', true, true
from (
  select distinct empresa_id from public.lojas where empresa_id is not null
  union
  select distinct empresa_id from public.orc_abrangencia where empresa_id is not null
) e
where not exists (
  select 1 from public.abrangencia_origens a
  where a.empresa_id = e.empresa_id and lower(a.nome) = 'base anápolis'
);

-- 7) CONFERÊNCIA -------------------------------------------------------
-- Deve mostrar 14 UFs em 'atende' (BA, DF, GO, MS, RN, TO, CE, PB, SP, MG, AL, PE, SE, RO)
-- e as demais em 'consulta'.
select status, count(*) as ufs, string_agg(uf, ' ' order by uf) as quais
from public.abrangencia_uf
group by status
order by status;
