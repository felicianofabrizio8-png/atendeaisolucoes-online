# ChatFlow Pro

Crie um sistema SaaS chamado Atende Ai!, focado em atendimento de leads e vendas via WhatsApp, Instagram e Facebook.

🎯 OBJETIVO

O sistema deve ajudar empresas a não perderem leads por demora no atendimento, organizando conversas, priorizando clientes e sugerindo respostas com IA.

🧩 ARQUITETURA (IMPORTANTE)

Sistema multiempresa (multi-tenant)

Cada empresa tem seus próprios:

usuários

leads

conversas

produtos

preços

configurações

Banco: Supabase

Backend: Edge Functions

Frontend: Vite + React + Tailwind

👥 TIPOS DE USUÁRIO

Dono (admin)

Vendedor

📊 1. DASHBOARD (SIMPLES)

Mostrar apenas:

🔴 Leads sem resposta

🔥 Leads quentes

⏳ Follow-ups do dia

💰 Valor em negociação

Botão: “Ver detalhes” (abre relatórios completos)

💬 2. CAIXA DE ATENDIMENTO (PRINCIPAL)

Lista de conversas:

Cada item deve mostrar:

nome do cliente

origem (WhatsApp / Instagram / Facebook)

tempo sem resposta

status (novo, quente, aguardando, etc)

última mensagem

Ordenação automática:

sem resposta

leads quentes

follow-ups vencidos

💬 3. TELA DE CONVERSA

Exibir:

histórico completo

tempo desde última mensagem

origem do lead

Ações:

botão “Gerar resposta com IA”

botão “Criar orçamento”

botão “Agendar visita”

botão “Definir próxima ação”

botão “Marcar como perdido”

botão “Marcar como fechado”

🧠 4. IA DE ATENDIMENTO

A IA deve:

analisar conversa

identificar intenção

classificar lead (frio, morno, quente)

identificar objeção

sugerir próxima ação

gerar mensagem pronta de venda

📌 5. CAMPO OBRIGATÓRIO: PRÓXIMA AÇÃO

Todo lead deve ter:

próxima ação (ex: chamar amanhã)

data

Se não tiver:
→ marcar como “⚠️ sem próxima ação”

🏷️ 6. TAGS

Sistema deve permitir:

tags automáticas (ex: pediu preço)

tags manuais

🔁 7. FOLLOW-UP AUTOMÁTICO

Sistema deve:

avisar quando lead precisa ser chamado

sugerir mensagem pronta

permitir envio rápido

🧾 8. ORÇAMENTOS

Criar módulo com:

Campos:

produto

valor

desconto

forma de pagamento

parcelas

validade

Gerar mensagem automática para envio

🏗️ 9. PRODUTOS (CATÁLOGO)

Permitir cadastro de:

Categorias:

Piscinas de fibra

Piscinas de vinil

Troca de vinil

Aquecedores (solar, elétrico, trocador)

Spas e banheiras

Acessórios

Tratamento de água

Cada produto:

nome

descrição

preço

preço promocional

observações

💰 10. TABELA DE PREÇOS DINÂMICA

Sistema deve permitir:

criar tabela mensal (ex: Maio 2026)

definir tabela ativa

todos produtos usam tabela ativa

📅 11. AGENDA DE VISITAS

Campos:

cliente

endereço

data

horário

status

📊 12. RELATÓRIOS (ADMIN)

Mostrar:

leads recebidos

tempo médio de resposta

taxa de conversão

vendas

leads perdidos

origem dos leads

motivos de perda

❌ 13. MOTIVO DE PERDA

Ao marcar como perdido:

Selecionar:

preço alto

fechou com concorrente

desistiu

sem retorno

outro

⏱️ 14. SLA DE RESPOSTA

Sistema deve:

marcar lead como urgente após X minutos

destacar leads sem resposta

mostrar tempo médio por vendedor

🔗 15. INTEGRAÇÕES

Preparar estrutura para:

WhatsApp Cloud API

Instagram Messaging API

Facebook Messenger

Meta Lead Ads

Usar webhooks para receber mensagens

🔐 16. SEGURANÇA

cada empresa isolada

usuários só acessam seus dados

🎨 UI/UX

visual LIMPO

foco em ação rápida

evitar telas poluídas

mobile-first

🚀 DIFERENCIAL

Sistema deve sempre responder:

👉 “Quem precisa de atenção agora para não perder venda?”

⚠️ IMPORTANTE

Não travar o sistema para nicho de piscinas.
Tudo deve ser configurável para qualquer negócio.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://atendeaisolucoes-online.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/23e14a46-10ac-4695-adc6-36e0ab29fd20).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
