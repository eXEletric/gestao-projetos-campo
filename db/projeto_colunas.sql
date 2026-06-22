-- =====================================================================
-- eX Cronograma — colunas faltantes em projetos
--  • modelo: marca o projeto como TEMPLATE (aba ★ Modelos) — ESTA é a que
--    faltava e impedia salvar/persistir o modelo.
--  • cidade / uf: campos separados de localização (campos do cadastro).
-- O app (pushProjeto) já envia esses campos; sem as colunas o Supabase
-- rejeita o salvamento inteiro do projeto e ao recarregar ele "some".
-- Seguro rodar de novo.
-- =====================================================================
alter table projetos add column if not exists modelo boolean not null default false;
alter table projetos add column if not exists cidade text;
alter table projetos add column if not exists uf text;

create index if not exists idx_projetos_modelo on projetos (modelo);
