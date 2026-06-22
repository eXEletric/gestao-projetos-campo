-- =====================================================================
-- eX Cronograma — E3 Fatia 1: Banco de Atividades-padrão reutilizáveis
-- Uma atividade salva (com suas tarefas/subtarefas em JSON) reaproveitável
-- em qualquer projeto. Alcance = empresa (multi-tenant por empresa_id).
-- Seguro rodar de novo.
-- =====================================================================
create table if not exists atividades_padrao (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null default empresa_atual(),
  nome        text not null,
  tags        text[] not null default '{}',
  dados       jsonb  not null default '{}'::jsonb,   -- { tarefas:[ {nivel,header,svc,nome,varNome,tempo,tempoPrev,qtd} ] }
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists ix_atvpad_empresa on atividades_padrao(empresa_id);

alter table atividades_padrao enable row level security;

-- Leitura: da própria empresa (fundador vê tudo)
drop policy if exists atvpad_sel on atividades_padrao;
create policy atvpad_sel on atividades_padrao for select to authenticated
  using (eh_fundador() or empresa_id = empresa_atual());

-- Inserir/editar/excluir: ADM/Fundador da própria empresa
drop policy if exists atvpad_ins on atividades_padrao;
create policy atvpad_ins on atividades_padrao for insert to authenticated
  with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop policy if exists atvpad_upd on atividades_padrao;
create policy atvpad_upd on atividades_padrao for update to authenticated
  using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()))
  with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop policy if exists atvpad_del on atividades_padrao;
create policy atvpad_del on atividades_padrao for delete to authenticated
  using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));
