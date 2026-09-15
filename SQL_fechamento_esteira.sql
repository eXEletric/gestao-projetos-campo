-- Esteira pós-aprovação · entrega 1 (14/09/2026)
-- Departamentos (Comercial/Financeiro/Operacional) + membros + registro do fechamento (liberação do Financeiro)
-- Formalização NÃO tem tabela: vem dos comprovantes da proposta (orcamentos.dados.comprovantes, tipo 'contrato' ou 'os').

create table if not exists public.departamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  chave text not null check (chave ~ '^[a-z_]+$'),
  nome text not null,
  email text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, chave)
);

create table if not exists public.departamento_membros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  departamento_id uuid not null references public.departamentos(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  colaborador_id uuid references public.colaboradores(id),
  created_at timestamptz not null default now(),
  check (user_id is not null or colaborador_id is not null),
  unique (departamento_id, user_id)
);

alter table public.departamentos enable row level security;
alter table public.departamento_membros enable row level security;
drop policy if exists dep_sel on public.departamentos;
drop policy if exists dep_adm on public.departamentos;
create policy dep_sel on public.departamentos for select using (eh_fundador() or empresa_id = empresa_atual());
create policy dep_adm on public.departamentos for all using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual())) with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));
drop policy if exists depm_sel on public.departamento_membros;
drop policy if exists depm_adm on public.departamento_membros;
create policy depm_sel on public.departamento_membros for select using (eh_fundador() or empresa_id = empresa_atual());
create policy depm_adm on public.departamento_membros for all using (eh_fundador() or (eh_adm() and empresa_id = empresa_atual())) with check (eh_fundador() or (eh_adm() and empresa_id = empresa_atual()));

drop trigger if exists departamentos_updated on public.departamentos;
create trigger departamentos_updated before update on public.departamentos for each row execute function set_updated_at();

-- o usuário logado é membro do departamento?
create or replace function public.no_departamento(p_chave text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from departamento_membros m join departamentos d on d.id=m.departamento_id
    where m.user_id=auth.uid() and d.chave=p_chave and d.ativo and d.deleted_at is null and d.empresa_id=empresa_atual());
$$;

insert into public.departamentos (empresa_id, chave, nome)
select e.id, v.chave, v.nome from public.empresas e
cross join (values ('comercial','Comercial'),('financeiro','Financeiro'),('operacional','Operacional')) v(chave,nome)
where e.id='00000000-0000-0000-0000-0000000000e1'
on conflict (empresa_id, chave) do nothing;

-- registro do fechamento (só adiciona; nada se edita nem apaga)
create table if not exists public.fechamento_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  oportunidade_id uuid not null references public.oportunidades(id),
  lote_id uuid references public.orcamento_lotes(id),
  orcamento_id uuid references public.orcamentos(id),
  tipo text not null check (tipo in ('financeiro_liberado','financeiro_devolvido','reenviado_financeiro','nota')),
  checklist jsonb,
  documento jsonb,
  motivo text,
  obs text,
  por_user uuid,
  por_nome text,
  como text,
  ocorrido_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists fechamento_eventos_opp on public.fechamento_eventos (oportunidade_id, ocorrido_em);
alter table public.fechamento_eventos enable row level security;
drop policy if exists fech_sel on public.fechamento_eventos;
drop policy if exists fech_ins on public.fechamento_eventos;
create policy fech_sel on public.fechamento_eventos for select using (eh_fundador() or empresa_id = empresa_atual());
create policy fech_ins on public.fechamento_eventos for insert with check (eh_fundador() or empresa_id = empresa_atual());

create or replace function public.fechamento_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Registro do fechamento não pode ser alterado nem apagado';
  end if;
  new.por_user := auth.uid();
  new.ocorrido_em := now();
  if new.tipo in ('financeiro_liberado','financeiro_devolvido') then
    if no_departamento('financeiro') then new.como := 'financeiro';
    elsif eh_fundador() then new.como := 'master';
    else raise exception 'Só o Financeiro (ou o master como financeiro) libera ou devolve';
    end if;
  end if;
  if new.tipo = 'financeiro_liberado' and not (
       coalesce((new.checklist->>'faturamento')::boolean,false)
   and coalesce((new.checklist->>'pagamento')::boolean,false)
   and coalesce((new.checklist->>'cliente')::boolean,false)) then
    raise exception 'Para liberar, confira os 3 itens (faturamento, pagamento, situação do cliente)';
  end if;
  if new.tipo = 'financeiro_liberado' and new.documento is null then
    raise exception 'Para liberar, a formalização (contrato ou OS do cliente) precisa estar anexada';
  end if;
  if new.tipo = 'financeiro_devolvido' and coalesce(trim(new.motivo),'') = '' then
    raise exception 'Devolver exige motivo';
  end if;
  return new;
end $$;
drop trigger if exists fechamento_guard_ins on public.fechamento_eventos;
drop trigger if exists fechamento_guard_mud on public.fechamento_eventos;
create trigger fechamento_guard_ins before insert on public.fechamento_eventos for each row execute function fechamento_guard();
create trigger fechamento_guard_mud before update or delete on public.fechamento_eventos for each row execute function fechamento_guard();
