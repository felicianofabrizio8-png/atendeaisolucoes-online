// Helpers puros (sem componentes React) reutilizados pelo console admin.
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";

/**
 * Retorna label amigável se `err` for uma sinalização de feature flag
 * desligada/kill-switch; caso contrário retorna null.
 *
 * @deprecated 3.1a — use `getSafeInterpreterError` diretamente. Mantido
 * para compatibilidade com testes existentes que checam labels de flag.
 */
export function extractDisabledMessage(err: unknown): string | null {
  const safe = getSafeInterpreterError(err);
  if (safe.disabled || safe.killed) return safe.message;
  return null;
}

/** Formata ISO em pt-BR "dd/mm/aa hh:mm". Retorna "—" quando vazio. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
