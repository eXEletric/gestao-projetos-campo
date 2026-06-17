# Definições do Sistema — eX Cronograma

Documento oficial de requisitos, **ratificado item a item pelo usuário**.
A partir daqui, nenhuma definição muda sem aprovação explícita.

Data da ratificação: 17/06/2026

---

## 1. Plataforma
O sistema roda no **GitHub Projects**, com dados em arquivos versionados no repositório e automação para cálculo de custo.

## 2. Funções
**8 funções** (ofícios), com opção de cadastrar novas a qualquer momento:
Téc. Automação · Engenheiro · Eletrotécnico · Eletricista · Montador · Mecânico · Refrigerista · Ajudante

## 3. Níveis
Níveis **Júnior / Pleno / Sênior**, com **opção de adicionar novos níveis** quando necessário.

## 4 + 5. Cadastro por linha (função + nível + valor)
O valor/hora **não** vem de tabela geral. Ao cadastrar, adiciona-se uma **linha** com **Função + Nível + Valor/hora**, e cada linha tem seu próprio nível e valor.
- Um colaborador pode ter **várias linhas** (várias funções).
- Ao alocar numa tarefa, escolhe-se **qual linha** se aplica.

| Função | Nível | Valor/hora |
|---|---|---|
| Téc. Automação | Pleno | R$ 45 |
| Refrigerista | Sênior | R$ 58 |

## 6. Cliente e fabricante não geram custo
Cliente (Atacadão) e fabricante (Copeland) podem participar da tarefa, mas **não entram no custo** (R$ 0) — não é mão de obra própria.

## 7. Subcontratados
Entram no custo **por hora**, igual aos funcionários (`horas × valor/hora`). Sem empreitada por enquanto.

## 8. Catálogo: serviço com variações
Cada serviço tem **variações** = dificuldade/condição de campo, cada uma com seu **tempo padrão**. Na tarefa, escolhe-se serviço → variação → tempo é preenchido.

## 9. Variações editáveis em linha
Variações podem ser **adicionadas, editadas e deletadas em linha**, cada uma com seu tempo.

## 10. Categoria vinculada à atividade raiz
Categoria escolhida de **lista configurável** (add/editar). A mesma lista nomeia os **grupos raiz** do cronograma → dentro de um grupo, só aparecem serviços daquela categoria.

## 11. Materiais por serviço — FUTURO
Definição **adiada**. Registrado para quando for construído:
- Já existe uma **base de dados padrão** de materiais (referência) para partir dela.
- Deve permitir **selecionar e configurar materiais por função**.

## 12. Numeração WBS hierárquica
Grupo = `1`, tarefa = `1.1`, subtarefa = `1.1.1`. **Calculada pela posição** (nunca digitada), recalcula ao reordenar.

## 13. Ordenar e mudar nível
- Reordenar **arrastando** ou **digitando o número** da posição.
- **Promover/rebaixar** nível (subtarefa ↔ tarefa principal).
- Tudo recalcula a numeração WBS.

## 14. Quantidade só no cronograma
Quantidade preenchida **na linha do cronograma**, nunca no catálogo. Catálogo guarda só o **tipo base** (serviço + variação + tempo padrão).

## 15. Tempo editável por tarefa
Tempo vem do catálogo, mas pode ser **ajustado na tarefa**. Quando ajustado, fica **sinalizado** e mostra o tempo-base, com opção de voltar ao padrão.

## 16. Acompanhamento (visão principal)
Espelha a planilha Gantt:
- Tarefa com **progresso (%)**, **status**, **datas início/término**.
- **Barra Gantt** preenchida pelo progresso, **linha de hoje**, destaque de **atraso/risco** (detector de furo).
- Indicadores: **% executado**, concluídas, em andamento, em risco.

---

## Pendências (não são definições — são próximos passos)
1. Liberar o GitHub Action de custo (token precisa de escopo `workflow`).
2. Preencher valores/hora reais (função + nível por colaborador).
3. Materializar o banco de projetos/atividades no repositório.
4. Construir a camada de materiais (item 11).
