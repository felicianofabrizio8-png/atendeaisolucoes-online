import { describe, expect, it } from "vitest";
import { matchesPrimary, readStoredSequence, sequenceToStore, validateStoredSequence } from "../campaign-image-sequence";

const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";
const PRODUCT_A = "33333333-3333-4333-8333-333333333333";
const focal = { x: 0.3, y: 0.7, zoom: 1.5 };

const one = { position: 0, primary: true, source: "marketing_media" as const, image_id: MEDIA_A, focal_point: null };

describe("sequência de imagens da campanha", () => {
  it("mantém compatibilidade legada para uma imagem sem enquadramento", () => {
    expect(sequenceToStore([one])).toBeNull();
  });

  it("persiste focal point e rejeita mais de oito imagens", () => {
    expect(sequenceToStore([{ ...one, focal_point: focal }])).toEqual([{ ...one, focal_point: focal }]);
    const tooMany = Array.from({ length: 9 }, (_, position) => ({ ...one, position, primary: position === 0 }));
    expect(() => sequenceToStore(tooMany)).toThrow("campaign_image_sequence_invalid:length");
  });

  it("lê marketing e produto na ordem com o enquadramento de cada item", () => {
    expect(readStoredSequence({ image_sequence: [
      { ...one, focal_point: focal },
      { position: 1, primary: false, source: "product_image", product_id: PRODUCT_A, product_image_path: "products/1.jpg", focal_point: null },
    ]})).toEqual([
      { origin: "marketing", media_id: MEDIA_A, focal_point: focal, position: 0, primary: true },
      { origin: "product", product_id: PRODUCT_A, image_path: "products/1.jpg", focal_point: null, position: 1, primary: false },
    ]);
  });

  it("rejeita sequência malformada sem descartar itens nem fazer fallback", () => {
    expect(readStoredSequence(null)).toEqual([]);
    expect(() => readStoredSequence({ image_sequence: "invalid" })).toThrow("campaign_image_sequence_invalid");
    expect(() => readStoredSequence({ image_sequence: [{ ...one, position: 1 }] })).toThrow("campaign_image_sequence_invalid:positions");
    expect(() => readStoredSequence({ image_sequence: [{ ...one, primary: false }] })).toThrow("campaign_image_sequence_invalid:primary_first");
    expect(() => readStoredSequence({ image_sequence: [{ ...one, focal_point: { x: 2, y: 0, zoom: 1 } }] })).toThrow("campaign_image_sequence_invalid:focal_point_0");
  });

  it("exige posições consecutivas e uma única primary na primeira posição", () => {
    expect(() => validateStoredSequence([{ ...one }, { ...one, position: 2, primary: false }])).toThrow("campaign_image_sequence_invalid:positions");
    expect(() => validateStoredSequence([{ ...one }, { ...one, position: 1, primary: true }])).toThrow("campaign_image_sequence_invalid:multiple_primary");
  });

  it("só reutiliza a sequência quando o primeiro item é a imagem primária", () => {
    const first = { origin: "marketing" as const, media_id: MEDIA_A, focal_point: null, position: 0, primary: true };
    expect(matchesPrimary(first, { source: "marketing_media", image_id: MEDIA_A })).toBe(true);
    expect(matchesPrimary(first, { source: "marketing_media", image_id: MEDIA_B })).toBe(false);
  });
});