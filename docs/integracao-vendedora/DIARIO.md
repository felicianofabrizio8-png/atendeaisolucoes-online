# Integração da vendedora (Bruna + vendedora da main): diário

Worktree: `C:\Users\AMD\atendeai-vendedora-unificada`, branch local `integracao/vendedora-unificada`,
base `origin/main` em `ac9bc4dc` (2026-10-16, a mais recente após `git fetch` em 2026-10-23).
Nada foi enviado ao remoto, publicado ou executado em banco remoto.

## Etapa 0: preservação

- Worktree original `C:\Users\AMD\atendeai-bruna-unificada` intacto (153 itens pendentes antes e depois).
- Branch local `backup/bruna-unificada-20261023` (`c919d371`): commit A (`7dc7c712`) = índice exato
  (alterações em stage do Codex); commit B = worktree completo, incluindo arquivos não rastreados.
  Conferido: a árvore do índice e a do worktree recalculadas batem com A e B.
- Fora do repositório, em `C:\Users\AMD\atendeai-backups\20261023-integracao-vendedora\`:
  `bruna-unificada.bundle`, `origin-main.bundle` (ambos `git bundle verify` OK), três patches
  (stage do Codex, alterações sem stage e novos, Bruna completa) e `SHA256SUMS.txt`.
- Varredura de credenciais nos arquivos pendentes e nos patches: nenhuma chave encontrada.
- O checkout principal `atendeaisolucoes-online` tinha 1 item pendente; não foi tocado.

## Etapa 1: base e linha de base

- Dependências: `package-lock.json` e `bun.lockb` da main estão fora de sincronia com o
  `package.json` (`npm ci` e `bun install --frozen-lockfile` recusam). Instalado com
  `npm install --legacy-peer-deps` e o lockfile restaurado; `@testing-library/dom` instalado com
  `--no-save` (dependência par exigida por `@testing-library/react` 16). **Pendência**: sincronizar
  os lockfiles numa mudança própria.
- `worker/render-engine` tem dependências próprias; instaladas localmente.
- Linha de base da main: TypeScript 0 erros; build (Nitro) OK; 3.339 testes, 1 falha intermitente
  sob carga (`quote-wizard`, passa isolado).

## Escopo da integração

O delta real da Bruna é o commit `d1aa895a` mais as alterações não commitadas: os três commits
anteriores da branch já existem na main (`b1bcdf20`, `a1f1f4ec`, `1c106151`). Base de merge por
arquivo: `fb347bc0`.

Fora do escopo (permanece a versão da main), por ser a frente "saída do Lovable" (troca do
provedor de IA de marketing, coach, narrativa, recuperação, mídia) e ajustes de ambiente:
`LovableChatProvider`, `ai-gateway/ai-client`, `OpenAICompatibleChatProvider`, rotas
`api.ai.{suggest,suggest-product,propose-knowledge,campaign-*,creative-generator}`,
`api.recovery.assist`, `wa-media-ai`, `marketing-ai`, `executive-narrative`, `coach-interpreter`,
`teach-mode`, `recovery-ai`, `quote-send/edge-contract`, `previewAuthStorage`, `vite.config`,
`wrangler.jsonc`, `drizzle.config`, `package*.json`, README e scripts de storage do Lovable.
Testes alterados só por portabilidade Windows também ficam como na main (passam na main).

Arquivos criados nos dois lados: `product-library`, `shared-contacts.test` idênticos;
`shared-contacts`, `send-credentials` e o adaptador da vendedora externa: fica a versão da main
(mais completa ou mais rigorosa).

## Camada 1: fundações

Portados (merge de 3 vias): módulos puros da Bruna (escopos de resposta, escopo de execução,
política de permissão, lease, adaptador de envio, memória e shadow consultivos, controle de
takeover, autorização de envio), `RuntimeStateStore` (reservas de mensagem), `MetaOutbound`,
`whatsapp/status.server`, estado comercial, auditoria, modo do agente, tipos, as 10 migrations e
testes. Conflitos resolvidos: `sales-agent-mode` (as duas funções novas mantidas),
`types.ts` (colunas dos dois lados), `send-credentials` (main). Fixture de testes atualizada com
`timeZone`/`businessDays` dos follow-ups da main.

Testes da camada: 161/163. As 2 falhas (`bruna-status-contract`) leem o código da função
`meta-webhook`, que entra na camada 2. `consultative-sales-response.test` e
`consultative-shadow-settings.test` dependem de campos do motor (camada 3).

## Camada 2: caminhos de envio

Portados: rotas `api.whatsapp.*` (envio, resposta, mídia, localização, áudio, modelos) com o
comprovante de envio emitido no servidor, `wa-templates`, conciliação de status no `meta-webhook`
(RPC `record_whatsapp_send_status`, filtro por empresa, `failed` não rebaixa `delivered`/`read`),
escolha explícita de integração no `meta-send` quando a empresa tem mais de um número.

Decisões:
- Follow-ups: a main reescreveu tudo (V2 por ciclos, envio único em `dispatch.ts`); ficou a main.
  A revalidação da main já filtra por empresa e takeover. A autorização da Bruna foi levada ao
  `dispatch.ts`: disparo manual = origem "humano"; automático/reativação = "follow-up" (bloqueia
  em takeover). Sem comprovante, o envio é bloqueado e registrado (teste novo).
- Reativação: mantidas as checagens extras da Bruna (empresa/lead da conversa, takeover, IA em
  processamento, aguardando humano), com o `select` corrigido para trazer esses campos.
  Mudança de comportamento: não reativa conversa "aguardando humano".
- Campanhas de relacionamento (só existem na main): nova origem `campaign` no comprovante; valida
  o tenant sem depender da ativação da IA. Sem comprovante, o destinatário vai para `failed` com
  nova tentativa (mesmo caminho de falha de envio).
- Lead sem `integration_id` (leads antigos/manuais): a Bruna recusava. Para preservar a função da
  main sem enfraquecer a proteção, o comprovante usa a integração da empresa só quando ela é a
  única ativa; com duas ou mais, continua recusando por ambiguidade (testes atualizados). O envio
  de modelo passou a usar a integração resolvida pelo comprovante.
- `meta-send`: mantida a regra da main (token do ambiente só para o mesmo número) e autorização de
  equipe; da Bruna, a escolha explícita de integração. CORS: origens do Lovable mantidas (a Bruna
  as removia; produção ainda roda no Lovable) e a lista configurável `CORS_ALLOWED_ORIGINS` somada.

Testes: camada 2 136/136; follow-ups e campanhas 183/183. Testes da main ajustados para o
comprovante (simulado onde o foco é o fluxo, real no teste de envio de modelo).
