-- Esteira pós-aprovação · entrega 2 (14/09/2026): OS interna da eX
-- Gera: Operacional (ou fundador "como master"), só depois da liberação do Financeiro.
-- Lote: liberação fica na oportunidade-base do lote (base_oportunidade_id); OS é por loja (oportunidade da unidade).
-- Nº sequencial por empresa e ano: OS-AAAA-NNNN. Não se apaga: cancela com motivo.

create table if not exists public.ordens_servico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  numero text,
  ano int,
  seq int,
  oportunidade_id uuid not null references public.oportunidades(id),
  base_oportunidade_id uuid references public.oportunidades(id),
  lote_id uuid references public.orcamento_lotes(id),
  orcamento_id uuid references public.orcamentos(id),
  versao_id uuid references public.orcamento_versoes(id),
  proposta_numero text,
  revisao int,
  loja_id uuid,
  contratante_nome text,
  loja_nome text,
  titulo text,
  local text,
  os_cliente text,
  escopo jsonb not null default '{}'::jsonb,
  executor_colaborador_id uuid references public.colaboradores(id),
  executor_nome text,
  equipe jsonb not null default '[]'::jsonb,
  inicio_previsto date,
  fim_previsto date,
  obs text,
  status text not null default 'emitida' check (status in ('emitida','assinada','cancelada')),
  assinatura_png text,
  assinado_nome text,
  assinado_em timestamptz,
  cancelado_em timestamptz,
  cancelado_motivo text,
  cancelado_por_nome text,
  projeto_id uuid references public.projetos(id),
  gerada_por uuid,
  gerada_por_nome text,
  como text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create unique index if not exists ordens_servico_uma_ativa on public.ordens_servico (oportunidade_id) where status <> 'cancelada';
create index if not exists ordens_servico_base on public.ordens_servico (base_oportunidade_id);

alter table public.ordens_servico enable row level security;
drop policy if exists os_sel on public.ordens_servico;
drop policy if exists os_ins on public.ordens_servico;
drop policy if exists os_upd on public.ordens_servico;
create policy os_sel on public.ordens_servico for select using (eh_fundador() or empresa_id = empresa_atual());
create policy os_ins on public.ordens_servico for insert with check (eh_fundador() or empresa_id = empresa_atual());
create policy os_upd on public.ordens_servico for update using (eh_fundador() or empresa_id = empresa_atual()) with check (eh_fundador() or empresa_id = empresa_atual());

create or replace function public.os_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_ult text; v_ano int; v_op boolean;
begin
  if tg_op = 'DELETE' then raise exception 'OS não se apaga: cancele com motivo'; end if;
  v_op := no_departamento('operacional') or eh_fundador();
  if tg_op = 'INSERT' then
    if no_departamento('operacional') then new.como := 'operacional';
    elsif eh_fundador() then new.como := 'master';
    else raise exception 'Só o Operacional (ou o master como operacional) gera OS';
    end if;
    select tipo into v_ult from fechamento_eventos
      where oportunidade_id = coalesce(new.base_oportunidade_id, new.oportunidade_id) and tipo <> 'nota'
      order by ocorrido_em desc limit 1;
    if coalesce(v_ult,'') <> 'financeiro_liberado' then
      raise exception 'OS só depois da liberação do Financeiro';
    end if;
    v_ano := extract(year from now())::int;
    perform pg_advisory_xact_lock(hashtext('os:'||new.empresa_id::text||':'||v_ano));
    select coalesce(max(seq),0)+1 into new.seq from ordens_servico where empresa_id = new.empresa_id and ano = v_ano;
    new.ano := v_ano;
    new.numero := 'OS-'||v_ano||'-'||lpad(new.seq::text,4,'0');
    new.gerada_por := auth.uid();
    new.status := 'emitida';
    new.assinatura_png := null; new.assinado_em := null; new.assinado_nome := null;
    new.cancelado_em := null; new.cancelado_motivo := null; new.projeto_id := null;
    new.created_at := now();
    return new;
  end if;
  -- UPDATE
  if new.numero is distinct from old.numero or new.seq is distinct from old.seq or new.ano is distinct from old.ano
     or new.empresa_id is distinct from old.empresa_id or new.oportunidade_id is distinct from old.oportunidade_id
     or new.base_oportunidade_id is distinct from old.base_oportunidade_id or new.lote_id is distinct from old.lote_id
     or new.orcamento_id is distinct from old.orcamento_id or new.versao_id is distinct from old.versao_id
     or new.escopo is distinct from old.escopo or new.os_cliente is distinct from old.os_cliente
     or new.proposta_numero is distinct from old.proposta_numero or new.revisao is distinct from old.revisao
     or new.gerada_por is distinct from old.gerada_por or new.gerada_por_nome is distinct from old.gerada_por_nome
     or new.como is distinct from old.como or new.created_at is distinct from old.created_at then
    raise exception 'Campos da OS emitida não mudam (número, escopo, origem)';
  end if;
  if old.status = 'cancelada' then raise exception 'OS cancelada não muda'; end if;
  if old.assinatura_png is not null and (new.assinatura_png is distinct from old.assinatura_png
     or new.assinado_em is distinct from old.assinado_em or new.assinado_nome is distinct from old.assinado_nome) then
    raise exception 'Assinatura já registrada';
  end if;
  if old.projeto_id is not null and new.projeto_id is distinct from old.projeto_id then
    raise exception 'OS já tem atendimento criado';
  end if;
  -- assinar
  if old.assinatura_png is null and new.assinatura_png is not null then
    if coalesce(trim(new.assinado_nome),'') = '' then raise exception 'Assinatura exige o nome de quem assina'; end if;
    new.assinado_em := now(); new.status := 'assinada';
  end if;
  -- cancelar
  if new.status = 'cancelada' then
    if not v_op then raise exception 'Só o Operacional (ou o master) cancela OS'; end if;
    if coalesce(trim(new.cancelado_motivo),'') = '' then raise exception 'Cancelar exige motivo'; end if;
    new.cancelado_em := now();
  elsif new.status is distinct from old.status and not (old.status='emitida' and new.status='assinada' and new.assinatura_png is not null) then
    raise exception 'Mudança de status inválida';
  end if;
  -- executor/equipe/datas/local/obs: só Operacional (ou master), e só antes da assinatura
  if (new.executor_colaborador_id is distinct from old.executor_colaborador_id or new.executor_nome is distinct from old.executor_nome
      or new.equipe is distinct from old.equipe or new.inicio_previsto is distinct from old.inicio_previsto
      or new.fim_previsto is distinct from old.fim_previsto or new.local is distinct from old.local or new.obs is distinct from old.obs) then
    if not v_op then raise exception 'Só o Operacional (ou o master) edita a OS'; end if;
    if old.assinatura_png is not null then raise exception 'OS já assinada: para mudar o executor, cancele e gere outra'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists os_guard_ins on public.ordens_servico;
drop trigger if exists os_guard_mud on public.ordens_servico;
create trigger os_guard_ins before insert on public.ordens_servico for each row execute function os_guard();
create trigger os_guard_mud before update or delete on public.ordens_servico for each row execute function os_guard();
