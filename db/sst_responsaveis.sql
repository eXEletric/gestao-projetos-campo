-- =====================================================================
-- eX Cronograma — SST Fase 1: Responsável técnico (SESMT)
-- Cadastro de quem responde pela Segurança do Trabalho da empresa:
--   tipo = interno (funcionário)  ou  terceirizado (empresa/consultoria).
-- Alcance = empresa (multi-tenant por empresa_id). Seguro rodar de novo.
-- Aplicar no Supabase: SQL Editor -> colar -> Run.
-- =====================================================================
create table if not exists sst_responsaveis (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null default empresa_atual(),
  tipo          text not null default 'interno'
                  check (tipo in ('interno','terceirizado')),
  nome          text not null,               -- nome do técnico de segurança (pessoa)
  registro_mte  text,                        -- registro profissional (MTE)
  telefone      text,
  email         text,
  -- terceirizado:
  empresa_nome  text,                        -- empresa / consultoria contratada
  cnpj          text,
  contrato_ref  text,                        -- nº / referência do contrato
  -- controle:
  principal     bool not null default false, -- responsável vigente (só 1 por empresa)
  ativo         bool not null default true,
  observacoes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists ix_sst_resp_empresa on sst_responsaveis(empresa_id);

-- updated_at automático (função já existe no schema.sql)
drop trigger if exists trg_sst_resp_upd on sst_responsaveis;
create trigger trg_sst_resp_upd before update on sst_responsaveis
  for each row execute function set_updated_at();

-- ---------- RLS (mesmo padrão fundador / adm por empresa) ----------
alter table sst_responsaveis enable row level security;

drop policy if exists sstresp_sel on sst_responsaveis;
create policy sstresp_sel on sst_responsaveis for select to authenticated
  using (eh_fundador() or empresa_id = empresa_atual());

drop policy if exists sstresp_ins on sst_responsaveis;
create policy sstresp_ins on sst_responsaveis for insert to authenticated
  with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop policy if exists sstresp_upd on sst_responsaveis;
create policy sstresp_upd on sst_responsaveis for update to authenticated
  using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()))
  with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop policy if exists sstresp_del on sst_responsaveis;
create policy sstresp_del on sst_responsaveis for delete to authenticated
  using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

insert into schema_version (versao, descricao)
values ('sst.1', 'SST Fase 1 — responsável técnico (SESMT)') on conflict do nothing;
