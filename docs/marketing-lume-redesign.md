# Marketing com Lume — interface e validação

## Alterações por etapa

| Etapa | Interface |
| --- | --- |
| Visão geral | Hero editorial com três cards próximos, esculturas ópticas em SVG, métricas animadas, atalhos e agenda. |
| Criar com Lume | Fluxo Mensagem → Imagens → Trilha e criação, resumo da campanha e campos explicativos; criação manual preservada. |
| Geração e renderização | Estado “Lume pensando”, progresso real por formato, confirmação e recuperação de falhas. |
| Editor | Prévia com tamanho limitado, controles com rolagem e linguagem mais direta. |
| Revisão | Cards com o mesmo acabamento visual e diálogo acessível de agendamento. |
| Calendário e publicações | Cabeçalhos, superfícies, estados e ações alinhados ao estúdio. |
| Fotos, vídeos e áudios | Bibliotecas, filtros, estados vazios, upload e edição com o mesmo sistema visual. |
| Promoções e marca | Formulários e blocos organizados com hierarquia consistente. |

A navegação permanece fora da transição entre etapas. As mudanças visuais não substituem os serviços existentes de criação, revisão, agendamento ou publicação.

## Sistema visual

- Tipografia Inter; microlegendas monoespaçadas.
- Tokens locais: `src/components/marketing/lume-optical.css`; estrutura e responsividade: `marketing.css` no mesmo diretório.
- Objetos: `MarketingArtwork.tsx`; hero: `MarketingHero.tsx`; navegação: `MarketingWorkspace.tsx`.
- Movimento, contadores e estado de geração: `MarketingMotion.tsx`; notificações: `MarketingFeedback.tsx`.
- O estúdio conserva sua superfície escura nos temas globais claro, escuro e preto. As regras são limitadas ao Marketing e aos seus diálogos.
- As formas usam SVG/CSS com camadas de luz, gradientes e deslocamento óptico. São uma aproximação visual de vidro, sem renderização física 3D ou fotografias.
- Animações respeitam `prefers-reduced-motion`; objetos e aurora pausam fora da área visível, e o ambiente pausa com a página oculta. Dispositivos pequenos recebem efeitos mais leves.
- O redesign óptico reutiliza Framer Motion e Lucide existentes; não adiciona dependências. O conjunto de trabalho de Dashboard/Atendimento inclui `vgpu` e `unpdf`, registrados em `package.json` e no lockfile.

## Verificação — 14/10/2026

- TypeScript: `npx tsc --noEmit`, aprovado.
- Produção: `npm run build`, aprovado.
- Testes direcionados aos arquivos alterados de Marketing, Dashboard e Atendimento: 74 aprovados, em 11 arquivos.
- Suíte geral: 2.629 aprovados, 19 falhas, 9 ignorados; 203 arquivos aprovados e 8 com falha. A suíte geral não está inteiramente verde.
- Falhas encontradas: dependências locais ausentes do worker (`ffmpeg`/`ffprobe` e `@resvg/resvg-js`), expectativas de CoachPanel e SalesAgent em arquivos não alterados por este conjunto e um timeout no teste de orçamento sob a execução geral concorrente.
- Conferência visual em prévia isolada com dados fictícios: visão geral, criação, preservação de campos entre passos, editor e renderização. Nenhuma campanha real foi gerada, agendada ou publicada para testar a interface.

A prévia isolada é uma ferramenta local ignorada pelo Git. O projeto completo usa o fluxo normal de autenticação. O desempenho em todos os dispositivos e os serviços externos autenticados não foram certificados por estes testes.
