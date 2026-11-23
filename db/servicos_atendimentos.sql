-- Serviços · atendimentos pontuais (corretiva, preventiva, visita técnica, serviço avulso) — 23/11/2026
-- Regras combinadas com o André:
--   * Toda demanda vira um ATENDIMENTO (nº AT-AAAA-NNNN por empresa e ano). Não se apaga: cancela com motivo.
--   * Modalidades configuráveis (Corretiva, Preventiva, Visita técnica, Serviço avulso).
--   * Cobrança da visita: 'contrato' (sem custo, EXIGE contrato prévio), 'cortesia' (para orçamento) ou 'cobrada' (com valor).
--   * Visita cortesia registra o custo real (km, horas, valor) para enxergar o gasto com orçamentos não fechados.
--   * Etapas: aberto → visita agendada → visita feita → orçamento → aguardando aprovação → aprovado → em execução → concluído (ou cancelado).
--   * Histórico só adiciona (atendimento_eventos): mudança de etapa é registrada automaticamente.
-- Seguro de rodar mais de uma vez.

-- 1) Modalidades (configuráveis) ------------------------------------------------
create table if not exists public.atendimento_modalidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references public.empresas(id),
  nome text not null,
  sigla text,
  icone text,
  descricao text,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.atendimento_modalidades enable row level security;
drop policy if exists iso_emp on public.atendimento_modalidades;
create policy iso_emp on public.atendimento_modalidades for all to authenticated
  using (eh_fundador() or empresa_id = empresa_atual())
  with check (eh_fundador() or empresa_id = empresa_atual());

-- 2) Contratos de serviço (preventiva / cobertura de visitas) ------------------
create table if not exists public.servico_contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references public.empresas(id),
  cliente_id uuid not null references public.clientes(id),
  titulo text not null,
  numero_cliente text,
  vigencia_inicio date,
  vigencia_fim date,
  frequencia text not null default 'mensal' check (frequencia in ('semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','sob_demanda')),
  valor_mensal numeric,
  cobre_visitas boolean not null default true,
  obs text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists servico_contratos_cliente on public.servico_contratos (cliente_id);
alter table public.servico_contratos enable row level security;
drop policy if exists iso_emp on public.servico_contratos;
create policy iso_emp on public.servico_contratos for all to authenticated
  using (eh_fundador() or empresa_id = empresa_atual())
  with check (eh_fundador() or empresa_id = empresa_atual());

-- 3) Atendimentos ---------------------------------------------------------------
create table if not exists public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references public.empresas(id),
  numero text,
  ano int,
  seq int,
  modalidade_id uuid references public.atendimento_modalidades(id),
  status text not null default 'aberto' check (status in ('aberto','visita_agendada','visita_feita','orcamento','aguardando_aprovacao','aprovado','em_execucao','concluido','cancelado')),
  prioridade text not null default 'media' check (prioridade in ('baixa','media','alta','urgente')),
  cliente_id uuid references public.clientes(id),
  loja_id uuid references public.lojas(id),
  contrato_id uuid references public.servico_contratos(id),
  oportunidade_id uuid references public.oportunidades(id),
  orcamento_id uuid references public.orcamentos(id),
  os_id uuid references public.ordens_servico(id),
  titulo text not null,
  solicitacao text,
  equipamento text,
  origem text,
  chamado_cliente text,
  contato_nome text,
  contato_fone text,
  aberto_em timestamptz not null default now(),
  -- visita
  visita_cobranca text check (visita_cobranca in ('contrato','cortesia','cobrada')),
  visita_valor numeric,
  visita_data timestamptz,
  visita_responsavel text,
  visita_custo_km numeric,
  visita_custo_horas numeric,
  visita_custo_valor numeric,
  relatorio_url text,
  -- execução
  parceiro_nome text,
  valor_aprovado numeric,
  execucao_inicio date,
  execucao_fim date,
  concluido_em timestamptz,
  cancelado_em timestamptz,
  cancelado_motivo text,
  obs text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, numero)
);
create index if not exists atendimentos_status on public.atendimentos (empresa_id, status);
create index if not exists atendimentos_cliente on public.atendimentos (cliente_id);
alter table public.atendimentos enable row level security;
drop policy if exists iso_emp on public.atendimentos;
create policy iso_emp on public.atendimentos for all to authenticated
  using (eh_fundador() or empresa_id = empresa_atual())
  with check (eh_fundador() or empresa_id = empresa_atual());

-- 4) Histórico (só adiciona) ----------------------------------------------------
create table if not exists public.atendimento_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default empresa_atual() references public.empresas(id),
  atendimento_id uuid not null references public.atendimentos(id),
  tipo text not null default 'nota',   -- nota | etapa | criado | cancelado
  de text,
  para text,
  texto text,
  autor_id uuid default auth.uid(),
  autor_nome text,
  created_at timestamptz not null default now()
);
create index if not exists atendimento_eventos_at on public.atendimento_eventos (atendimento_id, created_at);
alter table public.atendimento_eventos enable row level security;
drop policy if exists ae_sel on public.atendimento_eventos;
drop policy if exists ae_ins on public.atendimento_eventos;
create policy ae_sel on public.atendimento_eventos for select to authenticated
  using (eh_fundador() or empresa_id = empresa_atual());
create policy ae_ins on public.atendimento_eventos for insert to authenticated
  with check (eh_fundador() or empresa_id = empresa_atual());

create or replace function public.atendimento_eventos_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'Histórico do atendimento só adiciona: não se edita nem se apaga';
end $$;
drop trigger if exists atendimento_eventos_guard on public.atendimento_eventos;
create trigger atendimento_eventos_guard before update or delete on public.atendimento_eventos
  for each row execute function atendimento_eventos_guard();

-- 5) Regras do atendimento ------------------------------------------------------
create or replace function public.atendimento_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_ano int; v_ct record;
begin
  if tg_op = 'DELETE' then raise exception 'Atendimento não se apaga: cancele com motivo'; end if;

  if tg_op = 'INSERT' then
    v_ano := extract(year from now())::int;
    perform pg_advisory_xact_lock(hashtext('at:'||new.empresa_id::text||':'||v_ano));
    select coalesce(max(seq),0)+1 into new.seq from atendimentos where empresa_id = new.empresa_id and ano = v_ano;
    new.ano := v_ano;
    new.numero := 'AT-'||v_ano||'-'||lpad(new.seq::text,4,'0');
    new.created_at := now();
  else
    if new.numero is distinct from old.numero or new.seq is distinct from old.seq or new.ano is distinct from old.ano
       or new.empresa_id is distinct from old.empresa_id then
      raise exception 'Número do atendimento não muda';
    end if;
    if old.status = 'cancelado' and new.status <> 'cancelado' then raise exception 'Atendimento cancelado não reabre'; end if;
  end if;

  -- cobrança da visita
  if new.visita_cobranca = 'contrato' then
    if new.contrato_id is null then
      raise exception 'Visita sem custo exige contrato prévio: escolha o contrato do cliente ou marque cortesia/cobrada';
    end if;
    select * into v_ct from servico_contratos where id = new.contrato_id;
    if v_ct.cliente_id is distinct from new.cliente_id then raise exception 'O contrato escolhido é de outro cliente'; end if;
    if not v_ct.ativo or v_ct.deleted_at is not null then raise exception 'O contrato escolhido está inativo'; end if;
    if v_ct.vigencia_fim is not null and v_ct.vigencia_fim < current_date then raise exception 'O contrato escolhido está vencido'; end if;
  end if;
  if new.visita_cobranca = 'cobrada' and coalesce(new.visita_valor,0) <= 0 then
    raise exception 'Visita cobrada exige o valor da visita';
  end if;

  -- cancelar
  if new.status = 'cancelado' and (tg_op = 'INSERT' or old.status <> 'cancelado') then
    if coalesce(trim(new.cancelado_motivo),'') = '' then raise exception 'Cancelar exige motivo'; end if;
    new.cancelado_em := now();
  end if;
  if new.status = 'concluido' and (tg_op = 'INSERT' or old.status <> 'concluido') then
    new.concluido_em := coalesce(new.concluido_em, now());
  end if;

  new.updated_at := now();
  return new;
end $$;
drop trigger if exists atendimento_guard_ins on public.atendimentos;
drop trigger if exists atendimento_guard_mud on public.atendimentos;
create trigger atendimento_guard_ins before insert on public.atendimentos for each row execute function atendimento_guard();
create trigger atendimento_guard_mud before update or delete on public.atendimentos for each row execute function atendimento_guard();

-- histórico automático: criação e mudança de etapa
create or replace function public.atendimento_log() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    insert into atendimento_eventos (empresa_id, atendimento_id, tipo, para, texto)
      values (new.empresa_id, new.id, 'criado', new.status, 'Atendimento aberto');
  elsif new.status is distinct from old.status then
    insert into atendimento_eventos (empresa_id, atendimento_id, tipo, de, para, texto)
      values (new.empresa_id, new.id, case when new.status='cancelado' then 'cancelado' else 'etapa' end,
              old.status, new.status, case when new.status='cancelado' then new.cancelado_motivo end);
  end if;
  return null;
end $$;
drop trigger if exists atendimento_log on public.atendimentos;
create trigger atendimento_log after insert or update on public.atendimentos for each row execute function atendimento_log();

-- 6) Modalidades padrão (só se a empresa ainda não tem nenhuma) ---------------
insert into public.atendimento_modalidades (empresa_id, nome, sigla, icone, descricao, ordem)
select e.id, m.nome, m.sigla, m.icone, m.descricao, m.ordem
from public.empresas e
cross join (values
  ('Corretiva','COR','build','Algo quebrou: o cliente abre o chamado e a eX avalia e corrige.',1),
  ('Preventiva','PRE','event_repeat','Visita programada por contrato, na frequência combinada.',2),
  ('Visita técnica','VIS','location_on','Avaliar e orçar, sem executar nada ainda.',3),
  ('Serviço avulso','AVU','handyman','Trabalho pontual já orçado (instalação, adequação).',4)
) as m(nome, sigla, icone, descricao, ordem)
where not exists (select 1 from public.atendimento_modalidades x where x.empresa_id = e.id);
