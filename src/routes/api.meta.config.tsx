import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/meta/config")({
  server: {
    handlers: {
      GET: async () => {
        const appId = process.env.META_APP_ID ?? "";
        const businessConfigId =
          process.env.META_BUSINESS_CONFIG_ID ?? process.env.META_CONFIG_ID ?? "";

        return Response.json({
          appId,
          businessConfigId,
          hasAppId: Boolean(appId),
          hasBusinessConfigId: Boolean(businessConfigId),
        });
      },
    },
  },
});