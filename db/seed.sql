-- =====================================================================
-- eX Cronograma — Seed inicial (listas controladas)
-- Aplicar DEPOIS de schema.sql. Idempotente (on conflict do nothing).
-- =====================================================================

insert into funcoes (nome, ordem) values
  ('Téc. Automação',1),('Engenheiro',2),('Eletrotécnico',3),('Eletricista',4),
  ('Montador',5),('Mecânico',6),('Refrigerista',7),('Ajudante',8)
on conflict (nome) do nothing;

insert into niveis (nome, ordem) values
  ('Júnior',1),('Pleno',2),('Sênior',3)
on conflict (nome) do nothing;

insert into categorias (nome, icone, ordem) values
  ('Supervisório','device-desktop-analytics',1),
  ('Ar Condicionado','snowflake',2),
  ('Iluminação','bulb',3),
  ('Medição','gauge',4),
  ('Infraestrutura','plug',5),
  ('Sensores','temperature',6),
  ('Comissionamento','checklist',7)
on conflict (nome) do nothing;
