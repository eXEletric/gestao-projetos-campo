-- =====================================================================
-- eX Cronograma — Diário de obra: dias DATADOS + lançamentos, na nuvem
--
-- PROBLEMA QUE ISTO RESOLVE:
--   até aqui o diário vivia só no localStorage do aparelho do técnico
--   (projeto._diario) e era um registro ÚNICO por obra — o dia de hoje
--   sobrescrevia o de ontem. Resultado: o gestor não via o diário do
--   campo, não havia histórico, e trocar de celular perdia tudo.
--
-- MODELO:
--   diario_dias        = 1 registro por OBRA + DATA (o "dia" do diário)
--   diario_lancamentos = horas/marcação por TAREFA dentro daquele dia
--   tarefas.fotos      = referências das fotos (o arquivo já vai pro
--                        Storage 'anexos'; faltava guardar o ponteiro)
--
-- Alcance = por projeto (herda o acesso da obra via pode_ver_projeto):
--   o TÉCNICO com acesso à obra escreve o próprio diário — de propósito.
--   (não é eh_adm(): quem preenche o diário é o campo)
--
-- Seguro rodar de novo. Aplicar no Supabase: SQL Editor -> colar -> Run.
-- =====================================================================

-- ---------- 1) O DIA ----------
create table if not exists diario_dias (
  id            uuid primary key default gen_random_uuid(),
  projeto_id    uuid not null references projetos(id) on delete cascade,
  data          date not null default current_date,
  mood          text,                        -- como foi o dia: ''=fluiu | 'warn'=travou | 'bad'=parou
  foto_q        text,                        -- qualidade de foto escolhida: leve | fhd | max
  observacoes   text,
  encerrado_em  timestamptz,                 -- null = dia ainda aberto
  autor_id      uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint diario_dias_mood_ck check (mood is null or mood in ('','warn','bad')),
  constraint diario_dias_un unique (projeto_id, data)   -- 1 diário por obra por dia
);

create index if not exists ix_diario_dias_proj on diario_dias(projeto_id, data desc);

-- ---------- 2) OS LANÇAMENTOS DO DIA ----------
create table if not exists diario_lancamentos (
  id          uuid primary key default gen_random_uuid(),
  diario_id   uuid not null references diario_dias(id) on delete cascade,
  tarefa_id   uuid not null references tarefas(id) on delete cascade,
  marcada     bool not null default false,   -- chave "trabalhei nisso hoje"
  horas       numeric(6,2) not null default 0,
  autor_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint diario_lanc_horas_ck check (horas >= 0),
  constraint diario_lanc_un unique (diario_id, tarefa_id)
);

create index if not exists ix_diario_lanc_diario on diario_lancamentos(diario_id);
create index if not exists ix_diario_lanc_tarefa on diario_lancamentos(tarefa_id);

-- ---------- 3) FOTOS DA TAREFA (ponteiro pro Storage) ----------
-- o arquivo já sobe pro bucket 'anexos'; sem esta coluna a referência
-- ficava só no aparelho e a prova sumia pro resto da equipe.
alter table tarefas add column if not exists fotos jsonb;

-- ---------- 4) updated_at automático (set_updated_at já existe) ----------
drop trigger if exists trg_diario_dias_upd on diario_dias;
create trigger trg_diario_dias_upd before update on diario_dias
  for each row execute function set_updated_at();

drop trigger if exists trg_diario_lanc_upd on diario_lancamentos;
create trigger trg_diario_lanc_upd before update on diario_lancamentos
  for each row execute function set_updated_at();

-- ---------- 5) RLS — mesmo padrão das filhas por projeto (grupos/tarefas) ----------
alter table diario_dias enable row level security;
drop policy if exists dd_acc on diario_dias;
create policy dd_acc on diario_dias for all to authenticated
  using (pode_ver_projeto(projeto_id))
  with check (pode_ver_projeto(projeto_id));

alter table diario_lancamentos enable row level security;
drop policy if exists dl_acc on diario_lancamentos;
create policy dl_acc on diario_lancamentos for all to authenticated
  using (exists(select 1 from diario_dias d
                 where d.id = diario_id and pode_ver_projeto(d.projeto_id)))
  with check (exists(select 1 from diario_dias d
                 where d.id = diario_id and pode_ver_projeto(d.projeto_id)));

insert into schema_version (versao, descricao)
values ('diario.1', 'Diário de obra — dias datados + lançamentos por tarefa + fotos na nuvem')
on conflict do nothing;
