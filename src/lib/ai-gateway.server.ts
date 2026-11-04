import { z } from "zod";
import { signGatewayRequest, verifyGatewayRequest } from "./db-gateway-protocol";

export function aiConfigured() {
  return Boolean(
    process.env["DEEPSEEK_API_KEY"] ||
    (process.env["AI_GATEWAY_URL"] && process.env["DB_GATEWAY_KEY"]),
  );
}
export async function fetchDeepSeek(init: RequestInit) {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (apiKey)
    return fetch(process.env["DEEPSEEK_API_URL"] ?? "https://api.deepseek.com/chat/completions", {
      ...init,
      signal: AbortSignal.timeout(40000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    });
  const url = process.env["AI_GATEWAY_URL"];
  const secret = process.env["DB_GATEWAY_KEY"];
  if (!url?.startsWith("https://") || !secret) throw new Error("AI is not configured");
  const body = String(init.body ?? "");
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  return fetch(url, {
    method: "POST",
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(45000),
    headers: {
      "Content-Type": "application/json",
      "x-banjg-time": timestamp,
      "x-banjg-nonce": nonce,
      "x-banjg-signature": await signGatewayRequest(secret, timestamp, nonce, body),
    },
  });
}
const aiInput = z
  .object({
    model: z.literal("deepseek-chat"),
    temperature: z.number().min(0).max(1),
    max_tokens: z.number().int().positive().max(1600),
    response_format: z.object({ type: z.literal("json_object") }).strict(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string().max(200_000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export async function handleAiGateway(request: Request) {
  const denied = (status: number) =>
    Response.json(
      { error: "AI gateway request rejected" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  const secret = process.env["DB_GATEWAY_KEY"];
  if (!secret || !process.env["DEEPSEEK_API_KEY"]) return denied(503);
  if (request.method !== "POST") return denied(405);
  const reader = request.body?.getReader();
  if (!reader) return denied(400);
  const decoder = new TextDecoder();
  let body = "",
    length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 250_000) {
      await reader.cancel();
      return denied(413);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  if (!(await verifyGatewayRequest(secret, request.headers, body))) return denied(401);
  let input;
  try {
    input = aiInput.parse(JSON.parse(body));
  } catch {
    return denied(400);
  }
  try {
    const upstream = await fetchDeepSeek({ method: "POST", body: JSON.stringify(input) });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return denied(502);
  }
}
