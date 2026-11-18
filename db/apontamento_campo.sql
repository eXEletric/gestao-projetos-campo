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

-- ---------- Histórico do apontamento (18/11/2026) ----------
create table if not exists apontamento_historico (
  id          uuid primary key default gen_random_uuid(),
  projeto_id  uuid not null references projetos(id) on delete cascade,
  tarefa_id   uuid references tarefas(id) on delete cascade,
  campo       text not null,
  de          text,
  para        text,
  autor_nome  text,
  dispositivo text,
  data        date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists ix_apont_hist_tarefa on apontamento_historico(tarefa_id, created_at desc);
create index if not exists ix_apont_hist_proj on apontamento_historico(projeto_id, created_at desc);
alter table apontamento_historico enable row level security;
-- leitura no app logado segue o acesso da obra; gravação só pela função (service role)
-- create policy ah_sel on apontamento_historico for select to authenticated using (pode_ver_projeto(projeto_id));
