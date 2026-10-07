import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mock.rpc, auth: { getUser: mock.getUser } }),
}));
import { authorizeTeamRequest } from "../team/api-access.server";
import { readTeamAccess } from "../team/access";
import { DEFAULT_ATTENDANT } from "../team/permissions";
const access = { role: "atendente", active: true, permissions: DEFAULT_ATTENDANT };
function request(path: string, body: unknown = { conversationId: "conversation-a" }) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer verified-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "team_my_access" ? access : true,
    error: null,
  }));
});
describe("server permission enforcement", () => {
  it("leaves webhook authentication to existing public route handlers", async () => {
    expect(
      await authorizeTeamRequest(new Request("https://example.test/api/public/whatsapp/webhook")),
    ).toBeNull();
    expect(mock.getUser).not.toHaveBeenCalled();
  });
  it("rejects missing or invalid identity before any permission lookup", async () => {
    expect(
      (await authorizeTeamRequest(new Request("https://example.test/api/whatsapp/send")))?.status,
    ).toBe(401);
    mock.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } });
    expect((await authorizeTeamRequest(request("/api/whatsapp/send")))?.status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("blocks direct calls to administrative APIs", async () => {
    expect((await authorizeTeamRequest(request("/api/ai/sales-agent-master")))?.status).toBe(403);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("checks ownership and preserves the request body for the sending handler", async () => {
    const req = request("/api/whatsapp/send");
    expect(await authorizeTeamRequest(req)).toBeNull();
    expect(mock.rpc).toHaveBeenLastCalledWith("team_authorize_interaction", {
      _payload: { conversationId: "conversation-a" },
      _write: true,
    });
    expect(await req.json()).toEqual({ conversationId: "conversation-a" });
    mock.rpc.mockImplementation(async (name: string) => ({
      data: name === "team_my_access" ? access : false,
      error: null,
    }));
    expect((await authorizeTeamRequest(request("/api/whatsapp/send")))?.status).toBe(403);
  });
  it("checks multipart audio targets without consuming the uploaded file", async () => {
    const form = new FormData();
    form.set("conversationId", "conversation-a");
    form.set("audio", new Blob(["audio"], { type: "audio/ogg" }), "voice.ogg");
    const req = new Request("https://example.test/api/whatsapp/send-audio", {
      method: "POST",
      headers: { authorization: "Bearer verified-token" },
      body: form,
    });
    expect(await authorizeTeamRequest(req)).toBeNull();
    expect(mock.rpc).toHaveBeenLastCalledWith("team_authorize_interaction", {
      _payload: { conversationId: "conversation-a" },
      _write: true,
    });
    expect((await req.formData()).get("audio")).toBeInstanceOf(Blob);
  });
  it("does not fall back to admin on outages or revoked access", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    expect((await authorizeTeamRequest(request("/api/whatsapp/send")))?.status).toBe(503);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
});
describe("migration rollout", () => {
  it.each([true, false])(
    "allows only a verified existing admin before migration: %s",
    async (admin) => {
      mock.rpc
        .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing RPC" } })
        .mockResolvedValueOnce({ data: "company-a", error: null })
        .mockResolvedValueOnce({ data: admin, error: null });
      const result = await readTeamAccess({ rpc: mock.rpc }, "user-a");
      expect(result).toMatchObject({
        schemaReady: false,
        active: admin,
        role: admin ? "admin" : null,
      });
      expect(mock.rpc).toHaveBeenLastCalledWith("has_role", {
        _user_id: "user-a",
        _company_id: "company-a",
        _role: "admin",
      });
    },
  );
});
