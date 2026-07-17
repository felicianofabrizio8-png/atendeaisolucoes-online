import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/meta/config")({
  server: {
    handlers: {
      GET: async () => {
        const appId = process.env.META_APP_ID ?? "";
        const businessConfigId =
          process.env.META_BUSINESS_CONFIG_ID ?? process.env.META_CONFIG_ID ?? "";
        // Configuration ID dedicada ao Facebook Login for Business com
        // pages_manage_posts + pages_read_engagement — usada apenas pelo
        // botão "Conectar publicação do Facebook". NÃO deve substituir o
        // businessConfigId (fluxo Instagram/Ads permanece intacto).
        const pageLoginConfigId = process.env.META_PAGE_LOGIN_CONFIG_ID ?? "";

        return Response.json({
          appId,
          businessConfigId,
          pageLoginConfigId,
          hasAppId: Boolean(appId),
          hasBusinessConfigId: Boolean(businessConfigId),
          hasPageLoginConfigId: Boolean(pageLoginConfigId),
        });
      },
    },
  },
});