# Gestão de Projetos de Campo — eX Eletric

Sistema de acompanhamento de projetos de automação/elétrica, com banco de dados versionado e cálculo automático de custo por tarefa, 100% dentro do GitHub.

## Como funciona

- **Cada projeto** = um GitHub Project (quadro Kanban / Tabela / Roadmap).
- **Cada tarefa** = uma issue, agrupada por fase via *Milestone* e campo `Fase`.
- **Banco de dados** = arquivos JSON versionados na pasta [`/dados`](dados).
- **Cálculo de custo** = um GitHub Action lê o serviço e o executor da issue, calcula horas e custo e posta o resultado, congelando o valor/hora aplicado.

## Banco de dados (`/dados`)

| Arquivo | O que guarda |
|---|---|
| [`tipos-profissional.json`](dados/tipos-profissional.json) | Funções (Técnico, Engenheiro, Subcontratado...) |
| [`colaboradores.json`](dados/colaboradores.json) | Pessoas/equipes, com `valor_hora_vigente` |
| [`catalogo-servicos.json`](dados/catalogo-servicos.json) | Serviços e tempo padrão (`horas_por_unidade`) |

Os 15 colaboradores e os ~40 serviços foram extraídos da planilha base. **Os valores/hora estão em branco (`null`)** — preencha em `colaboradores.json`.

## Regras de negócio

1. **Valor/hora temporal (snapshot):** `valor_hora_vigente` é o valor atual do colaborador. Ao alocá-lo numa tarefa, o valor é **congelado** na issue como `valor_hora_aplicado`. Reajustar o valor vigente **não altera** o custo histórico das tarefas já calculadas.
2. **Histórico de auditoria:** como os arquivos são versionados pelo git, toda mudança de valor/hora fica registrada (quem, quando, de quanto para quanto).
3. **Sem custo direto:** colaboradores do tipo `CLIENTE` ou `PARCEIRO` têm valor/hora 0 e não entram no custo do projeto.

## Cálculo

```
horas_total = quantidade × horas_por_unidade (do serviço)
custo_total = horas_total × valor_hora_aplicado (do executor)
```

## Como criar uma tarefa

Abra uma issue pelo template **Tarefa de projeto** e preencha:

```
servico: sensor_chiller_inst_completa
executor: joel
responsavel: andre_camilo
quantidade: 3
```

O Action calcula e comenta o custo automaticamente. Use os `id` dos arquivos em `/dados`.

## Ordem de cadastro recomendada

1. Tipos de profissional → 2. Colaboradores → 3. Catálogo → 4. Projeto → 5. Grupos/Fases → 6. Tarefas
