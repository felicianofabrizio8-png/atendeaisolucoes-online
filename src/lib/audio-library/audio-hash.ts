// SHA-256 helper para dedupe de uploads no navegador.
// Usa Web Crypto API — disponível em todos os alvos suportados.

export async function computeFileSha256(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
