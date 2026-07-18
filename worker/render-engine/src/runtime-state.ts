// Estado mutável do processo — usado pelos handlers de sinal/erros para
// registrar qual job estava em execução quando o processo foi encerrado
// abruptamente. Nunca contém tokens ou dados sensíveis.

let activeJobId: string | null = null;

export function setActiveJobId(id: string | null): void {
  activeJobId = id;
}

export function getActiveJobId(): string | null {
  return activeJobId;
}
