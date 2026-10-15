/** Deduplicates preview URL resolution across state-effect rerenders. */
export function claimPreviewResolution(inFlight: Set<string>, key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releasePreviewResolution(inFlight: Set<string>, key: string): void {
  inFlight.delete(key);
}
