import { describe, expect, it } from "vitest";
import { buildFocalVideoFilter, type FocalPoint } from "../ffmpeg";

describe("focal point crop geometry", () => {
  it("scales to cover before applying the focal crop", () => {
    const filter = buildFocalVideoFilter(1080, 1920, { x: 0.25, y: 0.8, zoom: 1.5 });
    expect(filter).toContain("scale=w=iw*max(1080/iw\\,1920/ih)*1.5000");
    expect(filter).toContain("h=ih*max(1080/iw\\,1920/ih)*1.5000");
    expect(filter).toContain("crop=1080:1920:clip(0.2500*iw - 1080/2\\, 0\\, iw - 1080)");
    expect(filter).toContain("clip(0.8000*ih - 1920/2\\, 0\\, ih - 1920)");
  });

  it("keeps legacy focal values bounded and compatible", () => {
    const filter = buildFocalVideoFilter(1080, 1350, { x: -1, y: 4, zoom: 99 } satisfies FocalPoint);
    expect(filter).toContain("*3.0000");
    expect(filter).toContain("clip(0.0000*iw - 1080/2");
    expect(filter).toContain("clip(1.0000*ih - 1350/2");
  });

  it("uses the same geometry for slideshow frames", () => {
    const filter = buildFocalVideoFilter(1080, 1350, { x: 0.5, y: 0.5, zoom: 2 });
    expect(filter).toContain("scale=w=iw*max(1080/iw\\,1350/ih)*2.0000");
    expect(filter).toContain("crop=1080:1350");
  });
});
