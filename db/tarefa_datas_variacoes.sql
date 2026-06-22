-- =====================================================================
-- eX Cronograma — D4/E4: datas reais por tarefa + variações próprias da tarefa
--  • data_inicio_real: início efetivo (par do data_inicio planejado)
--    (fim planejado=data_fim_prevista e fim real=data_fim_real já existem)
--  • variacoes (jsonb): a tarefa carrega a SUA lista de variações/dificuldades
--    [[nome, horas], ...] — copiada do catálogo/padrão ao adicionar, editável só nela
-- Seguro rodar de novo.
-- =====================================================================
alter table tarefas add column if not exists data_inicio_real date;
alter table tarefas add column if not exists variacoes jsonb;
