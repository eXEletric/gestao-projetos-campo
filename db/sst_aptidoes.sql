-- =====================================================================
-- eX Cronograma — SST Fase 2: Aptidão da equipe
-- Documentos de aptidão por colaborador, com validade:
--   ASO, treinamentos NR (10/35/18/33/12...), ficha de EPI (NR-6), etc.
-- O "portão": vencido = pendência (barra no cronograma, fase futura).
-- Alcance = empresa (multi-tenant). Seguro rodar de novo.
-- Aplicar no Supabase: SQL Editor -> colar -> Run.
-- =====================================================================
create table if not exists sst_aptidoes (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null default empresa_atual(),
  colaborador_id uuid not null references colaboradores(id) on delete cascade,
  tipo           text not null,               -- ASO, NR-10, NR-35, Ficha de EPI (NR-6)...
  descricao      text,                        -- detalhe livre (ex.: periódico, reciclagem, SEP)
  emissao        date,
  validade       date,                        -- null = sem validade / não expira
  anexo_url      text,                        -- link do documento (Storage vem depois)
  observacoes    text,
  ativo          bool not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists ix_sst_apt_empresa on sst_aptidoes(empresa_id);
create index if not exists ix_sst_apt_colab   on sst_aptidoes(colaborador_id);

-- updated_at automático (função já existe no schema.sql)
drop trigger if exists trg_sst_apt_upd on sst_aptidoes;
create trigger trg_sst_apt_upd before update on sst_aptidoes
  for each row execute function set_updated_at();

-- ---------- RLS (mesmo padrão fundador / adm por empresa) ----------
alter table sst_aptidoes enable row level security;

drop policy if exists sstapt_sel on sst_aptidoes;
create policy sstapt_sel on sst_aptidoes for select to authenticated
  using (eh_fundador() or empresa_id = empresa_atual());

drop policy if exists sstapt_ins on sst_aptidoes;
create policy sstapt_ins on sst_aptidoes for insert to authenticated
  with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop policy if exists sstapt_upd on sst_aptidoes;
create policy sstapt_upd on sst_aptidoes for update to authenticated
  using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()))
  with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop policy if exists sstapt_del on sst_aptidoes;
create policy sstapt_del on sst_aptidoes for delete to authenticated
  using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

insert into schema_version (versao, descricao)
values ('sst.2', 'SST Fase 2 — aptidão da equipe (documentos por colaborador)') on conflict do nothing;
