// Chave da publicação de carrossel. DESLIGADA por padrão: enquanto não for
// ligada explicitamente no ambiente, nenhum carrossel é agendado nem enviado
// à Meta — o conteúdo continua disponível para baixar e publicar manualmente.
//
// Duas formas de ligar, ambas por configuração do ambiente (nunca no código):
// - `MARKETING_CAROUSEL_PUBLISH=enabled` libera para TODAS as empresas;
// - `MARKETING_CAROUSEL_PUBLISH_COMPANIES=<id>,<id>` libera só para as
//   empresas listadas (teste controlado). As demais seguem desligadas.
//
// Ligar exige, antes: aplicar a migração que aceita o formato `carousel` em
// `marketing_publications` e validar o fluxo em uma conta de teste.
export const CAROUSEL_PUBLISH_ENV = "MARKETING_CAROUSEL_PUBLISH";
export const CAROUSEL_PUBLISH_COMPANIES_ENV = "MARKETING_CAROUSEL_PUBLISH_COMPANIES";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Empresas liberadas para o teste. Entradas que não são um id válido são ignoradas. */
export function carouselPublishCompanies(env: Record<string, string | undefined> = process.env): string[] {
  return (env[CAROUSEL_PUBLISH_COMPANIES_ENV] ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => UUID.test(id));
}

/**
 * A empresa pode publicar carrossel? Sem empresa informada, só vale a chave
 * geral — a lista de teste nunca libera um pedido sem dono.
 */
export function isCarouselPublishEnabled(companyId?: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (env[CAROUSEL_PUBLISH_ENV] === "enabled") return true;
  if (typeof companyId !== "string" || !UUID.test(companyId.toLowerCase())) return false;
  return carouselPublishCompanies(env).includes(companyId.toLowerCase());
}

export const CAROUSEL_PUBLISH_DISABLED_MESSAGE =
  "A publicação automática de carrossel ainda não está liberada. Abra o conteúdo no estúdio, baixe as imagens e publique manualmente.";
