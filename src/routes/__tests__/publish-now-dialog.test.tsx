// @vitest-environment jsdom
// "Publicar agora" com escolha de destino: Instagram, Facebook ou os dois,
// cada canal com envio e situação próprios.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/data/marketingRepo", () => ({ apiScheduleContent: vi.fn(), apiListPublishSchedule: vi.fn(async () => []) }));

import { PublishNowDialog, latestByChannel, publishToChannels, type PublishNowDeps } from "@/components/marketing/PublishNowDialog";
import type { MarketingContentRow, MarketingScheduleRow } from "@/lib/marketing/marketing.types";

const row = (channel = "instagram", format = "feed", extra: Record<string, unknown> = {}) =>
  ({ id: "content-1", channel, status: "approved", format, ...extra }) as unknown as MarketingContentRow;
const sched = (channel: string, status: string, at: string, content_id = "content-1") => ({ id: `${channel}-${at}`, content_id, channel, status, scheduled_at: at }) as unknown as MarketingScheduleRow;

function setup(options: { deps?: Partial<PublishNowDeps>; channel?: string; format?: string; extra?: Record<string, unknown>; blocked?: string | null } = {}) {
  const schedule = vi.fn(async (_input: { content_id: string; channel: string; publish_now: true }) => ({}));
  const deps: PublishNowDeps = { schedule, listSchedule: async () => [], ...options.deps };
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<PublishNowDialog row={row(options.channel, options.format, options.extra)} facebookBlockedReason={options.blocked} onClose={onClose} onDone={onDone} deps={deps} />);
  return { user: userEvent.setup(), schedule: deps.schedule as typeof schedule, onClose, onDone };
}
const box = (channel: string) => within(screen.getByTestId(`publish-channel-${channel}`));
const check = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

afterEach(cleanup);

describe("escolha do destino", () => {
  it("oferece Instagram e Facebook; começa pelo canal do conteúdo", () => {
    setup();
    expect(check("Instagram").checked).toBe(true);
    expect(check("Facebook").checked).toBe(false);
    cleanup();
    setup({ channel: "facebook" });
    expect(check("Instagram").checked).toBe(false);
    expect(check("Facebook").checked).toBe(true);
  });

  it("só Instagram: um único agendamento, para o Instagram", async () => {
    const { user, schedule, onClose, onDone } = setup();
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(schedule).toHaveBeenCalledTimes(1);
    // O horário NÃO sai do navegador: o pedido só diz "agora" e o servidor decide.
    expect(schedule.mock.calls[0][0]).toEqual({ content_id: "content-1", channel: "instagram", publish_now: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("só Facebook: um único agendamento, para o Facebook", async () => {
    const { user, schedule } = setup();
    await user.click(check("Instagram"));
    await user.click(check("Facebook"));
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(1));
    expect(schedule.mock.calls[0][0]).toMatchObject({ channel: "facebook" });
  });

  it("os dois: um agendamento por canal", async () => {
    const { user, schedule, onClose } = setup();
    await user.click(check("Facebook"));
    await user.click(screen.getByRole("button", { name: "Publicar nos dois" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(schedule.mock.calls.map((c) => c[0].channel)).toEqual(["instagram", "facebook"]);
  });

  it("REGRESSÃO: cliques repetidos no botão geram um único pedido por canal", async () => {
    let release = () => {};
    const schedule = vi.fn(() => new Promise<unknown>((done) => (release = () => done({}))));
    const { onClose } = setup({ deps: { schedule } });
    const button = screen.getByRole("button", { name: "Publicar" });
    // Três cliques antes de a tela redesenhar o botão desabilitado.
    button.click();
    button.click();
    button.click();
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("sem destino marcado não publica", async () => {
    const { user, schedule } = setup();
    await user.click(check("Instagram"));
    expect((screen.getByRole("button", { name: "Publicar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("Facebook sem permissão fica bloqueado, com o motivo", () => {
    setup({ channel: "facebook", blocked: "Permissão para publicar no Facebook não concedida." });
    expect(check("Facebook").disabled).toBe(true);
    expect(check("Facebook").checked).toBe(false);
    expect(box("facebook").getByText("Permissão para publicar no Facebook não concedida.")).toBeTruthy();
  });
});

describe("destinos compatíveis com o formato", () => {
  it("Feed, Story, Reel e Carrossel oferecem Instagram e Facebook", () => {
    for (const format of ["feed", "story", "carousel"]) {
      setup({ format });
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      cleanup();
    }
    // Reel: só com vídeo pronto.
    setup({ format: "reel", extra: { story_video_id: "video-1" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("REGRESSÃO: Reel sem vídeo (só o roteiro) não oferece destino, explica que falta o vídeo e não envia nada", () => {
    const { schedule } = setup({ format: "reel", extra: { media_ids: [], product_id: "prod-1", feed_video_id: null, story_video_id: null } });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("falta produzir o vídeo");
    const button = screen.getByRole("button", { name: "Publicar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("REGRESSÃO: conteúdo de WhatsApp não oferece nenhum destino, explica o motivo e não envia nada", async () => {
    const { schedule } = setup({ channel: "whatsapp", format: "whatsapp_cta" });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("mensagem para WhatsApp");
    const button = screen.getByRole("button", { name: "Publicar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("situação independente por canal", () => {
  it("a falha de um canal não impede o outro; cada um mostra o próprio resultado", async () => {
    const schedule = vi.fn(async (input: { channel: string }) => {
      if (input.channel === "instagram") throw new Error("A publicação automática de carrossel ainda não está liberada.");
      return {};
    });
    const { user, onClose, onDone } = setup({ deps: { schedule } });
    await user.click(check("Facebook"));
    await user.click(screen.getByRole("button", { name: "Publicar nos dois" }));
    await waitFor(() => expect(box("facebook").getByText(/Na fila de publicação/)).toBeTruthy());
    expect(box("instagram").getByRole("alert").textContent).toContain("ainda não está liberada");
    expect(schedule).toHaveBeenCalledTimes(2);
    // Fica aberto para mostrar o erro; o canal que deu certo já foi avisado.
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);

    // Tentar de novo só reenvia o canal que falhou: o que entrou na fila não duplica.
    expect(check("Facebook").disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Publicar" }));
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(3));
    expect(schedule.mock.calls[2][0].channel).toBe("instagram");
  });

  it("mostra o último envio de cada canal para este conteúdo", async () => {
    setup({
      deps: {
        listSchedule: async () => [
          sched("instagram", "published", "2026-10-09T10:00:00.000Z"),
          sched("instagram", "failed", "2026-10-08T10:00:00.000Z"),
          sched("facebook", "failed", "2026-10-09T11:00:00.000Z"),
          sched("facebook", "published", "2026-10-09T12:00:00.000Z", "outro-conteudo"),
        ],
      },
    });
    await waitFor(() => expect(box("instagram").getByText(/Último envio: publicado/)).toBeTruthy());
    expect(box("facebook").getByText(/Último envio: falhou/)).toBeTruthy();
  });

  it("latestByChannel ignora outros conteúdos e canais que não publicam", () => {
    const out = latestByChannel([sched("whatsapp", "planned", "2026-10-09T10:00:00.000Z"), sched("instagram", "queued", "2026-10-09T10:00:00.000Z", "x")], "content-1");
    expect(out).toEqual({});
  });

  it("publishToChannels devolve um resultado por canal, na ordem pedida", async () => {
    const seen: string[] = [];
    const out = await publishToChannels(
      "c",
      ["instagram", "facebook"],
      async ({ channel }) => {
        seen.push(channel);
        if (channel === "facebook") throw new Error("sem permissão");
      },
    );
    expect(seen).toEqual(["instagram", "facebook"]);
    expect(out).toEqual({ instagram: { state: "queued" }, facebook: { state: "error", message: "sem permissão" } });
  });
});

describe("ligação na tela de Publicar", () => {
  it("o botão abre o diálogo em vez de enviar direto para o canal do conteúdo", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/marketing/MarketingApprovals.tsx"), "utf8");
    const fn = source.slice(source.indexOf("function publishNow("), source.indexOf("async function retryRender("));
    expect(fn).toContain("setPublishFor(row)");
    expect(fn).not.toContain("apiScheduleContent");
    expect(source).toContain("<PublishNowDialog");
    expect(source).toContain("facebookBlockedReason={fbReadiness && !fbReadiness.ok ? fbReadiness.message : null}");
  });
});
