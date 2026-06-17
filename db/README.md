# Banco de dados de produção — eX Cronograma

Fundação de dados na nuvem (PostgreSQL via **Supabase**), à prova de migração.
Esta pasta é a **fonte da verdade do schema**. Versionada no git.

## Arquivos
- `schema.sql` — estrutura completa (tabelas, chaves, índices, gatilhos). Versão 1.0.
- `seed.sql` — listas controladas iniciais (funções, níveis, categorias).

## Por que Supabase
- PostgreSQL gerenciado, **plano gratuito** (500 MB, backups), multiusuário.
- API pronta (REST/realtime) — o app conversa direto com o banco.
- **Sem lock-in:** exporta SQL/CSV a qualquer momento (`pg_dump`, ou Export no painel).

## Passo a passo para criar o banco (≈10 min) — o usuário faz

1. Acesse https://supabase.com e **crie uma conta** (pode usar o e-mail da eX).
2. **New project** → nome `ex-cronograma`, defina uma senha forte do banco, região mais próxima (ex: South America / São Paulo).
3. Aguarde o projeto subir (~2 min).
4. Menu **SQL Editor** → **New query** → cole todo o conteúdo de `schema.sql` → **Run**.
5. Novo query → cole `seed.sql` → **Run**.
6. Em **Project Settings → API**, copie:
   - **Project URL** (ex: `https://xxxx.supabase.co`)
   - **anon public key**
   Guarde — serão usados para ligar o app ao banco. (Não compartilhe a `service_role`.)

## Próximos passos (após o banco no ar)
1. Ligar o app (`eX_Cronograma.html`) ao Supabase (cliente JS via CDN), trocando o `localStorage` pelas tabelas.
2. Importar os dados atuais (colaboradores, catálogo, projeto ATACADÃO).
3. Transformar em **PWA** (instalável no celular) e habilitar a **câmera (QR/código de barras)** para materiais.
4. Módulo de **materiais** (catálogo genérico + lista por tarefa → lista de aquisição/consumo).

## Modelo de dados (resumo)
Listas: `funcoes`, `niveis`, `categorias`. Pessoas: `colaboradores` + `colaborador_funcoes`.
Catálogo: `servicos` + `servico_variacoes`. Obra: `projetos` → `grupos` → `tarefas`.
Materiais: `materiais` + `tarefa_materiais`. Ver detalhes em `schema.sql`.

Regras de longevidade: UUID estável · `created_at`/`updated_at` · exclusão suave (`deleted_at`) · `schema_version` para evoluir sem perder dado.
