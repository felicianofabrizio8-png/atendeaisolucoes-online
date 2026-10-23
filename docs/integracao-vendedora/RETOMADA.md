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
| 6 Adaptador de envio da Bruna/lease atrás de chave desligada | **não iniciada** | — |
| 7 Testes completos, build, migrations, relatório final | não iniciada | — |

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
