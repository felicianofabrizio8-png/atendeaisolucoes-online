import { createFileRoute, redirect } from "@tanstack/react-router";

// Links antigos continuam válidos, mas a autenticação acontece no modal da landing page.
export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
