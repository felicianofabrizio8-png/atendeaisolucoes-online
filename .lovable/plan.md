## Recuperação de Leads — Templates Meta fora da janela 24h

Nova camada de recuperação no Inbox, sem alterar fluxos existentes. Tudo lê dados já existentes (`conversations`, `messages`, `whatsapp_templates`, `leads`).

### 1. Nova rota `/inbox/recovery` (Recuperação 24h)
Acessível por um botão "Recuperação 24h" no header da Caixa de Atendimento. Layout próprio, não interfere no Inbox atual.

**Indicadores (cards no topo):**
- Clientes fora da janela 24h (conversas WhatsApp com `last_inbound_at < now() - 24h` e sem resposta)
- Templates enviados hoje (`messages` onde `source_subtype='wa_template_manual'` + data = hoje)
- Taxa de resposta (templates enviados que receberam resposta do lead em até 24h)
- Leads reativados (conversas que voltaram a receber mensagem do lead após template)
- Vendas recuperadas (leads reativados com status `won`)

**Lista de conversas fechadas:**
Cards com: Nome, telefone, última interação (texto resumido), tempo desde última mensagem ("há 2d 4h"), produto de interesse (do lead), status do lead, badge "Fora da janela 24h".

**Ações por card:**
- Enviar Template (abre `MetaTemplatesModal` já existente, pré-selecionando o recomendado)
- Abrir conversa (link para `/inbox/$id`)
- Ver histórico (drawer com últimas 10 mensagens)
- Alterar template (toggle no modal já cobre)

**Filtros:**
- Filtro principal "Fora da Janela 24h" (sempre ativo na rota)
- Pesquisa por nome/telefone
- Filtro por produto/status (reusa padrão do OpportunityHub)

### 2. Recomendação automática de template
Função pura `recommendTemplate(conversation, lead)` que mapeia contexto → nome de template Meta:
- Lead status `qualified`/`new` + sem orçamento → `cliente_pesquisando`
- Orçamento enviado (quote existe, sem fechamento) → `followup_orcamento`
- Última mensagem do lead > 7 dias → `reativacao_cliente`
- Visita agendada (`visits` próxima) → `confirmacao_visita`
- Fallback → primeiro template APPROVED de categoria UTILITY

Sugestão exibida no card como chip "Sugerido: nome_do_template". Modal já permite trocar.

### 3. Reuso de infraestrutura existente
- `whatsapp_templates`: única fonte (sem tabela paralela). Mostra status APPROVED/PENDING/REJECTED, filtra APPROVED por padrão.
- `MetaTemplatesModal` + `api.whatsapp.templates.send`: já implementados, apenas estendidos para aceitar `suggestedTemplate` opcional.
- `WhatsappWindowAlert`: já alerta quando fora da janela; sem mudanças.

### 4. Segurança (já garantida)
- Endpoint `api.whatsapp.templates.send` só envia templates APPROVED via Meta Graph API.
- Nenhuma mensagem livre é permitida fora da janela; o botão "Enviar" do composer já é bloqueado pelo `WhatsappWindowAlert`.

### Arquivos
**Novos:**
- `src/routes/inbox.recovery.tsx` — rota com indicadores + lista
- `src/lib/recovery.functions.ts` — serverFn `getRecoveryDashboard` (lista + métricas)
- `src/lib/templateRecommend.ts` — função de recomendação

**Editados (cirúrgicos):**
- `src/routes/inbox.index.tsx` — botão "Recuperação 24h" no header
- `src/components/MetaTemplatesModal.tsx` — aceitar `suggestedTemplateName?: string` para pré-seleção

Nada do fluxo atual do Inbox, do OpportunityHub, da IA, ou dos templates da Meta é alterado.
