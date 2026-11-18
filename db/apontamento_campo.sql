-- =====================================================================
-- eX — Apontamento de campo por link com chave (sem login)
-- Tela: eX_Apontamento.html?p=<projeto_id>&k=<campo_token>
-- Função: supabase/functions/apontamento-campo (verify_jwt = false;
--         valida a chave da obra e grava com service role)
-- Já aplicado no Supabase em 18/11/2026. Seguro rodar de novo.
-- =====================================================================
alter table projetos add column if not exists campo_token text;
create unique index if not exists ux_projetos_campo_token on projetos(campo_token) where campo_token is not null;
comment on column projetos.campo_token is 'Chave do link de apontamento de campo (eX_Apontamento.html?p=<id>&k=<token>). Nulo = link desligado.';

alter table diario_dias add column if not exists campo jsonb;
comment on column diario_dias.campo is 'Dados do dia enviados pelo apontamento de campo: lider, equipe, entrada, saida, termostatos_em_caixa, impedimentos, resumo.';

-- Gerar/trocar a chave de uma obra:
--   update projetos set campo_token = encode(gen_random_bytes(9),'base64') where id = '<projeto_id>';
-- Desligar o link:
--   update projetos set campo_token = null where id = '<projeto_id>';
