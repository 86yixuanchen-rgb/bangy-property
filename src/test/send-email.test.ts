// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/gmail.functions", () => ({ sendEmail: send }));

beforeEach(() => {
  vi.resetModules();
  send.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
const data = {
  to: "trade@example.test",
  subject: "Repair",
  body: "Please attend",
  requestId: null,
};

describe("Email retry identity", () => {
  it("keeps the operation identity after a lost response, including after reloading the module", async () => {
    send.mockRejectedValueOnce(new Error("Network lost")).mockResolvedValue({ ok: true });
    const first = await import("@/lib/send-email");
    expect(await first.sendEmail({ data })).toEqual({ ok: false, code: "UNCERTAIN" });
    vi.resetModules();
    const reloaded = await import("@/lib/send-email");
    await reloaded.sendEmail({ data });
    expect(send.mock.calls[0]![0].data.operationId).toBe(send.mock.calls[1]![0].data.operationId);
  });
  it("preserves the identity for rejected sends and starts a new operation after confirmed success", async () => {
    send.mockResolvedValueOnce({ ok: false, code: "RECONNECT" }).mockResolvedValue({ ok: true });
    const { sendEmail } = await import("@/lib/send-email");
    await sendEmail({ data });
    await sendEmail({ data });
    await sendEmail({ data });
    expect(send.mock.calls[0]![0].data.operationId).toBe(send.mock.calls[1]![0].data.operationId);
    expect(send.mock.calls[2]![0].data.operationId).not.toBe(
      send.mock.calls[1]![0].data.operationId,
    );
  });
});
