-- ============================================================================
-- eX Controller · Tratativas da proposta (linha do tempo) + e-mails de entrada/saída
-- Migração: tratativas_email (14/09/2026) · Projeto djguxdgaobtminatxkdr
--
-- Decisões do dono (14/09): e-mail sai pelo sistema (Resend) de ex@exeletric.com.br,
-- ex@ sempre em cópia oculta; respostas vão para ex@ (Outlook) E para o endereço de
-- registro respostas@r.exeletric.com.br, que grava tudo aqui. Aprovação: o sistema
-- SUGERE a classificação, uma pessoa CONFIRMA com 1 clique.
--
-- email_mensagens   = cada e-mail que passou pelo sistema (saída ou entrada), bruto.
-- orcamento_eventos = a linha do tempo da proposta (só adiciona; anular exige motivo).
-- ============================================================================

create table if not exists public.email_mensagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid,
  direcao text not null check (direcao in ('saida','entrada')),
  provedor text not null default 'resend',
  provedor_id text,                       -- id do e-mail no Resend (idempotência)
  message_id text, in_reply_to text, referencias text,
  de text, para text[], cc text[], bcc text[], reply_to text[],
  assunto text, texto text, html text,
  anexos jsonb not null default '[]'::jsonb,   -- [{nome, path, tipo, tamanho}]
  orcamento_id uuid references public.orcamentos(id),
  oportunidade_id uuid,
  versao_id uuid references public.orcamento_versoes(id),
  revisao integer,
  vinculo text check (vinculo in ('envio','tag','cabecalho','remetente','manual','nenhum')),
  entrega text,                           -- saída: enviado / entregue / devolvido / reclamacao
  entrega_em timestamptz,
  ocorrido_em timestamptz not null default now(),
  bruto jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.email_mensagens is 'E-mails de propostas que passaram pelo sistema (saída pelo Resend, entrada pelo endereço de registro).';
create unique index if not exists email_mensagens_prov_uk on public.email_mensagens(provedor, provedor_id, direcao) where provedor_id is not null;
create index if not exists email_mensagens_orc_idx on public.email_mensagens(orcamento_id);
create index if not exists email_mensagens_msgid_idx on public.email_mensagens(message_id);

create table if not exists public.orcamento_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid default public.empresa_atual(),
  orcamento_id uuid not null references public.orcamentos(id),
  oportunidade_id uuid,
  versao_id uuid references public.orcamento_versoes(id),
  revisao integer,
  tipo text not null check (tipo in (
    'envio',            -- revisão enviada (sistema ou e-mail próprio)
    'descarte',         -- revisão preparada e descartada
    'revisao',          -- nova revisão criada
    'email_cliente',    -- e-mail recebido do cliente (aguarda classificação)
    'email_ex',         -- resposta da eX capturada (Responder a todos)
    'entrega',          -- devolução / problema de entrega
    'contato',          -- ligação, WhatsApp, reunião (registro manual)
    'cobranca',
    'nota',
    'legado'            -- proposta marcada como enviada antes do sistema
  )),
  canal text,                             -- e-mail / telefone / WhatsApp / reunião / sistema
  titulo text,
  texto text,
  sugestao text check (sugestao in ('aprovacao','ajuste','recusa','duvida')),
  sugestao_motivo text,
  classificacao text check (classificacao in ('aprovacao','ajuste','recusa','duvida','outro')),
  classificacao_motivo text,              -- recusa: preço / prazo / escopo / concorrente / sem verba / outro
  classificado_por uuid, classificado_por_nome text, classificado_em timestamptz,
  mensagem_id uuid references public.email_mensagens(id),
  anexos jsonb not null default '[]'::jsonb,
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  ocorrido_em timestamptz not null default now(),
  anulado_em timestamptz, anulado_por uuid, anulado_por_nome text, anulado_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.orcamento_eventos is 'Linha do tempo das tratativas da proposta. Só adiciona: classificar uma vez, anular com motivo; nunca apagar.';
create index if not exists orcamento_eventos_orc_idx on public.orcamento_eventos(orcamento_id, ocorrido_em desc);
create index if not exists orcamento_eventos_opp_idx on public.orcamento_eventos(oportunidade_id);
create index if not exists orcamento_eventos_pend_idx on public.orcamento_eventos(orcamento_id) where tipo='email_cliente' and classificacao is null and anulado_em is null;

-- guarda: evento não se apaga; conteúdo não muda; classificar só uma vez; anular só uma vez e com motivo
create or replace function public.orc_evento_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Evento da linha do tempo não pode ser apagado (use anular com motivo)';
  end if;
  if new.orcamento_id is distinct from old.orcamento_id or new.tipo is distinct from old.tipo
     or new.texto is distinct from old.texto or new.titulo is distinct from old.titulo
     or new.ocorrido_em is distinct from old.ocorrido_em or new.mensagem_id is distinct from old.mensagem_id
     or new.criado_por is distinct from old.criado_por or new.anexos is distinct from old.anexos
     or new.sugestao is distinct from old.sugestao or new.canal is distinct from old.canal then
    raise exception 'Evento da linha do tempo é imutável';
  end if;
  if old.classificacao is not null and (new.classificacao is distinct from old.classificacao
     or new.classificacao_motivo is distinct from old.classificacao_motivo) then
    raise exception 'Evento já classificado (anule e registre de novo se foi engano)';
  end if;
  if old.anulado_em is not null and (new.anulado_em is distinct from old.anulado_em or new.anulado_motivo is distinct from old.anulado_motivo) then
    raise exception 'Evento já anulado';
  end if;
  if new.anulado_em is not null and old.anulado_em is null and coalesce(trim(new.anulado_motivo),'') = '' then
    raise exception 'Anular exige motivo';
  end if;
  if new.classificacao is not null and old.classificacao is null then
    new.classificado_em := coalesce(new.classificado_em, now());
    new.classificado_por := coalesce(new.classificado_por, auth.uid());
    if new.classificacao = 'recusa' and coalesce(trim(new.classificacao_motivo),'') = '' then
      raise exception 'Recusa exige motivo';
    end if;
  end if;
  -- vínculo a outra proposta (e-mail que chegou sem vínculo e foi ligado à mão) é permitido só enquanto não classificado
  return new;
end $$;

drop trigger if exists orc_evento_guard_upd on public.orcamento_eventos;
create trigger orc_evento_guard_upd before update on public.orcamento_eventos for each row execute function public.orc_evento_guard();
drop trigger if exists orc_evento_guard_del on public.orcamento_eventos;
create trigger orc_evento_guard_del before delete on public.orcamento_eventos for each row execute function public.orc_evento_guard();
drop trigger if exists orc_evento_updated on public.orcamento_eventos;
create trigger orc_evento_updated before update on public.orcamento_eventos for each row execute function public.set_updated_at();
drop trigger if exists email_mensagens_updated on public.email_mensagens;
create trigger email_mensagens_updated before update on public.email_mensagens for each row execute function public.set_updated_at();

-- RLS: mesma regra das demais tabelas (empresa do usuário; fundador vê tudo).
-- E-mails de entrada sem vínculo ficam com empresa_id nulo: só o fundador enxerga até alguém ligar.
alter table public.orcamento_eventos enable row level security;
drop policy if exists iso_emp on public.orcamento_eventos;
create policy iso_emp on public.orcamento_eventos for all to authenticated
  using (public.eh_fundador() or empresa_id = public.empresa_atual())
  with check (public.eh_fundador() or empresa_id = public.empresa_atual());

alter table public.email_mensagens enable row level security;
drop policy if exists iso_emp_sel on public.email_mensagens;
create policy iso_emp_sel on public.email_mensagens for select to authenticated
  using (public.eh_fundador() or empresa_id = public.empresa_atual());
drop policy if exists iso_emp_upd on public.email_mensagens;
create policy iso_emp_upd on public.email_mensagens for update to authenticated
  using (public.eh_fundador() or empresa_id = public.empresa_atual())
  with check (public.eh_fundador() or empresa_id = public.empresa_atual());
-- insert/delete: só as Edge Functions (service role). Ninguém apaga e-mail pelo app.
