// Contrato oficial de saída do MetaOutbound. Tipos puros, sem I/O.
// Todo consumidor (rota, ai-agent, follow-up, campanha) recebe este shape.
// Nenhum código pode interpretar `simulated: true` como entrega ao cliente.

export interface OutboundSuccessProduction<TRaw = unknown> {
  success: true;
  simulated: false;
  environment: "production" | "legacy";
  externalRequestSent: true;
  externalId: string | null;
  status: number;
  raw: TRaw;
}

export interface OutboundSimulated {
  success: true;
  simulated: true;
  environment: "staging" | "unknown";
  externalRequestSent: false;
  simulationId: string | null;
  would: {
    url: string;
    method: string;
  };
}

export interface OutboundFailure {
  success: false;
  simulated: false;
  environment: "production" | "legacy" | "staging" | "unknown";
  externalRequestSent: boolean; // true se o fetch foi enviado mas provider recusou
  error: string;
  status?: number;
  retryable: boolean;
  providerError?: unknown;
}

export type OutboundResult<TRaw = unknown> =
  | OutboundSuccessProduction<TRaw>
  | OutboundSimulated
  | OutboundFailure;

/** Type guard: envio real bem-sucedido. */
export function isRealDelivery<T>(r: OutboundResult<T>): r is OutboundSuccessProduction<T> {
  return r.success && !r.simulated && r.externalRequestSent === true;
}

/** Type guard: simulação (nunca tratar como entrega). */
export function isSimulation<T>(r: OutboundResult<T>): r is OutboundSimulated {
  return r.success && r.simulated === true;
}

/** Type guard: falha. */
export function isFailure<T>(r: OutboundResult<T>): r is OutboundFailure {
  return r.success === false;
}
