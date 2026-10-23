# Auditoria do adaptador isolado de texto da Bruna

Esta mudança cobre somente `src/lib/bruna-whatsapp-text-adapter.server.ts` e
sua suíte. O adaptador continua isolado: não é importado pelo runtime nem por
rotas, senders ou produção. Nenhuma migration, banco, rota ou integração foi
alterada.

## Idempotência e lock

- `actionId` é obrigatório e fornecido pelo chamador; não é gerado pelo
  adaptador.
- A chave de dedupe é `companyId`, `conversationId` e `actionId`. O texto não
  participa da identidade: ações diferentes podem enviar textos idênticos,
  enquanto retry da mesma ação é bloqueado.
- `actionId` é gravado em `messages.source_metadata.action_id`.
- A claim ocorre antes da Graph e não é desfeita em falha Graph ou persistência.
  Isso evita reenvio quando o resultado externo é desconhecido.
- O lock atual é de 300 segundos e continua escopado à empresa e conversa
  (`bruna-whatsapp-text:{companyId}:{conversationId}`). Ele serializa ações na
  mesma conversa, mas não é a identidade da ação. Em execução normal é
  liberado no `finally`; morte do processo pode bloquear a conversa por até
  300 segundos.
- O owner do lock é um `randomUUID()` novo e exclusivo por execução. O
  `actionId` estável permanece exclusivamente na dedupe e na auditoria. Isso
  impede que um `finally` atrasado libere o lock adquirido por outra execução.

## Risco de expiração durante Graph

O TTL atual é de 300 segundos e não é renovado durante a chamada Graph. Se a
autorização, a rede ou a Graph ultrapassar esse prazo, o lock pode expirar e
uma segunda execução pode adquiri-lo enquanto a primeira ainda estiver em voo.
O `ownerId` por execução evita que a primeira execução libere o lock da segunda,
mas não elimina a janela de concorrência após a expiração. Heartbeat/renovação
fica explicitamente fora deste escopo; não houve alteração de RPC.

## RPC e bloqueios de ativação

As RPCs `runtime_try_acquire_lock`, `runtime_release_lock` e
`runtime_try_dedupe` são `SECURITY DEFINER` e têm execução concedida somente a
`service_role`. O adaptador usa `supabaseAdmin`; se a RPC falhar, o wrapper
falha fechado (`false`) e bloqueia o envio. Assim, a ativação fica bloqueada
se a função/RPC estiver indisponível, se o banco rejeitar a chamada ou se o
lock de 300 segundos ainda estiver ativo. Não há fallback local seguro para
substituir a atomicidade distribuída.

Também permanecem bloqueios independentes: autorização automática, takeover
humano, integração WhatsApp inativa/sem credenciais e `source` diferente de
`automatic`. O adaptador não foi conectado ao runtime nesta mudança; a
ativação permanece bloqueada até haver decisão explícita sobre a expiração
durante Graph e eventual renovação. Não se deve contornar esses bloqueios com
cache local, bypass da RPC, reutilização do owner entre execuções ou remoção da
claim.
