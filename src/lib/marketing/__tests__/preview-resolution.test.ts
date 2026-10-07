import { describe, expect, it } from "vitest";
import { claimPreviewResolution, releasePreviewResolution } from "../preview-resolution";

describe("preview resolution deduplication", () => {
  it("does not start a second resolution when loading state rerenders the effect", () => {
    const inFlight = new Set<string>();

    expect(claimPreviewResolution(inFlight, "m:media-1")).toBe(true);
    expect(claimPreviewResolution(inFlight, "m:media-1")).toBe(false);
    expect(inFlight.has("m:media-1")).toBe(true);

    releasePreviewResolution(inFlight, "m:media-1");
    expect(claimPreviewResolution(inFlight, "m:media-1")).toBe(true);
  });
});
