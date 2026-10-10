// Chave da publicação de carrossel. DESLIGADA por padrão: enquanto não for
// ligada explicitamente no ambiente, nenhum carrossel é agendado nem enviado
// à Meta — o conteúdo continua disponível para baixar e publicar manualmente.
//
// Ligar exige, antes: aplicar a migração que aceita o formato `carousel` em
// `marketing_publications` e validar o fluxo em uma conta de teste.
export const CAROUSEL_PUBLISH_ENV = "MARKETING_CAROUSEL_PUBLISH";

export function isCarouselPublishEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CAROUSEL_PUBLISH_ENV] === "enabled";
}

export const CAROUSEL_PUBLISH_DISABLED_MESSAGE =
  "A publicação automática de carrossel ainda não está liberada. Abra o conteúdo no estúdio, baixe as imagens e publique manualmente.";
