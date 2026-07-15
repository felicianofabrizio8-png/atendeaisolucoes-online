import { describe, it, expect, beforeEach } from "vitest";
import {
  isGuardEnabled,
  __resetKillSwitchCacheForTests,
  __setKillSwitchForTests,
} from "../killSwitch";

describe("killSwitch", () => {
  beforeEach(() => {
    __resetKillSwitchCacheForTests();
    delete (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.ENVIRONMENT_GUARD_FORCE_DISABLE;
  });

  it("cache injetado retorna o valor sem I/O", async () => {
    __setKillSwitchForTests(true);
    expect(await isGuardEnabled()).toBe(true);
    __setKillSwitchForTests(false);
    expect(await isGuardEnabled()).toBe(false);
  });

  it("ENVIRONMENT_GUARD_FORCE_DISABLE=true tem precedência absoluta", async () => {
    __setKillSwitchForTests(true);
    (globalThis as { process: { env: Record<string, string | undefined> } }).process = {
      env: { ENVIRONMENT_GUARD_FORCE_DISABLE: "true" },
    };
    expect(await isGuardEnabled()).toBe(false);
  });
});
