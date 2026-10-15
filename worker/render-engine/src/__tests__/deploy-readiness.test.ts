// Garante que a imagem do worker continua construível e que o modo pausado
// realmente não toca na fila.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, parsePaused, type WorkerConfig } from "../config";
import { runWorkerLoop } from "../loop";
import { FONTS, fontLicenseFile } from "../scenes";
import { BUILD_SIGNATURE } from "../build-info";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const ENV = { RENDER_API_URL: "https://app.example.test/", RENDER_WORKER_SECRET: "0123456789abcdef0123456789abcdef" };
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("modo pausado", () => {
  it("vem desligado por padrão e liga com valores explícitos", () => {
    Object.assign(process.env, ENV);
    delete process.env.WORKER_PAUSED;
    expect(loadConfig().paused).toBe(false);
    for (const on of ["true", "TRUE", "1", "yes", " on ", '"true"', "'True'"]) {
      process.env.WORKER_PAUSED = on;
      expect(loadConfig()).toMatchObject({ paused: true, pausedReason: "requested" });
    }
    for (const off of ["false", "FALSE", "0", "no", "off", "", "  ", '"false"']) {
      process.env.WORKER_PAUSED = off;
      expect(loadConfig()).toMatchObject({ paused: false, pausedReason: null });
    }
  });

  it("falha fechado: valor digitado errado mantém pausado, nunca libera a fila", () => {
    for (const typo of ["ture", "sim", "pausado", "tru", "enabled", "2", "não", "true;"]) {
      expect(parsePaused(typo)).toEqual({ paused: true, pausedReason: "unrecognized_value" });
    }
  });

  const cfgWith = (over: Partial<WorkerConfig>): WorkerConfig => ({
    renderApiUrl: "https://app.example.test",
    renderWorkerSecret: ENV.RENDER_WORKER_SECRET,
    workerId: "test",
    pollIntervalMs: 5,
    ffmpegTimeoutMs: 1000,
    tmpDir: "/tmp/x",
    logLevel: "error",
    httpTimeoutMs: 1000,
    paused: false,
    pausedReason: null,
    ...over,
  });
  /** Roda o laço real por `ticks` voltas e conta as chamadas à ponte. */
  async function runTicks(cfg: WorkerConfig, ticks: number, claimResult: unknown = null) {
    let slept = 0;
    const claimJob = vi.fn(async () => claimResult as never);
    const processClaim = vi.fn(async () => {});
    await runWorkerLoop(cfg, {
      claimJob,
      processClaim,
      sleep: async () => {
        slept += 1;
      },
      isStopping: () => slept >= ticks,
    });
    return { claimJob, processClaim };
  }

  it("pausado: NENHUM claim desde a primeira volta, por mais que o laço rode", async () => {
    const { claimJob, processClaim } = await runTicks(cfgWith({ paused: true, pausedReason: "requested" }), 500);
    expect(claimJob).not.toHaveBeenCalled();
    expect(processClaim).not.toHaveBeenCalled();
  });

  it("pausado continua pausado a cada reinício (config relida do ambiente)", async () => {
    Object.assign(process.env, ENV, { WORKER_PAUSED: "true" });
    for (let restart = 0; restart < 3; restart++) {
      const { claimJob } = await runTicks(loadConfig(), 50);
      expect(claimJob).not.toHaveBeenCalled();
    }
  });

  it("controle: sem pausa o mesmo laço pede job (o teste acima detectaria um claim)", async () => {
    const { claimJob, processClaim } = await runTicks(cfgWith({}), 3);
    expect(claimJob).toHaveBeenCalledTimes(3);
    expect(processClaim).not.toHaveBeenCalled();
  });

  it("só existe um ponto de claim no worker, e ele fica depois da checagem de pausa", () => {
    const sources = ["index.ts", "loop.ts", "render.ts", "brand-composer.ts", "ffmpeg.ts", "selfcheck.ts"].map((f) => [f, read(`src/${f}`)] as const);
    const callers = sources.filter(([, text]) => /\bclaimJob\(/.test(text)).map(([f]) => f);
    expect(callers).toEqual(["loop.ts"]);
    const loop = read("src/loop.ts");
    expect(loop.indexOf("if (cfg.paused) {")).toBeGreaterThan(-1);
    expect(loop.indexOf("if (cfg.paused) {")).toBeLessThan(loop.indexOf("deps.claimJob(cfg)"));
    // O index não tem laço próprio: delega tudo ao runWorkerLoop.
    expect(read("src/index.ts")).not.toContain("while (");
  });
});

describe("licenças das fontes", () => {
  it("toda fonte empacotada tem a licença OFL 1.1 junto, no worker e no app", () => {
    const repo = path.resolve(root, "..", "..");
    for (const font of Object.values(FONTS)) {
      const license = fontLicenseFile(font.file);
      for (const dir of [path.join(root, "assets/fonts"), path.join(repo, "public/fonts/video")]) {
        expect(existsSync(path.join(dir, font.file))).toBe(true);
        const text = readFileSync(path.join(dir, "licenses", license), "utf8");
        expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
        expect(text).toMatch(/^Copyright/);
      }
    }
    // Nenhum .ttf sem dono: tudo que está na pasta pertence ao registro.
    const registered = new Set(Object.values(FONTS).map((f) => f.file));
    for (const file of readdirSync(path.join(root, "assets/fonts"))) {
      if (file.endsWith(".ttf")) expect(registered.has(file)).toBe(true);
    }
  });
});

describe("imagem Docker", () => {
  const dockerfile = read("Dockerfile");

  it("REGRESSÃO: a verificação lê a assinatura do próprio build, sem versão fixa que envelhece", () => {
    expect(dockerfile).toContain("import('/app/dist/build-info.js')");
    expect(dockerfile).toContain('for s in "$SIG" ');
    // Nenhuma assinatura de build escrita à mão na lista de verificação.
    const verification = dockerfile.slice(dockerfile.indexOf("IMAGE VERIFICATION"));
    expect(verification).not.toMatch(/render-[a-z-]+-build-\d+/);
    expect(BUILD_SIGNATURE).toMatch(/^render-[a-z-]+-build-\d+$/);
  });

  it("empacota as fontes e prova no build que todas as cenas rasterizam", () => {
    expect(dockerfile).toContain("COPY assets ./assets");
    expect(dockerfile).toContain("node /app/dist/selfcheck.js");
    // O rasterizador é dependência de produção (a imagem instala com --omit=dev).
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@resvg/resvg-js"]).toBeTruthy();
  });

  it("o contexto de build é a pasta do worker: Dockerfile e railway.json na raiz dela", () => {
    const railway = JSON.parse(read("railway.json")) as { build: { builder: string; dockerfilePath: string } };
    expect(railway.build).toEqual({ builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
    // Nada do que a imagem precisa pode estar ignorado no envio.
    const ignored = read(".dockerignore").split(/\r?\n/).map((l) => l.trim());
    for (const needed of ["src", "assets", "package.json", "tsconfig.json"]) expect(ignored).not.toContain(needed);
  });
});
