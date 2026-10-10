// Sem dependências de Node: importado também pela prévia do app.

/**
 * Parâmetros do preenchimento "desfoque". A prévia do app aplica exatamente
 * estes valores em CSS; mudar aqui exige mudar lá (há teste que confere).
 */
export const BLUR = { zoom: 1.14, sigma: 0.05, brightness: 0.9, saturation: 0.9 } as const;
