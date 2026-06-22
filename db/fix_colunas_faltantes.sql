-- =====================================================================
-- eX Cronograma — FIX colunas que o app envia mas faltavam no banco
-- Sintoma: atividade e tarefa "salvam" mas somem ao recarregar.
-- Causa: o Supabase rejeita o upsert inteiro quando recebe uma coluna
-- inexistente. Cascata: se o GRUPO falha, a TAREFA (grupo_id FK) também.
-- Tudo idempotente (if not exists). Seguro rodar de novo.
-- =====================================================================

-- atividade (grupos): campo de detalhes/notas
alter table grupos add column if not exists detalhes text;

-- tarefas: início real + variações próprias da tarefa
alter table tarefas add column if not exists data_inicio_real date;
alter table tarefas add column if not exists variacoes jsonb;

-- colaboradores: telefone + email (email pode já existir)
alter table colaboradores add column if not exists telefone text;
alter table colaboradores add column if not exists email text;
