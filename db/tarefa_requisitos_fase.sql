-- =====================================================================
-- eX Cronograma — Padrão do cronograma: requisitos para concluir + fase
--  • requisitos (jsonb): regras por tarefa que o Diário obriga no campo
--    {foto, ad, carimbo, arquivo, assin, quem, met}
--      foto     = núcleo (sempre true) — sem foto a tarefa não fecha
--      ad       = foto antes e depois
--      carimbo  = data/hora/local na foto (anti-fraude)
--      arquivo  = anexo obrigatório (ART, medição, laudo, NF)
--      assin    = assinatura no encerramento
--      quem     = 'tec' | 'resp'   (quem assina)
--      met      = 'tela' | 'dig'   (como assina)
--  • fase (text): 'lev' (levantamento) | 'exe' (execução)
--    fotos do levantamento viram o "antes" da execução.
-- Definido no modelo/tarefa; propaga para a obra ao "Usar modelo".
-- Seguro rodar de novo.
-- =====================================================================
alter table tarefas add column if not exists requisitos jsonb;
alter table tarefas add column if not exists fase       text;
