import { createRouter, useRouter, useRouterState } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";
import { logFrontendError } from "@/lib/frontend-error-log.functions";
import { supabase } from "@/integrations/supabase/client";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const routerState = useRouterState();
  const currentRoute =
    routerState.location?.pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "(unknown)");

  useEffect(() => {
    const ts = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.group(`%c[REACT ERROR] ${currentRoute}`, "color:#f87171;font-weight:bold");
    // eslint-disable-next-line no-console
    console.error("message:", error?.message);
    // eslint-disable-next-line no-console
    console.error("name:", error?.name);
    // eslint-disable-next-line no-console
    console.error("stack:", error?.stack);
    // eslint-disable-next-line no-console
    console.error("route:", currentRoute);
    // eslint-disable-next-line no-console
    console.error("timestamp:", ts);
    // eslint-disable-next-line no-console
    console.error("raw error object:", error);
    if (currentRoute.startsWith("/saude")) {
      // eslint-disable-next-line no-console
      console.error("%c[HEALTH PAGE ERROR]", "color:#fbbf24;font-weight:bold", error);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();

    (async () => {
      try {
        const { data: sess } = await supabase.auth.getUser();
        const userId = sess?.user?.id ?? null;
        // eslint-disable-next-line no-console
        console.error("[REACT ERROR] userId:", userId, "email:", sess?.user?.email ?? null);
        await logFrontendError({
          data: {
            route: currentRoute,
            message: error?.message ?? "(no message)",
            stack: error?.stack ?? null,
            componentStack: null,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
            category: currentRoute.startsWith("/saude") ? "health_page_error" : "react_error",
          },
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[REACT ERROR] failed to persist to error_log", e);
      }
    })();
  }, [error, currentRoute]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-2xl text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rota: <code className="text-xs">{currentRoute}</code>
        </p>
        {error?.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive whitespace-pre-wrap">
            {error.name}: {error.message}
          </pre>
        )}
        {error?.stack && (
          <details className="mt-2 text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">Stack trace</summary>
            <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-3 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
              {error.stack}
            </pre>
          </details>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
