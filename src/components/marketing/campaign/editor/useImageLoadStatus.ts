// Acompanha se o navegador conseguiu abrir a imagem de uma URL. Sem isto, um
// link expirado ou sem permissão deixaria a prévia preta sem dizer por quê.

import { useEffect, useState } from "react";
import { MEDIA_IMAGE_TIMEOUT_MS } from "@/lib/marketing/campaign-media";

export type ImageLoadStatus = "idle" | "loading" | "ready" | "error" | "timeout";

/**
 * `attempt` força uma nova tentativa com a mesma URL (botão "tentar novamente").
 * Depois de `timeoutMs` sem resposta o estado vira "timeout" — nunca fica em
 * "loading" indefinidamente.
 */
export function useImageLoadStatus(
  url: string | null | undefined,
  attempt = 0,
  timeoutMs: number = MEDIA_IMAGE_TIMEOUT_MS,
): ImageLoadStatus {
  const [state, setState] = useState<{ key: string; status: ImageLoadStatus }>({ key: "", status: "idle" });
  const key = url ? `${attempt}:${url}` : "";

  useEffect(() => {
    if (!url || typeof Image === "undefined") return;
    let done = false;
    const finish = (status: ImageLoadStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setState({ key, status });
    };
    const probe = new Image();
    probe.onload = () => finish(probe.naturalWidth === 0 && probe.naturalHeight === 0 ? "error" : "ready");
    probe.onerror = () => finish("error");
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    probe.src = url;
    return () => {
      done = true;
      clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
    };
  }, [url, key, timeoutMs]);

  if (!url) return "idle";
  return state.key === key ? state.status : "loading";
}
