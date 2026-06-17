# Modelo de Dados Cadastráveis — eX Cronograma

Atas da reunião de alinhamento (dev sênior). Ratificado pelo usuário.
Complementa o [DEFINICOES.md](DEFINICOES.md).

Data: 17/06/2026

---

## Arquitetura: dados globais x dados por projeto

- **Globais (compartilhados entre todos os projetos):** Colaboradores, Catálogo de serviços, Funções, Níveis, Categorias.
- **Por projeto:** metadados do projeto, Grupos (tarefas-pai), Tarefas e Subtarefas.

## Entidades e campos cadastráveis

### Projeto  *(NOVO — prioridade 1)*
Hoje o app tem um projeto fixo no código. Passa a cadastrar/gerenciar vários.
| Campo | Tipo | Obrigatório |
|---|---|---|
| numero_externo | texto | sim (vem de outro sistema) |
| nome | texto | sim |
| cliente | texto | sim |
| local (cidade/UF) | texto | não |
| lider | ref. colaborador | não |
| data_inicio | data | não |
| data_fim_prevista | data | não |
| status | Em andamento / Aguardando / Concluído / Suspenso | — |
| observacoes (escopo) | texto | não |

Requisito: **alternar entre projetos**; cada um com seu próprio cronograma.

### Grupo (tarefa-pai)
| Campo | Tipo |
|---|---|
| nome | texto |
| categoria | ref. categoria (filtra serviços) |
| ordem | calculada pela posição |

### Tarefa / Subtarefa
| Campo | Tipo | Observação |
|---|---|---|
| serviço + variação | ref. catálogo | variação = dificuldade → tempo |
| nome | texto | editável livre |
| quantidade | número | só no cronograma |
| tempo/und | número | editável (ajusta sobre o catálogo) |
| executor | ref. colaborador | quem executa |
| função aplicada | ref. linha do colaborador | define valor/hora congelado |
| **responsável (gestor)** | ref. colaborador | **NOVO** — quem responde pela tarefa |
| **prioridade** | Alta / Média / Baixa | **NOVO** |
| progresso % | número 0–100 | |
| status | A fazer / Em andamento / Concluída / Congelada | segue o progresso |
| data início / término previstos | data | |
| **data real de conclusão** | data | **NOVO** — previsto x realizado |
| **observações/notas** | texto | **NOVO** — anotações de campo |
| nível | grupo(0)/tarefa(1)/subtarefa(2) | WBS calculado |

### Colaborador
nome · gera_custo · ativo · linhas[ {função, nível, valor/hora} ] · (sem dados contratuais)

### Catálogo / Serviço
nome · categoria · unidade · variações[ {nome, horas} ] · (material: futuro)

### Funções / Níveis / Categorias
Listas configuráveis (nome). Globais.

## Exportação / Importação Excel  *(decidido: ida e volta)*
- **Export:** baixar `.xlsx` do cronograma do projeto ativo — grupos, tarefas, WBS, executor, função, qtd, horas, custo, progresso, status, datas, prioridade, responsável, notas.
- **Import:** reimportar um `.xlsx` editado de volta ao app (edição em massa).

## Plano de construção (fases)
1. **Multi-projeto** — entidade Projeto + cadastro + alternância (refatora o estado do app).
2. **Campos novos da Tarefa** — responsável, prioridade, data real, notas (no modal de edição e nas views).
3. **Export + Import Excel**.
