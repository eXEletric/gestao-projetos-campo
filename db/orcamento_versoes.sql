-- ============================================================================
-- eX Controller · Envio da proposta — revisões congeladas (R1, R2…)
-- Migração aplicada no Supabase em 11/09/2026: orcamento_versoes_envio
-- Projeto: djguxdgaobtminatxkdr
--
-- Cada envio grava uma cópia IMUTÁVEL da proposta. Ciclo:
--   preparada  → (confirmou "enviei + anexei") → enviada
--   preparada  → (desistiu)                    → descartada
--   enviada    → (R seguinte enviada)          → substituida
--   enviada    → (comprovante de aprovação)    → aprovada   [passo 4]
-- Depois de sair de "preparada", conteúdo (dados/total/para/assunto/corpo…) não muda
-- e a linha não pode ser apagada (trigger orc_versao_guard).
-- ============================================================================

create table if not exists public.orcamento_versoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid default public.empresa_atual(),
  orcamento_id uuid not null references public.orcamentos(id),
  oportunidade_id uuid,
  numero text not null,
  codigo text,
  revisao integer not null check (revisao >= 1),
  status text not null default 'preparada' check (status in ('preparada','enviada','descartada','substituida','aprovada')),
  dados jsonb not null,
  total numeric not null default 0,
  para text, cc text, assunto text, corpo text,
  pdf_path text,
  preparado_por uuid default auth.uid(),
  preparado_por_nome text,
  preparado_em timestamptz not null default now(),
  enviado_em timestamptz,
  descartado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.orcamento_versoes is 'Revisões congeladas da proposta no envio (R1, R2…). Enviada = imutável (trigger orc_versao_guard).';
create unique index if not exists orcamento_versoes_rev_uk on public.orcamento_versoes(orcamento_id, revisao) where status <> 'descartada' and deleted_at is null;
create index if not exists orcamento_versoes_orc_idx on public.orcamento_versoes(orcamento_id);
create index if not exists orcamento_versoes_opp_idx on public.orcamento_versoes(oportunidade_id);

alter table public.orcamento_versoes enable row level security;
drop policy if exists iso_emp on public.orcamento_versoes;
create policy iso_emp on public.orcamento_versoes for all to authenticated
  using (public.eh_fundador() or empresa_id = public.empresa_atual())
  with check (public.eh_fundador() or empresa_id = public.empresa_atual());

create or replace function public.orc_versao_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('preparada','descartada') then return old; end if;
    raise exception 'Revisão R% já enviada: não pode ser apagada', old.revisao;
  end if;
  if old.status <> 'preparada' then
    if new.dados is distinct from old.dados or new.total is distinct from old.total
       or new.revisao is distinct from old.revisao or new.numero is distinct from old.numero
       or new.codigo is distinct from old.codigo or new.orcamento_id is distinct from old.orcamento_id
       or new.para is distinct from old.para or new.cc is distinct from old.cc
       or new.assunto is distinct from old.assunto or new.corpo is distinct from old.corpo
       or new.enviado_em is distinct from old.enviado_em
       or (new.pdf_path is distinct from old.pdf_path and old.pdf_path is not null) then
      raise exception 'Revisão R% já enviada é imutável', old.revisao;
    end if;
    if old.status = 'descartada' and new.status <> 'descartada' then
      raise exception 'Revisão descartada não pode voltar';
    end if;
  end if;
  if old.status = 'preparada' and new.status = 'enviada' then new.enviado_em := coalesce(new.enviado_em, now()); end if;
  if old.status = 'preparada' and new.status = 'descartada' then new.descartado_em := now(); end if;
  return new;
end $$;

drop trigger if exists orc_versao_guard_upd on public.orcamento_versoes;
create trigger orc_versao_guard_upd before update on public.orcamento_versoes
  for each row execute function public.orc_versao_guard();
drop trigger if exists orc_versao_guard_del on public.orcamento_versoes;
create trigger orc_versao_guard_del before delete on public.orcamento_versoes
  for each row execute function public.orc_versao_guard();
drop trigger if exists orc_versao_updated on public.orcamento_versoes;
create trigger orc_versao_updated before update on public.orcamento_versoes
  for each row execute function public.set_updated_at();

-- PDF de cada revisão: bucket privado "anexos", caminho propostas/<orcamento_id>/<codigo>_R<n>.pdf
