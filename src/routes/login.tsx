import { createFileRoute, redirect } from "@tanstack/react-router";

// Links antigos continuam válidos, mas a autenticação acontece no modal da landing page.
export const Route = createFileRoute("/login")({
  beforeLoad: ({ location }) => {
    const invite = new URLSearchParams(location.searchStr).get("invite");
    if (invite) throw redirect({ to: "/convite", search: { token: invite } });
    throw redirect({ to: "/" });
  },
});
