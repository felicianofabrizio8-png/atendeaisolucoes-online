# Lume — assistente da equipe (Agenda)

A Lume conversa por texto ou áudio e age na Agenda: consulta, acha horários livres,
cria, altera, exclui, cria lembretes, avisa colegas e cria automações. Ela usa a sessão
de quem pede: só faz o que essa pessoa poderia fazer na tela (permissão "Gerenciar agenda").

## Ligar a IA

Defina no servidor (Cloudflare / Lovable → variáveis de ambiente):

| Variável | O que é |
| --- | --- |
| `LUME_AI_ENDPOINT` | URL de chat compatível com a OpenAI, ex.: `https://api.openai.com/v1/chat/completions` |
| `LUME_AI_MODEL` | Modelo com suporte a ferramentas (function calling) |
| `LUME_AI_API_KEY` | Chave do provedor |
| `LUME_AI_TRANSCRIBE_API_KEY` | Opcional. Chave para áudio; sem ela usa `OPENAI_API_KEY` |
| `LUME_AI_TRANSCRIBE_MODEL` / `_URL` | Opcionais. Padrão: `whisper-1` na OpenAI |

Sem as variáveis `LUME_AI_*`, a Lume usa a configuração da Vendedora
(`SALES_AGENT_LLM_*`). Sem nenhuma, o painel avisa que falta a chave e não responde.

## Banco

Migração `supabase/migrations/20261015120000_agenda_lume_foundation.sql` (aditiva):
colunas novas em `visits` e as tabelas `agenda_*` e `lume_*`. Antes dela, a Agenda e a
Lume funcionam com as colunas de sempre; tipos, histórico, lembretes, avisos e
automações aparecem como "disponível após publicar".

## Regras de ação

| Ação | Comportamento |
| --- | --- |
| Consultar, horários livres | Executa |
| Criar compromisso, lembrete | Executa e mostra **Desfazer** |
| Alterar, excluir, avisar pessoas, criar automação | Mostra cartão e só executa no **Confirmar** |

Tudo que a Lume muda aparece no histórico do compromisso como "via Lume".

## Arquitetura (ecossistema)

- `src/lib/lume/agent.server.ts` — núcleo de conversa, independe do domínio.
- `src/lib/lume/domains/agenda.server.ts` — ferramentas da Agenda. Novos domínios
  (Atendimento, Marketing, Orçamentos) entram como novos arquivos em `domains/` e na
  lista `DOMAINS` de `http.server.ts`, com a permissão correspondente em
  `apiPermission`.
- `src/components/lume/LumeDock.tsx` — cápsula e painel, reutilizáveis em qualquer tela
  (`page`, `suggestions`, `onChanged`).
- Rotas: `POST /api/lume/chat`, `POST /api/lume/action`, `GET /api/lume/status`.

## Hierarquia (16/10)
- `agenda_criar` aceita `alcance` (`pessoal` | `equipe`), `participantes` (nomes, ou "todos") e `tags` (nomes); `agenda_alterar` muda o alcance (participantes e tags de um compromisso existente são ajustados pela tela).
- Por padrão a Lume cria compromissos pessoais. Compromisso da equipe só para quem tem "Gerenciar agenda da equipe"; para os demais o banco recusa e a Lume explica.
- Tags pessoais de outras pessoas nunca são usadas. Nomes que não existem voltam em `nao_encontrados`.
