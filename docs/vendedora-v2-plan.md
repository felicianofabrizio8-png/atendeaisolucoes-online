# Vendedora 2.0 — plano incremental

## Contexto

Não foi encontrado `AGENTS.md` no repositório. Este plano usa como fontes de contexto o `README.md`, `FOLLOWUP_ARCHITECTURE.md`, o pipeline existente em `src/lib/ai-agent.server.ts` e os módulos `sales-agent-*`.

O sistema já possui uma base importante: Luna/gateway LLM no agente atual, busca determinística e validada do catálogo, persistência em `conversation_sales_states`, isolamento por `company_id`, trilha de eventos, camada de segurança e aprendizado que só é promovido após aprovação administrativa.

## Arquitetura alvo

```text
mensagem recebida
  -> lock e tenant guard
  -> estado persistente + resumo + últimas mensagens
  -> interpretação Luna (linguagem natural, inclusive respostas curtas)
  -> ferramentas determinísticas validadas
       catálogo / preço / ação
  -> decisão estruturada
  -> validação anti-invenção e anti-produto incorreto
  -> resposta ou ação conforme modo
  -> persistência do estado e auditoria
```

Regras invariantes:

- toda leitura, escrita e ferramenta recebe `company_id` e rejeita escopo ausente;
- fatos de produto, preço e disponibilidade vêm somente de ferramentas validadas;
- o estado preserva produto apresentado/selecionado, intenção, atributos e última busca;
- o prompt envia somente estado compacto, resumo, últimas mensagens e produtos relevantes;
- aprendizado operacional só entra no grounding depois de correção aprovada;
- ações de envio, orçamento, visita ou alteração de lead continuam atrás de guardas e auditoria.

## Fases

### Fase 0 — fundação e contrato

Inventariar o fluxo atual, documentar invariantes, adicionar testes de contrato e definir o modo efetivo:

- `silent`: interpreta, busca e registra decisão; não envia nem executa ação;
- `assisted`: gera sugestão e registra contexto para aprovação humana;
- `automatic`: pode responder/executar apenas ações explicitamente permitidas pelos guards atuais.

Compatibilidade: `ai_auto_reply_enabled=false` permanece sem envio; `ai_pilot_mode=true` permanece simulado. A nova flag é opt-in e não altera endpoints legados por padrão.

### Fase 1 — contexto compacto e continuidade

Usar o estado persistente existente como fonte canônica, limitar histórico por janela e tamanho, gerar resumo determinístico seguro e selecionar apenas produtos relevantes após a busca. Cobrir respostas curtas como “sim”, “esse”, “e o outro?” sem perder o produto em foco.

### Fase 2 — ferramentas validadas

Formalizar contratos para catálogo, preço e ações. Cada ferramenta deve validar tenant, existência, produto ativo e valores antes de retornar dados. A redação recebe apenas o resultado da ferramenta, nunca inventa fallback factual.

### Fase 3 — execução por modo

Integrar o modo à decisão do agente: silent, assisted e automatic. Adicionar idempotência, observabilidade e auditoria para cada ação. Handoff humano continua dominante.

### Fase 4 — aprendizado aprovado

Reutilizar `ai_training_messages`, `coach_learnings` e `coach_rules`; somente registros aprovados entram no prompt. Testar conflito por `company_id`/`conflict_key` e impedir vazamento entre empresas.

### Fase 5 — LangGraph.js (decisão de compatibilidade)

Avaliar LangGraph.js apenas se o grafo trouxer checkpointing, retries ou observabilidade que o pipeline atual não entregue com menor complexidade. Se adotado, encapsular o grafo atrás do contrato atual de `runAgentTurn`; se não, manter o pipeline explícito atual.

## Testes de aceitação

- produto mencionado na mensagem anterior continua correto após “sim”, “esse” e “pode”;
- troca explícita de produto vence a memória anterior;
- preço sem registro validado gera pergunta/handoff, nunca valor inventado;
- produto de `company_id=A` nunca aparece para `company_id=B`;
- catálogo vazio, erro de busca e estado inválido são caminhos seguros;
- silent não envia; assisted não envia sem aprovação; automatic respeita handoff, janela e rate limit;
- correção não aprovada não muda o comportamento; correção aprovada é aplicada apenas ao tenant correto;
- prompt/contexto contém somente resumo, últimas mensagens, estado e produtos relevantes;
- execução concorrente não duplica envio ou ação.

## Progresso

- [x] Inventário inicial e confirmação das capacidades já existentes.
- [x] Plano arquitetural e fases criado.
- [x] Fase 0: contrato de modos/flags e testes.
  - implementação e integração concluídas.
  - Testes específicos e do `ai-agent`: aprovados (4 arquivos, 65 testes).
  - Build: aprovado.
  - TypeScript: nenhum erro relacionado à implementação; erros globais em `src/router.tsx` e rotas de campanhas são preexistentes.
  - ESLint dos arquivos alterados: arquivos novos sem erros; falhas restantes são CRLF/formatação e um `no-useless-escape` preexistentes.
- [x] Fase 1: contexto compacto e continuidade.
  - Interpretacao estruturada de intencao, assunto, referencia de produto, confirmacao e confianca integrada ao pipeline atual.
  - Estado persistente continua canonico, com company_id, catalogo validado e IDs de produtos relevantes.
  - Contexto compacto, resumo seguro e janela de 8 mensagens sao usados somente com a flag V2; o caminho legado preserva prompt e janela de 20 mensagens.
  - Testes relacionados: 4 arquivos, 145 testes aprovados, incluindo conversas naturais e respostas curtas.
  - TypeScript: nenhum erro nos arquivos da Fase 1; erros globais preexistentes em router.tsx e rotas de campanhas.
  - Build: aprovado. ESLint restrito: falhas de CRLF/prettier preexistentes nos arquivos existentes; arquivos novos validados.
- [x] Fase 2: ferramentas validadas de catálogo, preço e ações.
  - Contratos tipados e discriminados para preço, itens inclusos, fotos, medidas e ações comerciais existentes (texto, imagens e handoff).
  - Entradas validam company_id, escopo do tenant, produto ativo, IDs, texto e valores; saídas distinguem sucesso, produto inexistente, produto inativo, ambiguidade, preço/dado ausente, acesso negado, valor inválido e erro de consulta.
  - Fatos são derivados exclusivamente do catálogo validado; a Luna recebe resultados das ferramentas e não fornece fatos diretamente.
  - Ações V2 são preparadas sem efeitos colaterais em teste, exigem modo permitido e preservam o caminho legado quando a flag está desativada.
  - Testes: sucesso, falhas, produto inativo, cross-tenant, dados ausentes, catálogo inválido e ações sem envio real; bateria relacionada aprovada (8 arquivos, 179 testes).
  - TypeScript: nenhum erro nos arquivos da Fase 2; erros globais preexistentes em src/router.tsx e rotas de campanhas.
  - Build: aprovado. ESLint dos contratos novos: aprovado; falhas nos arquivos existentes são CRLF/prettier preexistentes.
- [ ] Fase 3: execução e auditoria por modo.
- [ ] Fase 4: auditoria de aprendizado aprovado.
- [ ] Fase 5: decisão sobre LangGraph.js.

Cada fase deve terminar com testes executados e commit separado.
