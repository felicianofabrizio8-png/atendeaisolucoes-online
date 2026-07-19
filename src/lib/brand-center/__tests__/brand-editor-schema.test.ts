import { describe, expect, it } from "vitest";
import {
  BrandDraftPayloadSchema,
  DeactivateBrandAssetSchema,
  PublishBrandVersionSchema,
  RegisterBrandAssetSchema,
  SignBrandAssetUploadSchema,
  assertStoragePathOwnership,
} from "../brand-editor-schema";
import { DEFAULT_COLORS, DEFAULT_TOKENS, DEFAULT_TYPOGRAPHY } from "../brand-defaults";
import { MAX_LOGO_BYTES } from "../brand-editor.types";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

const VALID_DRAFT = {
  name: "Identidade Principal",
  description: "Marca corporativa 2026",
  visualStyle: "moderno",
  colors: DEFAULT_COLORS,
  typography: DEFAULT_TYPOGRAPHY,
  tokens: DEFAULT_TOKENS,
};

describe("BrandDraftPayloadSchema", () => {
  it("aceita payload completo válido", () => {
    const r = BrandDraftPayloadSchema.safeParse(VALID_DRAFT);
    expect(r.success).toBe(true);
  });

  it("rejeita companyId ou id enviado pelo cliente", () => {
    const withCompany = { ...VALID_DRAFT, companyId: COMPANY };
    expect(BrandDraftPayloadSchema.safeParse(withCompany).success).toBe(false);
    const withId = { ...VALID_DRAFT, id: VERSION };
    expect(BrandDraftPayloadSchema.safeParse(withId).success).toBe(false);
  });

  it("rejeita cor inválida", () => {
    const r = BrandDraftPayloadSchema.safeParse({
      ...VALID_DRAFT,
      colors: { ...DEFAULT_COLORS, primary: "not-a-color" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita fonte fora da allowlist", () => {
    const r = BrandDraftPayloadSchema.safeParse({
      ...VALID_DRAFT,
      typography: { ...DEFAULT_TYPOGRAPHY, body: "Comic Sans" },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita nome vazio", () => {
    expect(
      BrandDraftPayloadSchema.safeParse({ ...VALID_DRAFT, name: "" }).success,
    ).toBe(false);
  });
});

describe("SignBrandAssetUploadSchema", () => {
  it("aceita PNG dentro do limite", () => {
    const r = SignBrandAssetUploadSchema.safeParse({
      assetType: "logo_primary",
      mimeType: "image/png",
      sizeBytes: 200_000,
      originalFilename: "logo.png",
    });
    expect(r.success).toBe(true);
  });

  it("REJEITA SVG explicitamente", () => {
    const r = SignBrandAssetUploadSchema.safeParse({
      assetType: "logo_primary",
      mimeType: "image/svg+xml",
      sizeBytes: 1000,
      originalFilename: "logo.svg",
    });
    expect(r.success).toBe(false);
  });

  it("rejeita arquivo acima do limite", () => {
    const r = SignBrandAssetUploadSchema.safeParse({
      assetType: "logo_primary",
      mimeType: "image/png",
      sizeBytes: MAX_LOGO_BYTES + 1,
      originalFilename: "logo.png",
    });
    expect(r.success).toBe(false);
  });

  it("rejeita path traversal no filename", () => {
    const r = SignBrandAssetUploadSchema.safeParse({
      assetType: "logo_primary",
      mimeType: "image/png",
      sizeBytes: 1000,
      originalFilename: "../../etc/passwd",
    });
    expect(r.success).toBe(false);
  });

  it("rejeita assetType fora da allowlist do editor", () => {
    const r = SignBrandAssetUploadSchema.safeParse({
      assetType: "watermark",
      mimeType: "image/png",
      sizeBytes: 1000,
      originalFilename: "wm.png",
    });
    expect(r.success).toBe(false);
  });
});

describe("RegisterBrandAssetSchema — rejeição de signed URL", () => {
  const base = {
    assetType: "logo_primary" as const,
    storagePath: `${COMPANY}/brand/logo_primary/abc.png`,
    mimeType: "image/png" as const,
    sizeBytes: 12345,
    width: 512,
    height: 512,
    sha256: "a".repeat(64),
    originalFilename: "logo.png",
  };

  it("aceita registro válido", () => {
    expect(RegisterBrandAssetSchema.safeParse(base).success).toBe(true);
  });

  it("rejeita path com token= (signed URL)", () => {
    const r = RegisterBrandAssetSchema.safeParse({
      ...base,
      storagePath: `${COMPANY}/brand/logo_primary/abc.png?token=xyz`,
    });
    expect(r.success).toBe(false);
  });

  it("rejeita path com signed_url", () => {
    const r = RegisterBrandAssetSchema.safeParse({
      ...base,
      storagePath: `${COMPANY}/brand/logo_primary/signed_url_abc.png`,
    });
    expect(r.success).toBe(false);
  });

  it("rejeita path com traversal", () => {
    const r = RegisterBrandAssetSchema.safeParse({
      ...base,
      storagePath: `${COMPANY}/brand/../secrets/abc.png`,
    });
    expect(r.success).toBe(false);
  });

  it("rejeita extensão inconsistente com MIME", () => {
    const r = RegisterBrandAssetSchema.safeParse({
      ...base,
      mimeType: "image/webp",
      storagePath: `${COMPANY}/brand/logo_primary/logo.png`,
    });
    expect(r.success).toBe(false);
  });

  it("aceita jpeg indistintamente para .jpg", () => {
    const r = RegisterBrandAssetSchema.safeParse({
      ...base,
      mimeType: "image/jpeg",
      storagePath: `${COMPANY}/brand/logo_primary/x.jpg`,
    });
    expect(r.success).toBe(true);
  });

  it("rejeita sha256 malformado", () => {
    const r = RegisterBrandAssetSchema.safeParse({ ...base, sha256: "short" });
    expect(r.success).toBe(false);
  });
});

describe("assertStoragePathOwnership", () => {
  it("aceita path do próprio company + tipo correto", () => {
    const r = assertStoragePathOwnership(
      `${COMPANY}/brand/logo_primary/x.png`,
      COMPANY,
      "logo_primary",
    );
    expect(r.ok).toBe(true);
  });

  it("bloqueia path de outra empresa (cross-tenant)", () => {
    const OTHER = "99999999-9999-9999-9999-999999999999";
    const r = assertStoragePathOwnership(
      `${OTHER}/brand/logo_primary/x.png`,
      COMPANY,
      "logo_primary",
    );
    expect(r.ok).toBe(false);
  });

  it("bloqueia troca de asset_type dentro do path", () => {
    const r = assertStoragePathOwnership(
      `${COMPANY}/brand/favicon/x.png`,
      COMPANY,
      "logo_primary",
    );
    expect(r.ok).toBe(false);
  });
});

describe("PublishBrandVersionSchema / DeactivateBrandAssetSchema", () => {
  it("publish exige UUID válido", () => {
    expect(PublishBrandVersionSchema.safeParse({ versionId: "abc" }).success).toBe(false);
    expect(PublishBrandVersionSchema.safeParse({ versionId: VERSION }).success).toBe(true);
  });
  it("deactivate exige UUID válido", () => {
    expect(DeactivateBrandAssetSchema.safeParse({ assetId: "x" }).success).toBe(false);
    expect(DeactivateBrandAssetSchema.safeParse({ assetId: ASSET }).success).toBe(true);
  });
});
