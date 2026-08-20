# Diagnóstico de Reconciliação da Inbox

## ETAPA 4 — COMPARAÇÃO AUTOMÁTICA
- **BANCO DE DADOS:** 255 conversas relevantes (com mensagens).
- **INBOX (snapshot esperado):** ~239 conversas (assumindo que filtros de status ocultam algumas).
- **AUSENTES:** Identificados 8 grupos de leads fragmentados (leads duplicados por telefone com/sem 55) que causam a "divisão" do histórico.

## ETAPA 1 & 2 — REGISTROS AUSENTES / FRAGMENTADOS
As conversas ausentes ou fragmentadas pertencem principalmente aos seguintes clientes:
1. **Fernanda Libois** (11967110363): Fragmentada entre `c656d90f...` (70 msgs) e `c41bf424...` (29 msgs).
2. **Claudia** (15981225550): Fragmentada entre `23eaefe4...` (4 msgs) e `0cf0513c...` (21 msgs).
3. **Maicon Oliveira/Maikon** (15988002521): Fragmentada entre `813d150d...` (28 msgs) e `59a0f7ad...` (6 msgs).
4. **Andre Augusto** (15997619288): Fragmentada entre `9145d512...` (5 msgs) e `e6ac9db2...` (6 msgs).
5. **João Carlos Fabiano** (15991863775): Fragmentada entre `fbfe517c...` (17 msgs) e `0b2b9d9f...` (13 msgs).

## CAUSA RAIZ
A Inbox agrupa por `conversation_id`. Como a normalização de telefone foi aplicada recentemente, mensagens novas estão indo para um **novo lead** (com telefone normalizado), enquanto o histórico antigo permanece em um **lead antigo** (sem prefixo 55). Isso cria duas conversas distintas para a mesma pessoa física, fazendo o histórico parecer "sumir" ou "partir" na Inbox.

## PLANO DE CORREÇÃO (ETAPA 6)
Implementarei uma migração de consolidação segura que reatribui mensagens e orçamentos do lead antigo para o lead normalizado e, em seguida, remove o lead duplicado vazio.
