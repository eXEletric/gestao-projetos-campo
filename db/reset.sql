-- =====================================================================
-- eX Cronograma — RESET (apaga toda a estrutura para recriar do zero)
-- ATENÇÃO: apaga TODOS os dados das tabelas do app. Use só em projeto
-- vazio ou quando quiser recomeçar. Rode ANTES de schema.sql.
-- =====================================================================

drop table if exists tarefa_materiais, materiais, tarefas, grupos, projetos,
  servico_variacoes, servicos, colaborador_funcoes, colaboradores,
  categorias, niveis, funcoes, schema_version cascade;

drop type if exists status_projeto, status_tarefa, prioridade_tarefa, status_material_tarefa cascade;

drop function if exists set_updated_at cascade;
