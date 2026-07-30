// Suíte de garantias do verificador de assinatura do webhook da Meta.
//
// Importa o MESMO arquivo deployado na Edge Function (`supabase/functions/...`),
// e não uma cópia — assim um teste verde comprova o comportamento em produção.
import { describe, it, expect } from "vitest";
import {
  buildSecretCandidates,
  parseSecretToken,
  verifyMetaSignature,
  hmacHex,
} from "../../../../supabase/functions/meta-webhook/signature";

const FB_SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const IG_SECRET = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const ROTATED = "ffeeddccbbaa99887766554433221100";

const FB_APP_ID = "1006678438709572";
const IG_APP_ID = "981573787924167";

const body = () => new TextEncoder().encode(JSON.stringify({ object: "instagram", entry: [] }));

async function signWith(secret: string) {
  return `sha256=${await hmacHex(secret, body())}`;
}

describe("parseSecretToken — formatos aceitos", () => {
  it("aceita o segredo puro", () => {
    const { candidate, malformed } = parseSecretToken(FB_SECRET, 0);
    expect(malformed).toBeNull();
    expect(candidate?.secret).toBe(FB_SECRET);
  });

  it("extrai appId e segredo de 'appId:secret'", () => {
    const { candidate } = parseSecretToken(`${IG_APP_ID}:${IG_SECRET}`, 0);
    expect(candidate?.appId).toBe(IG_APP_ID);
    expect(candidate?.secret).toBe(IG_SECRET);
  });

  it("aceita 'rótulo = secret' com espaços e aspas", () => {
    const { candidate } = parseSecretToken(` "Atende Ai IG = ${IG_SECRET}" `, 0);
    expect(candidate?.secret).toBe(IG_SECRET);
  });

  it("normaliza segredo em maiúsculas", () => {
    const { candidate } = parseSecretToken(FB_SECRET.toUpperCase(), 0);
    expect(candidate?.secret).toBe(FB_SECRET);
  });
});

describe("parseSecretToken — REGRESSÃO: nunca inventar candidatos", () => {
  // Este é o defeito que causava o BAD_SIGNATURE: o parser antigo, ao não
  // encontrar 32 hex, usava o token inteiro como "segredo", produzindo
  // candidatos de 19 e 25 caracteres que jamais poderiam bater.
  it.each([
    ["nome sem segredo", 19],
    ["Instagram Atende Ai", 25],
    ["1006678438709572", 16],
  ])("rejeita %s em vez de virar candidato inválido", (token) => {
    const { candidate, malformed } = parseSecretToken(token, 0);
    expect(candidate).toBeNull();
    expect(malformed?.reason).toBe("no_32_hex_secret");
  });

  it("nunca produz candidato com comprimento diferente de 32", () => {
    const parsed = buildSecretCandidates({
      META_APP_SECRETS: `lixo,${FB_SECRET},outro token qualquer,${IG_SECRET}`,
    });
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates.every((c) => c.secret.length === 32)).toBe(true);
    expect(parsed.malformed).toHaveLength(2);
  });

  it("descreve o token malformado SEM expor o valor", () => {
    const parsed = buildSecretCandidates({ META_APP_SECRETS: "segredo-secreto-do-cliente" });
    expect(JSON.stringify(parsed.malformed)).not.toContain("segredo-secreto");
    expect(parsed.malformed[0]).toMatchObject({ reason: "no_32_hex_secret", rawLength: 26 });
  });
});

describe("buildSecretCandidates — múltiplos apps", () => {
  it("respeita a prioridade: principal, instagram, lista extra", () => {
    const parsed = buildSecretCandidates({
      META_APP_SECRET: FB_SECRET,
      META_APP_ID: FB_APP_ID,
      META_INSTAGRAM_APP_SECRET: IG_SECRET,
      META_INSTAGRAM_APP_ID: IG_APP_ID,
      META_APP_SECRETS: ROTATED,
    });
    expect(parsed.candidates.map((c) => c.source)).toEqual([
      "META_APP_SECRET",
      "META_INSTAGRAM_APP_SECRET",
      "META_APP_SECRETS",
    ]);
    expect(parsed.candidates[0].appId).toBe(FB_APP_ID);
    expect(parsed.candidates[1].appId).toBe(IG_APP_ID);
  });

  it("deduplica o mesmo segredo repetido em fontes diferentes (rotação)", () => {
    const parsed = buildSecretCandidates({
      META_APP_SECRET: FB_SECRET,
      META_APP_SECRETS: `${FB_SECRET},${IG_SECRET}`,
    });
    expect(parsed.candidates).toHaveLength(2);
  });

  it("aceita META_APP_SECRETS como objeto JSON appId -> secret", () => {
    const parsed = buildSecretCandidates({
      META_APP_SECRETS: JSON.stringify({ [FB_APP_ID]: FB_SECRET, [IG_APP_ID]: IG_SECRET }),
    });
    expect(parsed.candidates.map((c) => c.appId)).toEqual([FB_APP_ID, IG_APP_ID]);
  });

  it("aceita META_APP_SECRETS como array JSON de objetos", () => {
    const parsed = buildSecretCandidates({
      META_APP_SECRETS: JSON.stringify([{ app_id: IG_APP_ID, secret: IG_SECRET, name: "IG" }]),
    });
    expect(parsed.candidates[0]).toMatchObject({ appId: IG_APP_ID, label: "IG", secret: IG_SECRET });
  });

  it("JSON inválido vira malformado, não derruba o parser", () => {
    const parsed = buildSecretCandidates({ META_APP_SECRETS: "{isso nao e json" });
    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.malformed).toHaveLength(1);
  });
});

describe("verifyMetaSignature", () => {
  const env = {
    META_APP_SECRET: FB_SECRET,
    META_APP_ID: FB_APP_ID,
    META_INSTAGRAM_APP_SECRET: IG_SECRET,
    META_INSTAGRAM_APP_ID: IG_APP_ID,
  };

  it("aceita payload assinado pelo app principal (regressão WhatsApp/Messenger)", async () => {
    const r = await verifyMetaSignature(body(), await signWith(FB_SECRET), buildSecretCandidates(env));
    expect(r.ok).toBe(true);
    expect(r.matched?.appId).toBe(FB_APP_ID);
  });

  it("aceita payload assinado pelo app do Instagram", async () => {
    const r = await verifyMetaSignature(body(), await signWith(IG_SECRET), buildSecretCandidates(env));
    expect(r.ok).toBe(true);
    expect(r.matched?.appId).toBe(IG_APP_ID);
  });

  it("aceita um app novo adicionado só em META_APP_SECRETS", async () => {
    const parsed = buildSecretCandidates({ ...env, META_APP_SECRETS: `novo:${ROTATED}` });
    const r = await verifyMetaSignature(body(), await signWith(ROTATED), parsed);
    expect(r.ok).toBe(true);
    expect(r.matched?.source).toBe("META_APP_SECRETS");
  });

  it("rejeita assinatura de um segredo desconhecido", async () => {
    const r = await verifyMetaSignature(body(), await signWith(ROTATED), buildSecretCandidates(env));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_matching_secret");
    expect(r.secretsTried).toBe(2);
  });

  it("rejeita header ausente ou fora do formato sha256=", async () => {
    const parsed = buildSecretCandidates(env);
    expect((await verifyMetaSignature(body(), null, parsed)).reason).toBe("missing_signature_header");
    expect((await verifyMetaSignature(body(), "sha1=abc", parsed)).reason).toBe(
      "malformed_signature_header",
    );
  });

  it("rejeita quando nenhum segredo está configurado (HMAC nunca é opcional)", async () => {
    const r = await verifyMetaSignature(body(), await signWith(FB_SECRET), buildSecretCandidates({}));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_secrets_configured");
  });

  it("rejeita corpo adulterado com a mesma assinatura", async () => {
    const sig = await signWith(FB_SECRET);
    const tampered = new TextEncoder().encode(JSON.stringify({ object: "instagram", entry: [1] }));
    expect((await verifyMetaSignature(tampered, sig, buildSecretCandidates(env))).ok).toBe(false);
  });

  it("o diagnóstico de rejeição não contém nenhum segredo", async () => {
    const r = await verifyMetaSignature(body(), await signWith(ROTATED), buildSecretCandidates(env));
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(FB_SECRET);
    expect(dump).not.toContain(IG_SECRET);
    expect(r.candidates.every((c) => c.expectedPrefix.length === 12)).toBe(true);
  });
});
