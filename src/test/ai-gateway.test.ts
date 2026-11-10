// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAiGateway, fetchDeepSeek } from "@/lib/ai-gateway.server";
import { signGatewayRequest } from "@/lib/db-gateway-protocol";
const secret = "test-private-bridge-key";
const payload = {
  model: "deepseek-flash",
  thinking: { type: "disabled" },
  temperature: 0.2,
  max_tokens: 100,
  response_format: { type: "json_object" },
  messages: [{ role: "user", content: "Reply OK" }],
};
beforeEach(() => {
  vi.stubEnv("DB_GATEWAY_KEY", secret);
  vi.stubEnv("DEEPSEEK_API_KEY", "test-upstream-only-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ choices: [{ message: { content: "OK" } }] })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function signed(data: unknown) {
  const body = JSON.stringify(data),
    timestamp = String(Date.now()),
    nonce = crypto.randomUUID();
  return new Request("https://original.test/_internal/ai", {
    method: "POST",
    body,
    headers: {
      "x-banjg-time": timestamp,
      "x-banjg-nonce": nonce,
      "x-banjg-signature": await signGatewayRequest(secret, timestamp, nonce, body),
    },
  });
}
describe("AI bridge", () => {
  it("rejects unauthenticated requests before calling the paid provider", async () => {
    expect(
      (
        await handleAiGateway(
          new Request("https://original.test/_internal/ai", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
        )
      ).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the original server's key and never returns it", async () => {
    const response = await handleAiGateway(await signed(payload));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("test-upstream-only-key");
    const request = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toEqual(payload);
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-upstream-only-key" });
  });
  it("rejects the retired model before calling the provider", async () => {
    expect((await handleAiGateway(await signed({ ...payload, model: "deepseek-chat" }))).status).toBe(
      400,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects oversized token limits", async () => {
    expect((await handleAiGateway(await signed({ ...payload, max_tokens: 100000 }))).status).toBe(
      400,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("signs remote requests without attaching a provider credential", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_URL", "https://original.test/_internal/ai");
    await fetchDeepSeek({ method: "POST", body: JSON.stringify(payload) });
    const headers = vi.mocked(fetch).mock.calls[0]![1]!.headers;
    expect(headers).toHaveProperty("x-banjg-signature");
    expect(headers).not.toHaveProperty("Authorization");
    expect(vi.mocked(fetch).mock.calls[0]![1]!.redirect).toBe("manual");
  });
});
