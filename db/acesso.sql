-- =====================================================================
-- eX Cronograma — ACESSO (políticas RLS)
-- Libera a chave pública (anon) a ler e gravar nas tabelas do app.
-- Rode no SQL Editor depois do instalar.sql.
--
-- NOTA DE SEGURANÇA: isto deixa o banco acessível a quem tiver a chave
-- pública + URL. É adequado para a fase inicial/uso interno. Quando for
-- abrir para mais gente, adicionamos LOGIN (Supabase Auth) e restringimos
-- as políticas por usuário. Por ora, acesso liberado para começar a usar.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'funcoes','niveis','categorias','colaboradores','colaborador_funcoes',
    'servicos','servico_variacoes','projetos','grupos','tarefas',
    'materiais','tarefa_materiais','schema_version'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists acesso_app on %I;', t);
    execute format(
      'create policy acesso_app on %I for all to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;
