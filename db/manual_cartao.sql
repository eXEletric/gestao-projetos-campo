-- ============================================================
-- Manual do Cartão Clara — migração de schema (rodar no Supabase)
-- Projeto: eX Cronograma / gestão-projetos-campo
-- Data: 2026-06-26
-- Cria 3 tabelas (escopo por empresa, soft-delete) + RLS.
-- O CONTEÚDO (etiquetas/regras) é carregado pelo painel do admin,
-- não por este SQL — assim o empresa_id vem do usuário logado.
-- Seguro de rodar mais de uma vez (IF NOT EXISTS / drop policy if exists).
-- ============================================================

-- 1) ETIQUETAS (categorias de despesa do cartão) -------------
create table if not exists public.cartao_etiquetas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references public.empresas(id) on delete cascade,
  nome        text not null,
  descricao   text,
  exemplos    text,
  icone       text default 'ti-tag',          -- nome do ícone Tabler
  tema        text default 'outros',           -- alim | desloc | obra | estadia | adm | outros
  permissao   text not null default 'campo'    -- 'campo' | 'adm'
              check (permissao in ('campo','adm')),
  grafia_app  text,                            -- como aparece no app da Clara, se diferente
  destaque    boolean default false,           -- marca "nova"/sugestão
  ordem       int default 0,
  deleted_at  timestamptz,
  created_at  timestamptz default now()
);

-- 2) REGRAS DE OURO (lista do topo do manual) ----------------
create table if not exists public.cartao_regras (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references public.empresas(id) on delete cascade,
  texto       text not null,
  icone       text default 'ti-point',
  ordem       int default 0,
  deleted_at  timestamptz,
  created_at  timestamptz default now()
);

-- 3) CONFIG (1 linha por empresa: títulos e aviso geral) -----
create table if not exists public.cartao_config (
  empresa_id    uuid primary key references public.empresas(id) on delete cascade,
  titulo        text default 'Cartão Clara — guia de etiquetas',
  subtitulo     text default 'Escolha a etiqueta certa ao lançar cada despesa',
  observacao    text,                          -- aviso (grafias do app, limite de valor, etc.)
  atualizado_em timestamptz default now()
);

-- Idempotente: garante a coluna 'tema' se a tabela já existia sem ela
alter table public.cartao_etiquetas add column if not exists tema text default 'outros';
-- Melhorias 05/07: classificação da etiqueta + nota na regra
alter table public.cartao_etiquetas add column if not exists requisito text;   -- 'obrigatoria' | 'opcional' | null
alter table public.cartao_regras   add column if not exists observacao text;

-- ============================================================
-- RLS — público lê (link de consulta / técnico); só adm/fundador edita.
-- ============================================================
alter table public.cartao_etiquetas enable row level security;
alter table public.cartao_regras    enable row level security;
alter table public.cartao_config    enable row level security;

-- leitura pública (anon + autenticado) das linhas não excluídas
drop policy if exists cartao_etiquetas_sel on public.cartao_etiquetas;
create policy cartao_etiquetas_sel on public.cartao_etiquetas
  for select using (deleted_at is null);

drop policy if exists cartao_regras_sel on public.cartao_regras;
create policy cartao_regras_sel on public.cartao_regras
  for select using (deleted_at is null);

drop policy if exists cartao_config_sel on public.cartao_config;
create policy cartao_config_sel on public.cartao_config
  for select using (true);

-- escrita: somente adm/fundador da mesma empresa
drop policy if exists cartao_etiquetas_wr on public.cartao_etiquetas;
create policy cartao_etiquetas_wr on public.cartao_etiquetas
  for all to authenticated
  using (
    empresa_id = (select empresa_id from public.perfis where user_id = auth.uid())
    and (select papel from public.perfis where user_id = auth.uid()) in ('adm','fundador')
  )
  with check (
    empresa_id = (select empresa_id from public.perfis where user_id = auth.uid())
    and (select papel from public.perfis where user_id = auth.uid()) in ('adm','fundador')
  );

drop policy if exists cartao_regras_wr on public.cartao_regras;
create policy cartao_regras_wr on public.cartao_regras
  for all to authenticated
  using (
    empresa_id = (select empresa_id from public.perfis where user_id = auth.uid())
    and (select papel from public.perfis where user_id = auth.uid()) in ('adm','fundador')
  )
  with check (
    empresa_id = (select empresa_id from public.perfis where user_id = auth.uid())
    and (select papel from public.perfis where user_id = auth.uid()) in ('adm','fundador')
  );

drop policy if exists cartao_config_wr on public.cartao_config;
create policy cartao_config_wr on public.cartao_config
  for all to authenticated
  using (
    empresa_id = (select empresa_id from public.perfis where user_id = auth.uid())
    and (select papel from public.perfis where user_id = auth.uid()) in ('adm','fundador')
  )
  with check (
    empresa_id = (select empresa_id from public.perfis where user_id = auth.uid())
    and (select papel from public.perfis where user_id = auth.uid()) in ('adm','fundador')
  );

-- Fim. Depois de rodar, volte ao app: o painel do admin terá o botão
-- "Carregar conteúdo sugerido" para popular as 15 etiquetas + regras.
