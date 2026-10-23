# Homologação isolada do Consultative Shadow

Este procedimento prepara um ambiente de teste dedicado sem usar credenciais atuais, sem criar recursos pagos e sem executar operações externas automaticamente.

## Dependências mínimas

Para o motor em execução real:

- Cloudflare Worker do aplicativo, em projeto de teste separado;
- Supabase de teste separado;
- `company_settings` com a flag `consultative_shadow_enabled` e, quando aplicável, o perfil de capacidades;
- `ai_flow_events` com o evento `ai_flow_step` permitido;
- dados sintéticos de empresa, conversa, lead e catálogo para exercitar o carregamento do contexto;
- nenhuma integração Meta/WhatsApp ativa;
- nenhuma credencial Meta, WhatsApp ou outbound no ambiente.

Para o script de persistência sintética, o mínimo é `ai_flow_events` e duas empresas sintéticas. O script não cria empresas, schema, conversas ou leads.

## Configuração manual necessária

1. Criar um projeto Supabase gratuito/de teste separado da produção. Não reutilizar a URL, project ref ou chaves do `.env` atual.
2. Aplicar, somente nesse projeto, as migrations já existentes do repositório.
3. Confirmar manualmente que `public.ai_flow_events` existe, aceita `ai_flow_step`, possui RLS e índice por `company_id`.
4. Preparar duas empresas fictícias com UUIDs distintos.
5. Criar dados sintéticos para conversas, leads, mensagens e produtos, todos ligados às respectivas empresas.
6. Adicionar a flag de teste em `company_settings` conforme o schema do ambiente. O repositório atual não contém migration para `consultative_shadow_enabled`; isso precisa ser resolvido manualmente no projeto de teste antes de exercitar a flag real. Exemplo de alteração, para revisão do responsável pelo banco:

```sql
alter table public.company_settings
  add column if not exists consultative_shadow_enabled boolean;
```

Não executar este SQL automaticamente pelo script.

7. Manter a flag `false` para ambas as empresas durante a preparação.
8. Configurar outbound bloqueado: sem integrações ativas, sem secrets Meta/WhatsApp, sem tokens de envio e com egress bloqueado para endpoints Meta.
9. Criar uma service-role exclusiva do projeto de teste. Ela deve ser usada apenas localmente durante a homologação e nunca armazenada no repositório.

## Variáveis do script

O script [consultative-shadow-homologation.mjs](../scripts/consultative-shadow-homologation.mjs) não lê `.env` nem qualquer variável de produção.

Definir manualmente, em sessão temporária do terminal:

```powershell
$env:SHADOW_TEST_SUPABASE_URL="https://<TEST_PROJECT_REF>.supabase.co"
$env:SHADOW_TEST_SUPABASE_SERVICE_ROLE_KEY="<TEST_SERVICE_ROLE_ONLY>"
$env:SHADOW_TEST_PROJECT_REF="<TEST_PROJECT_REF>"
$env:SHADOW_TEST_COMPANY_A_ID="<UUID_COMPANY_A_SINTETICA>"
$env:SHADOW_TEST_COMPANY_B_ID="<UUID_COMPANY_B_SINTETICA>"
$env:SHADOW_HOMOLOGATION_ENV="isolated-test"
$env:SHADOW_HOMOLOGATION_NETWORK="1"
$env:SHADOW_HOMOLOGATION_OUTBOUND="blocked"
```

Não definir `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `META_ACCESS_TOKEN`, `WHATSAPP_ACCESS_TOKEN` ou equivalentes na mesma sessão. O script recusa execução se detectar mistura de credenciais.

## Execução segura

Dry-run local, sem rede e sem banco:

```powershell
node scripts/consultative-shadow-homologation.mjs
```

Somente depois da preparação manual e revisão do responsável:

```powershell
node scripts/consultative-shadow-homologation.mjs --execute --samples=100
```

O modo `--execute`:

- insere apenas eventos sintéticos `ai_flow_step`;
- grava um `pilot_run_id` não sensível;
- mede duração de cada insert;
- lê somente os eventos daquele `pilot_run_id`;
- verifica quantidade, empresa, chaves sensíveis e p95/p99;
- não altera flags;
- não chama Meta, WhatsApp, LLM ou qualquer outbound.

Falhas de insert ou leitura encerram o processo com código diferente de zero. O output JSON deve ser arquivado fora do repositório como evidência do run.

## Teste de falha e rollback

O teste de falha deve ser realizado somente no projeto Supabase de teste:

1. executar um run normal e guardar o `runId`;
2. interromper temporariamente o acesso da service-role de teste ou apontar para uma URL de teste inválida;
3. repetir com poucos samples e confirmar código diferente de zero;
4. restaurar a configuração de teste;
5. confirmar que nenhum evento parcial pertence a outro `pilot_run_id`.

Para rollback do shadow real:

1. confirmar que a flag da empresa piloto está `true` somente no ambiente de teste;
2. restaurar manualmente `consultative_shadow_enabled=false`;
3. processar uma conversa sintética;
4. confirmar ausência de novo evento `consultative_shadow` e ausência de qualquer envio;
5. manter o valor `false` até revisão dos resultados.

O script não executa rollback automaticamente e não atualiza `company_settings`.

## Critérios de aprovação

- 100% dos samples persistidos e recuperados;
- p95/p99 registrados para inserts reais;
- zero registros com empresa diferente das duas empresas sintéticas;
- zero payloads contendo texto, mensagem, telefone, preço ou conteúdo;
- zero outbound;
- falha controlada produz código não zero sem alterar produção;
- rollback interrompe novos eventos shadow;
- flag de produção permanece desligada.

