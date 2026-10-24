# Retomada — integração da vendedora unificada

Worktree: `C:\Users\AMD\atendeai-vendedora-unificada` — branch local `integracao/vendedora-unificada`
(base `origin/main` `ac9bc4dc`). Nada foi enviado (sem push, sem deploy, sem banco remoto).

## Estado (2026-10-23)

| Etapa | Situação | Commit |
|---|---|---|
| 0 Backups verificáveis | concluída | branch `backup/bruna-unificada-20261023`; `C:\Users\AMD\atendeai-backups\20261023-integracao-vendedora\` |
| 1 Worktree novo + linha de base | concluída | — |
| 2 Fundações, envio, follow-ups | concluída | `07a01d26`, `9db909be` |
| 3 Controles unificados da IA | concluída | `3da01459`, `12dda31d` |
| 4 Motor | concluída | `62edb9e8` |
| 5 Política de desconto | concluída | ver `git log -1` |
| 6 Adaptador de envio da Bruna/lease atrás de chave desligada | concluída | `6352bd61` |
| 7 Testes completos, build, migrations, relatório final | concluída | `6352bd61`, `78309538` + validação SQL |

Detalhes, decisões e pendências de cada etapa: `docs/integracao-vendedora/DIARIO.md`.

## Para retomar

1. `git -C C:\Users\AMD\atendeai-vendedora-unificada status` deve estar limpo.
2. Dependências: `npm install --legacy-peer-deps` (lockfile da main dessincronizado; restaurar o
   lockfile após instalar) e `npm install --no-save @testing-library/dom@10`.
3. Banco local descartável: pilha Supabase `vendedora-unificada-validacao` (portas 4732x); só o
   contêiner `supabase_db_vendedora-unificada-validacao` fica ligado. Não mexer nos contêineres
   `evolution_*` nem em outros projetos.
4. Próximo passo: etapa 6.

## Decisões pendentes do negócio

- Desligar a IA numa conversa deve valer também nos modos geral/automático?
- Qualificação automática no tick em modo assistido (hoje segue a main).
- Empresas com desconto descrito só em texto: cadastrar no cartão "Política de desconto".

## Retomada 2026-10-23 — etapas 6–7

- O adaptador Bruna foi integrado somente ao sink de texto de envios `automatic`, com a
  flag `BRUNA_WHATSAPP_TEXT_ADAPTER=enabled`; ausente ou diferente de `enabled` mantém o
  caminho legado. Follow-ups, humano, mídia, áudio, templates, orçamentos, handoff e
  vendedora externa não foram redirecionados.
- `actionId` usa o `messageClaim` estável do tick; o adaptador preserva metadados e mantém
  autorização tenant-scoped, reautorização, lease/fence, tentativa durável e dedupe já
  existentes.
- Testes direcionados: 139/139; TypeScript: 0 erros; build: OK.
- Os 5 erros `matchMedia` do teste de marketing/jsdom são preexistentes: os arquivos
  `MarketingMotion.tsx` e `marketing-ia-reorganization.test.tsx` não diferem do `HEAD`, e
  o teste passa isoladamente com os mesmos erros não tratados do ambiente.
- Banco descartável `supabase_db_vendedora-unificada-validacao` confirmado saudável; validação
  executada exclusivamente nele, sem tocar nos demais containers.
- Migrations/SQL: attempts Phase 1, reconciliação de status, política de descontos e leases
  passaram. A migration de descontos também foi reaplicada em transação e revertida com sucesso.
