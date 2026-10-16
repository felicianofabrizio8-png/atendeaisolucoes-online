# Metas — especificação

Data: 16/10/2026 · Branch: `isaque3` · Depende de: `20261007180000_team_permissions_and_assignment.sql` (permissões e responsável do lead) e, para o indicador de compromissos, `20261016120000_agenda_team_hierarchy.sql`.

## 1. Objetivo

Uma aba **Metas** em que o administrador monta, do zero, as metas da empresa, de pessoas e de grupos, e acompanha tudo num painel no estilo do dashboard. A Lume analisa as metas todos os dias, aponta riscos e sugere ajustes que o admin aplica com um toque. O usuário comum vê as próprias metas e as da empresa, com dicas pessoais da Lume.

Sucesso:
- O admin cria uma meta automática ("R$ 100 mil em vendas no mês") e uma manual ("8 posts") pelo formulário, sem nenhum modelo pronto.
- O progresso automático bate com os dados reais e é o mesmo número para todos que podem ver a meta.
- A visão semanal mostra o ritmo real de cada semana, a partir de fotos diárias, e não de estimativas.
- A Lume entrega, todo dia, um resumo, pontos de atenção e sugestões aplicáveis; nada muda sem confirmação do admin.
- Um funcionário não cria, edita nem move metas, nem pela tela nem chamando a API, e não vê metas individuais de colegas.
- Funciona bem de 320 px (celular pequeno) a desktop largo.

## 2. Decisões (confirmadas com o usuário)

| Tema | Decisão |
| --- | --- |
| Medição | Cada meta é **automática** (indicador do sistema) ou **manual** (lançamentos). |
| Alcance | **Empresa**, **pessoa** ou **grupo de pessoas**. |
| Prazo | **Prazo único** (início/fim) ou **recorrente** (semanal/mensal). Toda meta é quebrada em **ritmo semanal**. |
| Customização | **Sem modelos prontos.** Tudo é criado pelo admin num formulário no estilo de Orçamentos/Agenda. A única lista fixa é a de **indicadores** que o sistema sabe medir. |
| Kanban | Colunas = **etapas criadas pelo admin** (arrastáveis). Cada cartão tem **selo automático** de situação. |
| IA | **Análise diária automática** + **Pergunte à Lume** + **sugestões aplicáveis com confirmação** + **dicas pessoais** para o usuário. |
| Arquitetura | Cálculo **no banco** ao abrir a tela + **foto diária** gravada por rotina agendada. |

## 3. Regras de negócio

### 3.1 Permissões

| Permissão | Rótulo na tela | Padrão |
| --- | --- | --- |
| `goals.view` *(nova)* | Ver metas | Todos |
| `goals.manage` *(nova)* | Gerenciar metas | Administrador (o admin pode dar a outros) |

- `goals.view`: vê as metas de alcance **empresa** e as de **pessoa/grupo** em que participa.
- `goals.manage`: vê todas; cria, edita, exclui, move no kanban, gerencia etapas e aplica sugestões da Lume.
- Lançamento manual: quem tem `goals.manage`, ou um participante da meta manual.
- Rota `/metas` exige `goals.view`; rotas `/api/goals/*` seguem `routePermission` como as demais.

### 3.2 Meta

Campos:
- **Identidade**: nome (obrigatório, até 120), descrição (opcional), cor (matiz).
- **Medição**: `automatica` ou `manual`.
  - Automática: `indicador` (lista da seção 3.3) e `alvo` numérico; para tempo de resposta o sentido é "menor é melhor".
  - Manual: `alvo` numérico e `unidade` livre (até 24 caracteres, ex.: "visitas").
- **Alcance**: `empresa`, `pessoa` ou `grupo`; participantes (1 para pessoa, 2+ para grupo).
- **Prazo**: `inicio` e `fim` (prazo único), ou `recorrencia` = `semanal` | `mensal` com data de início.
- **Etapa do kanban**: uma das etapas da empresa.
- **Arquivada**: some das visões ativas, fica no histórico.

Validações: fim depois do início; alvo > 0; grupo com 2+ pessoas; indicador obrigatório se automática.

### 3.3 Indicadores automáticos

Contados no período da meta e, quando o alcance é pessoa/grupo, filtrados pelos participantes.

| Indicador | Cálculo | Atribuição por pessoa |
| --- | --- | --- |
| Receita fechada | soma de `leads.closed_value` com `status = 'fechado'` e `closed_at` no período | `leads.assigned_to` |
| Vendas fechadas | contagem dos mesmos leads | `leads.assigned_to` |
| Leads novos | leads com `created_at` no período | `leads.assigned_to` |
| Taxa de conversão | vendas fechadas ÷ leads novos no período | `leads.assigned_to` |
| Orçamentos criados | `quotes.created_at` no período | `assigned_to` do lead do orçamento |
| Orçamentos enviados | orçamentos que saíram de `rascunho` (enviado, visualizado, aceito, recusado ou expirado), contados por `quotes.sent_at` quando registrada e, na falta dela, por `created_at` | `assigned_to` do lead do orçamento |
| Conversas respondidas | conversas com ao menos uma mensagem `agent` enviada no período | `assigned_to` do lead da conversa |
| Tempo médio de 1ª resposta | para conversas cuja primeira mensagem `lead` cai no período: minutos até a primeira mensagem `agent` seguinte; média (menor é melhor; conversas sem resposta ficam fora da média) | `assigned_to` do lead |
| Compromissos concluídos | `visits` com `status = 'concluida'` no período | `visits.owner_id` *(exige a migração da Agenda; sem ela, o indicador não aparece no formulário)* |

Leads, orçamentos ou conversas sem responsável contam só em metas de alcance **empresa**.

### 3.4 Ritmo semanal e selo de situação

- **Esperado até hoje** = alvo × (dias decorridos ÷ dias do período). Para "menor é melhor", o esperado é o próprio alvo em todo o período.
- **Semanas**: o período é dividido em semanas de segunda a domingo; a primeira e a última podem ser parciais. A meta semanal é proporcional aos dias da semana dentro do período.
- **Selo** (recalculado ao abrir a tela e na rotina diária):
  - **Concluída**: realizado ≥ alvo (ou ≤ alvo, quando menor é melhor, ao fim do período).
  - **No ritmo**: realizado ≥ 90% do esperado.
  - **Em risco**: entre 70% e 90% do esperado.
  - **Atrasada**: abaixo de 70% do esperado.
  - **Sem dados**: indicador sem registros no período, antes do primeiro terço do prazo. Não mostra alerta.
  - **Encerrada**: prazo terminou sem atingir; vai para o histórico.
- **Recorrência**: no fim do período a rotina diária fecha a ocorrência (com resultado e selo finais) e abre a próxima com o mesmo alvo.

### 3.5 Etapas do kanban

- Criadas pelo admin: nome (até 40), cor e ordem. Nenhuma vem criada.
- Enquanto a empresa não tiver etapas, o kanban mostra um único grupo "Sem etapa" e um convite para criar as etapas.
- Excluir uma etapa com metas pede para escolher a etapa de destino.

## 4. Modelo de dados

Migração nova `20261017120000_goals.sql`, aditiva e reexecutável, com testes em PGlite.

```
goal_stages (id, company_id, name, hue, position, created_at)

goals (id, company_id, name, description, hue,
       measure text check in ('automatica','manual'),
       metric text null,            -- indicador da seção 3.3
       target numeric not null check (target > 0),
       unit text null,              -- só manual
       lower_is_better boolean default false,
       scope text check in ('empresa','pessoa','grupo'),
       starts_on date not null, ends_on date null,
       recurrence text null check in ('semanal','mensal'),
       stage_id uuid null references goal_stages on delete set null,
       archived_at timestamptz null,
       created_by uuid, created_at, updated_at)

goal_members (goal_id, user_id, PK(goal_id, user_id))

goal_periods (id, goal_id, starts_on, ends_on, final_value numeric null,
              final_status text null, closed_at timestamptz null)
              -- uma linha por ocorrência; prazo único tem uma só

goal_entries (id, goal_id, period_id, user_id, amount numeric, note text,
              created_at)        -- lançamentos das metas manuais

goal_snapshots (goal_id, period_id, day date, value numeric, expected numeric,
                status text, PK(goal_id, period_id, day))

goal_insights (id, company_id, kind text check in ('resumo','atencao','sugestao','dica'),
               goal_id null, user_id null,    -- dica: para uma pessoa
               body text, action jsonb null,  -- sugestão aplicável
               state text default 'pendente' check in ('pendente','aplicada','dispensada'),
               generated_on date, decided_by uuid null, decided_at timestamptz null)
```

Permissões novas `goals.view` e `goals.manage` entram no catálogo de `company_member_access.permissions` com os padrões da seção 3.1.

## 5. Segurança no banco

- Funções `SECURITY DEFINER` (mesmo padrão da Agenda):
  - `goals_can_manage(company)`: admin ou `goals.manage`.
  - `goals_can_see(goal)`: gestor; ou alcance `empresa` com `goals.view`; ou participante.
- **RLS**:
  - `goals`, `goal_members`, `goal_stages`, `goal_periods`: leitura por `goals_can_see` (etapas: qualquer membro com `goals.view`); escrita só gestor.
  - `goal_entries`: leitura por `goals_can_see`; inserção pelo gestor ou por participante de meta manual (`user_id = auth.uid()`).
  - `goal_snapshots`: leitura por `goals_can_see`; escrita só pela chave de serviço (rotina diária).
  - `goal_insights`: leitura do resumo/atenção/sugestão para quem vê a meta; `dica` só para o `user_id` dela; decidir sugestão só gestor.
- **Progresso**: RPC `goals_progress(_company uuid, _goal_ids uuid[] default null)` devolve, por meta e período atual, realizado, esperado, selo, semanas (realizado × esperado por semana, das fotos + o dia corrente) e contribuição por pessoa (só para gestor ou em meta de empresa). Respeita `goals_can_see`.
- **Aplicar sugestão**: RPC `goals_apply_insight(_insight uuid)`; só gestor; executa a ação do `action` (ajustar alvo, redistribuir alvo entre pessoas, dividir meta, mudar etapa) numa transação e marca `aplicada`.

## 6. Rotina diária

- Novo passo no gancho agendado já existente (`/api/public/hooks/runtime-tick`, com segredo e trava global como o follow-up), executado uma vez por dia por empresa (marca do último dia processado).
- Para cada meta ativa:
  1. Calcula o valor do dia (mesma regra da RPC) e grava em `goal_snapshots`.
  2. Fecha períodos vencidos e abre o próximo das recorrentes.
- Depois, por empresa: monta o contexto (metas, últimas 4 semanas de fotos, contribuições) e pede à Lume a análise (seção 7). Grava em `goal_insights` com `generated_on = hoje` e descarta as sugestões pendentes de dias anteriores que ficaram obsoletas.
- Falha numa empresa não interrompe as outras; o erro vai para o registro de auditoria/saúde.

## 7. IA (Lume)

- **Motor**: o mesmo da Lume atual (`LUME_AI_*`), com resposta estruturada em JSON validado por esquema.
- **Saída da análise diária**:
  - `resumo`: até 2 frases.
  - `atencao[]`: por meta, o motivo ("orçamentos 30% abaixo do ritmo na 2ª semana").
  - `sugestoes[]`: ação estruturada de um conjunto fechado — `ajustar_alvo`, `redistribuir`, `dividir`, `mover_etapa`, `foco_semana` (esta última é só texto) — com justificativa curta.
  - `dicas[]`: por pessoa, só sobre as metas dela, citando o que dá para fazer hoje ("6 conversas paradas pedindo orçamento").
- **Pergunte à Lume**: `POST /api/goals/ask`, com a sessão do usuário; o contexto inclui só as metas que ele vê. Pode propor uma sugestão, que vira cartão com Aplicar/Dispensar (só gestor aplica).
- **Sem chave configurada**: o cartão da Lume explica o que falta; o resto da aba funciona.
- **Guarda-corpos**: números citados pela IA vêm do contexto enviado (não inventa); sugestão com ação inválida é descartada no servidor.

## 8. Telas

Linguagem visual do dashboard atual (`lume-dashboard`) com as referências enviadas: fundo preto, superfícies grafite, roxo `#7C3AED` / lilás `#A855F7` / `#B594FF`, brilho suave, fonte Inter.

### 8.1 Painel do gestor (desktop)
1. **Topo**: "Metas de {mês}" em letra grande e seletor Semana · Mês · Trimestre (filtra as visões pelo período).
2. **Faixa de números**: no ritmo, em risco, atrasadas e o "% geral" num anel roxo animado.
3. **Cartão da Lume**: orbe pequena + resumo, 2–3 pontos de atenção, 1–2 sugestões com Aplicar/Dispensar, campo "Pergunte à Lume".
4. **Destaques**: até 3 metas em cartões grandes — barra de ondas, realizado/alvo, prazo, selo, avatares dos participantes.
5. **Contribuição**: ranking por pessoa nas metas de empresa.
6. **Gestão**: botão **+ Nova meta** e as visões **Kanban** (colunas = etapas, arrastar e soltar), **Semanal** (linha por meta, coluna por semana, célula com realizado × esperado colorida pelo selo) e **Lista** (tabela com busca e filtros por selo, pessoa e indicador). Gerenciar etapas fica num botão do kanban.

### 8.2 Painel do usuário
- "Suas metas": cartões grandes das metas dele e das da empresa; dica pessoal da Lume; visão semanal só das metas dele; **Lançar progresso** nas manuais em que participa. Sem gestão nem sugestões.

### 8.3 Formulário (estilo `lq-black lq-panel` de Orçamentos/Agenda)
- Passo 1 **O quê**: nome, descrição, cor; medição automática (indicador + alvo) ou manual (alvo + unidade).
- Passo 2 **Quem e quando**: alcance e participantes; prazo único ou recorrência; etapa.
- Passo 3 **Revisão**: resumo com o ritmo semanal calculado.
- Edição usa o mesmo formulário; exclusão pede confirmação; arquivar é a opção padrão.

### 8.4 Barra de ondas roxas
- SVG com duas ondas sobrepostas (violeta → lilás) que deslizam em loop lento; preenchimento sobe do 0 ao valor ao entrar na tela.
- O brilho segue o selo: roxo (no ritmo), âmbar (em risco), vermelho (atrasada), verde (concluída).
- Só `transform`/`opacity` animam; com `prefers-reduced-motion` a onda fica parada e o preenchimento aparece direto.
- Acessível: `role="progressbar"` com `aria-valuenow`/`aria-valuemax` e texto "62% · R$ 62 mil de R$ 100 mil".

### 8.5 Celular (< 768 px)
- Faixa de números em carrossel (`MobileRail`); cartão da Lume compacto com a estrela no topo.
- Abas `MobileSections`: **Destaques · Kanban · Semana · Lista**.
- Kanban: uma coluna por vez, deslizando; mover por toque longo → "Mover para…".
- Semana: uma meta por vez, semanas em faixa horizontal.
- Formulário em folha de tela cheia, passo a passo.
- A aba entra no menu em grade (grupo **Vendas**); a barra inferior não muda.

## 9. Quando algo falta
- **Sem a migração**: a aba mostra "disponível após publicar a atualização" e não quebra nada.
- **Indicador sem dados**: 0 com "ainda sem registros neste período"; selo "Sem dados".
- **Pessoa removida da equipe**: a meta continua; o nome aparece como "ex-membro" e a contribuição antiga é mantida.
- **Falha da IA ou da rotina**: números continuam; o cartão da Lume mostra "análise de {data}" ou "indisponível".
- **Meta automática com indicador que deixou de existir**: vira somente leitura com aviso.

## 10. Testes
- **PGlite (SQL real)**:
  - matriz de visibilidade e edição (admin, gestor de metas, funcionário participante, funcionário de fora, outra empresa);
  - cada indicador por empresa, pessoa e grupo, com período e atribuição;
  - selo e semanas;
  - fechamento e abertura de recorrências;
  - `goals_apply_insight` (permitido e negado).
- **Unitários**: esperado até hoje, quebra semanal, selo, validação do formulário, validação da saída da IA.
- **Tela**: formulário (passos, validação, revisão), kanban (mover), visão do usuário sem gestão, barra com reduced-motion.
- **Visual**: prints em 320, 390 e 1440 px.
- **Regressão**: suítes de permissões, dashboard, Lume e agenda.

## 11. Fora do escopo
- Bônus/comissão atrelados a metas.
- Notificações por e-mail ou push (os alertas aparecem na aba).
- Metas por produto ou por canal.
- Exportar relatório de metas.

## 12. Ordem de entrega
1. Migração e testes SQL (tabelas, RLS, RPCs de progresso e aplicação).
2. Permissões, rota `/metas`, formulário, kanban, semanal e lista.
3. Painel (números, destaques, contribuição, barra de ondas) e visão do usuário.
4. Rotina diária (fotos, selos, recorrência).
5. Lume (análise diária, sugestões aplicáveis, perguntas, dicas).
6. Celular, testes visuais e documentação de ativação.
