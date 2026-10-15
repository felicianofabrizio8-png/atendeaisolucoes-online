# Agenda com hierarquia, tags da empresa e equipe por link — especificação

Data: 15/10/2026 · Branch: `isaque3` · Depende de: `20261007180000_team_permissions_and_assignment.sql` e `20261015120000_agenda_lume_foundation.sql`

## 1. Objetivo

Transformar a Agenda de "agenda de instalação" em agenda de equipe para qualquer empresa (multiempresa):

- Cada pessoa tem a **sua agenda**: compromissos com clientes, lembretes e tarefas pessoais.
- Só quem tem permissão cria **compromissos da equipe** e vê a agenda de todos.
- A empresa monta as **suas tags**. Nada vem pronto.
- A equipe nasce como no Notion: quem se cadastra cria a equipe e vira administrador. Depois convida por **link compartilhável**.
- Tudo é controlado em **Configurações → Usuários e Permissões**.

Sucesso: um funcionário comum não consegue criar compromisso de equipe nem ver a agenda privada de colegas, nem pela tela, nem pela Lume, nem chamando a API direto. O administrador gerencia membros, permissões e links em uma tela só.

## 2. Decisões (confirmadas)

| Tema | Decisão |
| --- | --- |
| Link de convite | O admin escolhe por link: **entra direto** ou **aguarda aprovação**. |
| O que o funcionário vê | A agenda dele, os compromissos de equipe em que é participante e os marcados para **toda a equipe**. |
| Tags | **Tags da empresa** (admin e gestor) e **tags pessoais** (cada pessoa, visíveis só para ela). |
| Compromissos já existentes | Viram compromisso de equipe para toda a equipe: todos continuam vendo como hoje. |
| Tipos fixos (Visita, Instalação…) e técnico/vendedor | Saem da tela. No lugar entram tags, dono e participantes. As colunas antigas ficam no banco, sem uso, para não quebrar follow-up, recuperação e relatórios. |

## 3. Regras de negócio

### 3.1 Papéis e permissões

| Permissão | Rótulo na tela | Padrão |
| --- | --- | --- |
| `agenda.manage` | Usar a agenda (pessoal) | Funcionário |
| `agenda.team` *(nova)* | Gerenciar agenda da equipe | Só quem o admin der |
| Administrador | Tudo | Quem criou a equipe |

Atalhos de perfil na tela (só preenchem as permissões, que continuam editáveis uma a uma):
- **Funcionário**: atendimento, orçamentos, agenda pessoal, catálogo.
- **Gestor da agenda**: Funcionário mais `agenda.team`.
- **Administrador**: papel `admin`.

### 3.2 Compromisso

Campos novos em `visits`:

- `owner_id`: dono. Se vier vazio, o banco preenche com quem cria.
- `scope`: `pessoal` ou `equipe`.
- `everyone`: só para `equipe`; vale para toda a equipe.
- Participantes: tabela `agenda_event_participants`, que já existe, com `user_id`.

| Ação | Funcionário | Gestor da agenda / Admin |
| --- | --- | --- |
| Criar pessoal (com ou sem cliente) | Sim, dono = ele | Sim, para si ou para outra pessoa |
| Criar de equipe | **Não** | Sim |
| Ver | Os dele; os de equipe em que participa; os de toda a equipe | Todos da empresa |
| Editar / excluir | Só os pessoais dele | Todos |
| Checklist e registro de campo | Nos que vê (participante registra chegada) | Todos |

### 3.3 Tags

- **Da empresa** (`owner_id` vazio): criadas, editadas e excluídas por admin e gestor; todos usam.
- **Pessoais** (`owner_id` = pessoa): só a dona vê, usa e edita.
- Cada uma tem nome e cor (matiz) e o nome não se repete. Um compromisso pode ter várias.
- Nenhuma tag é criada automaticamente.

### 3.4 Equipe e convites

- **Criar a equipe**: cadastrar-se sem convite cria a empresa e o papel admin (já existe). Novo: tela de boas-vindas "Crie sua equipe" para dar nome à equipe quando ela ainda se chama "Minha Empresa".
- **Convite por link** *(novo)*: o admin define papel, permissões padrão, se exige aprovação, validade (1, 7, 30 dias ou sem prazo) e limite de usos (opcional). Pode copiar e revogar. A tela mostra quantas pessoas entraram.
- **Entrar pelo link**: `/convite?link=TOKEN` mostra o nome da equipe e pede cadastro ou login.
  - Conta nova: entra na equipe.
  - Conta que já pertence a outra empresa: recusada com mensagem clara. O modelo atual é uma empresa por conta; várias equipes por conta ficam fora deste escopo.
- **Aprovação**: se o link exige, a pessoa entra como **pendente** (sem acesso) e aparece em "Aguardando aprovação" para o admin aprovar ou recusar.
- O convite por e-mail continua existindo.

## 4. Modelo de dados

Migração nova `20261016120000_agenda_team_hierarchy.sql`, aditiva e reexecutável, com teste em PGlite.

```
visits
  + owner_id uuid            -- preenchido por gatilho com auth.uid()
  + scope text default 'pessoal' check in ('pessoal','equipe')
  + everyone boolean default false
  backfill: linhas existentes → scope 'equipe', everyone true, owner_id = created_by

agenda_tags (id, company_id, owner_id null|uuid, name, hue, created_by, created_at)
  unique (company_id, coalesce(owner_id, zero-uuid), lower(name))
agenda_event_tags (company_id, event_id → visits, tag_id → agenda_tags, PK(event_id, tag_id))

company_invite_links (id, company_id, token unique, role app_role, permissions text[],
  requires_approval bool, expires_at null, max_uses null, uses int, created_by,
  revoked_at, created_at)
company_member_access
  + approval_pending boolean default false
  + joined_via_link uuid null
```

`agenda_event_types` deixa de aparecer na tela. A tabela continua no banco, sem uso, e pode ser removida numa limpeza futura.

## 5. Segurança no banco

Funções `SECURITY DEFINER`, com fallback quando o módulo de equipe não está instalado (mesmo padrão de `agenda_can_access`):

- `agenda_is_manager(company)`: admin ou `agenda.team`.
- `agenda_can_see_event(id)`: gestor; ou dono; ou `scope = 'equipe'` com `everyone` ou participante.
- `agenda_can_edit_event(id)`: gestor; ou dono de compromisso pessoal.

Regras aplicadas:

- **`visits`**: políticas restritivas novas para leitura, edição e exclusão com as funções acima. A criação exige `scope = 'pessoal'` e `owner_id = auth.uid()`, ou gestor.
  - Gatilho impede um funcionário de trocar `scope`, `owner_id` ou `everyone` de um compromisso.
  - Follow-up, recuperação e relatórios usam a chave de serviço: não são afetados.
  - O agendamento pelo Atendimento grava como pessoal de quem agenda: continua funcionando.
- **Tabelas filhas** (participantes, checklist, registro de campo, lembretes, tags do compromisso):
  - leitura exige ver o compromisso;
  - participantes e tags exigem poder editar;
  - checklist e registro de campo exigem ver (o participante executa).
- **`agenda_tags`**: leitura das tags da empresa e das próprias pessoais. Criar tag da empresa exige gestor; criar tag pessoal exige ser a dona.
- **Convite por link**: tudo via RPC.
  - `team_create_invite_link` e `team_revoke_invite_link`: só admin.
  - `team_invite_link_info`: retorna só o nome da equipe e se o link vale.
  - `team_join_via_link`: conta logada sem empresa própria em uso.
  - `team_approve_member` e `team_reject_member`: só admin.
  - O cadastro (`handle_new_user`) aceita `invite_link` nos metadados e confere validade, revogação, prazo e limite de usos, com trava de linha (`FOR UPDATE`) para não ultrapassar o limite.
- O token do link tem 32 bytes aleatórios. Só um token completo dá acesso; nada é listado para quem não é admin.

## 6. Telas

### 6.1 Agenda
- **Visão**: o seletor "Minha agenda · Equipe · Pessoa ▾" aparece só para gestor. O funcionário vê "Minha agenda".
- **Formulário**, no mesmo visual do orçamento:
  - "Quando": tags (chips multisseleção, "+ Nova tag" inline, com escolha empresa ou pessoal se for gestor), título, data e horário.
  - "Pessoas": **Alcance** (Pessoal ou Equipe, só gestor), **Dono** (gestor pode escolher), **Participantes** (membros da equipe), **Toda a equipe** e cliente (como hoje).
  - "Detalhes": local, notas e resumo.
- **Personalizar**: aba **Tags**, com as tags da empresa (gestor) e as minhas tags. Sai a aba de tipos.
- **Visão Equipe**: só gestor, organizada por dono e participantes.
- **Painel do compromisso**: mostra dono, alcance, participantes e tags. Ações de editar e excluir só para quem pode.

### 6.2 Configurações → Usuários e Permissões
1. **Membros**: nome, e-mail, papel, status (ativo, pendente, desativado) e última atividade. Clicar abre a gaveta de permissões com atalhos de perfil e as permissões agrupadas por módulo (Atendimento, Agenda, Orçamentos, Catálogo, Relatórios, Marketing, IA, Configurações), cada uma com uma frase do que libera.
2. **Aguardando aprovação**: aprovar ou recusar.
3. **Links de convite**: criar (papel, perfil, aprovação, validade, limite), copiar, revogar, usos.
4. **Convites por e-mail**: o fluxo atual.

### 6.3 Boas-vindas
Na primeira entrada do admin de uma equipe ainda chamada "Minha Empresa", aparece um diálogo "Crie sua equipe" (nome) com o atalho "Convidar pessoas" para gerar o primeiro link.

## 7. IA Lume
- Ferramentas de agenda passam a aceitar `alcance`, `participantes` (por nome de membro) e `tags`.
- O banco recusa compromisso de equipe pedido por funcionário. A Lume explica que precisa de permissão.
- `agenda_listar` devolve só o que a pessoa vê, porque usa a sessão dela.

## 8. Compatibilidade
- Compromissos antigos continuam visíveis para todos (equipe e toda a equipe).
- As colunas antigas (`appointment_type`, `technician`, `salesperson`) continuam no banco.
  - Na tela, os valores antigos aparecem só no detalhe, como "Técnico (registro antigo)".
  - O envio ao técnico continua disponível só quando há telefone de técnico registrado.
- Sem a migração aplicada, a tela funciona como hoje e mostra "disponível após publicar" na hierarquia, tags e links.

## 9. Testes
- **PGlite (SQL real)**: matriz de visibilidade e edição com admin, gestor, funcionário A, funcionário B e outra empresa; tags da empresa × pessoais; link (válido, revogado, expirado, limite, aprovação, conta de outra empresa); gatilhos de troca de alcance e dono.
- **Unitários**: regras do formulário, atalhos de perfil, filtros por tag e dono.
- **Tela**: Usuários e Permissões (permissões, links, aprovação) e formulário (alcance oculto para funcionário).
- **Regressão**: suítes da vendedora, do atendimento, do follow-up e da Lume.

## 10. Fora do escopo
- Uma conta em várias equipes (workspaces múltiplos).
- E-mail automático de convite (o link é copiado e compartilhado).
- Remover `agenda_event_types` e as colunas antigas do banco.

## 11. Ordem de entrega
1. Migração e testes SQL (hierarquia, tags, links).
2. Permissões e tela Usuários e Permissões (membros, links, aprovação, boas-vindas).
3. Agenda: escopo, formulário, tags, visão por pessoa e painel.
4. Lume: novos parâmetros.
5. Documentação de ativação e PR.
