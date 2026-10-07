# Equipe e permissões — isaque3

## Funcionamento

- Cada pessoa usa sua própria conta Supabase Auth. O convite associa o novo perfil à empresa do administrador, sem criar outra empresa.
- `profiles`, `user_roles`, `company_invites` e `leads.assigned_to` são reaproveitados. `company_member_access` acrescenta o estado ativo e as permissões explícitas por pessoa/empresa.
- Administradores existentes são preservados. A migração também promove a conta **fabriziosoul@gmail.com**, se ela existir em `auth.users` e tiver perfil. Nenhuma conta é criada ou senha alterada.
- Em Configurações → Usuários e Permissões, o administrador cria/cancela convites, copia o link, altera permissões e desativa acessos. Não há envio automático de e-mail de convite. A confirmação de e-mail continua seguindo a configuração do Supabase Auth.
- Atendentes começam com fila, resposta, orçamentos, agenda e consulta ao catálogo. Dashboard, relatórios, edição do catálogo, visualização de toda a equipe e transferência podem ser concedidos separadamente. IA, campanhas, integrações e gestão da equipe permanecem administrativas, respeitando os controles anteriores desses módulos.
- O perfil `financeiro` existente é preservado; os acessos não administrativos são definidos pelas mesmas permissões explícitas.
- A fila mostra conversas disponíveis e as do próprio usuário. A permissão de visualizar toda a equipe permite supervisionar outras conversas, mas não responder nelas.
- Assumir, liberar e transferir são operações transacionais. Só o responsável responde, inclusive quando quem tenta enviar é administrador. Para responder pelo colega, primeiro é necessário transferir o atendimento.
- A responsabilidade é por **lead**, reaproveitando o modelo existente: conversas ligadas ao mesmo lead compartilham o responsável.
- Ao desativar um usuário ou retirar a permissão de responder, seus atendimentos são liberados. O último administrador ativo não pode ser removido; ninguém pode desativar a própria conta.

## Onde a autorização é aplicada

1. Navegação e componentes restringem páginas, ações e edição de produtos.
2. Middleware global protege APIs privadas; server functions também validam permissões. Webhooks públicos preservam a autenticação própria já existente.
3. APIs de envio e sugestões verificam o destino com o JWT do usuário. As Edge Functions `meta-send` e `meta-connect` também verificam permissões antes de utilizar service role.
4. RLS restritiva e triggers protegem acesso direto ao banco, vínculos entre empresas e alterações de responsável. RPCs administrativas verificam empresa, papel e acesso ativo.
5. Novos uploads do composer incluem o ID da conversa no caminho. A policy de Storage permite esse upload apenas ao responsável e impede que quem só consulta o catálogo sobrescreva imagens de produtos.

Permissões são reconsultadas a cada 15 segundos e ao receber eventos. O responsável da conversa aberta é verificado a cada 5 segundos. O cache da fila é revalidado a cada 15 segundos e ao retornar à janela, pois o Realtime não entrega uma linha que deixou de ser visível pela RLS. O servidor sempre valida a requisição, mesmo antes de a interface se atualizar.

## Ativação

O código local não aplica automaticamente mudanças no Supabase remoto. A sessão de desenvolvimento tinha apenas a chave pública, sem acesso administrativo ao banco.

1. Em homologação com o histórico de migrations atualizado, aplicar `supabase/migrations/20261007180000_team_permissions_and_assignment.sql`.
2. Publicar `meta-send` e `meta-connect` junto com a aplicação desta branch. Não liberar atendentes enquanto ainda houver versões antigas das funções de envio em execução.
3. Conferir a conta administradora e realizar o roteiro abaixo. Fazer a mesma publicação coordenada no ambiente de produção após homologação.
4. Incluir a URL `/convite` do ambiente nos redirects permitidos do Supabase Auth e manter confirmação de e-mail habilitada.

Antes da migração, somente um administrador já confirmado pelas funções antigas mantém acesso à interface. A tela de equipe informa que a ativação está pendente. Erros de rede ou de autorização não ativam esse fallback.

Os testes PostgreSQL usam PGlite, a migração inicial do repositório e fixtures das tabelas necessárias. Isso testa SQL/RLS/triggers reais, mas não substitui executar todas as migrations em um Supabase de homologação, validar Storage real e as chamadas Meta. Nenhuma mensagem real foi enviada durante os testes.

## Conferência após ativar

1. Entrar como administrador, criar convite para novo e-mail e aceitar usando uma janela separada.
2. Verificar que o atendente vê Atendimento, Agenda, Orçamentos e Produtos, sem Dashboard ou IA por padrão.
3. Dois atendentes tentam assumir a mesma conversa: apenas um deve conseguir. Conferir o nome no selo e o bloqueio do composer do outro.
4. Transferir o atendimento; confirmar que o antigo responsável perde envio e visualização quando não tem acesso à equipe toda.
5. Desativar um atendente logado; conferir revogação no banco/API e atualização da tela.
6. Conceder/remover edição de produtos e verificar operações reais e uploads.
7. Testar textos, imagens, áudios e orçamento no canal conectado com um contato de teste autorizado.

Convites expirados, cancelados, usados ou de outro e-mail são rejeitados. Contas já associadas a outra empresa não são movidas automaticamente: é necessário usar outro e-mail. A implementação mantém uma empresa por perfil, conforme o modelo atual.

Arquivos/links públicos e URLs de mídia assinadas anteriormente continuam sujeitos à política de validade já existente; esta atualização não transforma o armazenamento público legado em privado.

## Testes locais

```sh
npx vitest run src/lib/__tests__/team-database.test.ts src/lib/__tests__/team-permissions.test.ts src/lib/__tests__/team-api-access.test.ts src/data/__tests__/lead-realtime-reconciliation.test.ts src/lib/__tests__/atendimento-visual.test.ts src/lib/__tests__/manual-send.test.ts src/components/orcamentos/__tests__/quote-wizard.test.ts src/components/orcamentos/__tests__/quotes-redesign.test.ts
npx tsc --noEmit
npm run build
```
