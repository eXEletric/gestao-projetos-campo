-- eX Controller · Contato por oportunidade · migração oportunidade_contato (14/09/2026) · projeto djguxdgaobtminatxkdr
-- Regra do dono: a OPORTUNIDADE manda no cliente/loja/contato da proposta. Trocar cliente = janela "Editar oportunidade".
-- Contato por oportunidade (ex.: Copeland = Denis numa proposta, Daniel em outra), sem mexer no cadastro do cliente.
-- Vazio = usa o contato do cadastro do cliente.
alter table public.oportunidades add column if not exists contato_nome text;
alter table public.oportunidades add column if not exists contato_fone text;
alter table public.oportunidades add column if not exists contato_email text;
comment on column public.oportunidades.contato_nome is 'Contato desta oportunidade (vazio = contato do cadastro do cliente). A proposta lê daqui.';
