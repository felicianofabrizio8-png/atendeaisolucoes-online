import * as React from "react";
import { classifyWidth, type DeviceClass } from "@/lib/responsive/breakpoints";

/**
 * Retorna a classe de dispositivo atual.
 *
 * SSR-safe: durante a hidratação retorna `undefined` até o primeiro efeito,
 * evitando mismatch. Use `useIsHandheld()` quando só precisar do booleano.
 */
export function useDeviceClass(): DeviceClass | undefined {
  const [device, setDevice] = React.useState<DeviceClass | undefined>(undefined);

  React.useEffect(() => {
    const update = () => setDevice(classifyWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return device;
}

/** `true` apenas em telefones (< 768px). Falso durante SSR/primeiro paint. */
export function useIsHandheld(): boolean {
  return useDeviceClass() === "mobile";
}
