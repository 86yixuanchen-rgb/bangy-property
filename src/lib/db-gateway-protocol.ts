import { z } from "zod";

export const gatewayRequest = z
  .object({
    queries: z
      .array(
        z
          .object({
            sql: z
              .string()
              .min(1)
              .max(100_000)
              .refine((s) => /^\s*(select|insert|update|delete)\b/i.test(s)),
            params: z.array(z.union([z.string(), z.number().finite(), z.null()])).max(200),
            method: z.enum(["run", "all", "values", "get"]),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    batch: z.boolean(),
  })
  .strict();
export type GatewayRequest = z.infer<typeof gatewayRequest>;
const encode = new TextEncoder();
async function key(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encode.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signGatewayRequest(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    encode.encode(`${timestamp}.${nonce}.${body}`),
  );
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyGatewayRequest(
  secret: string,
  headers: Headers,
  body: string,
  now = Date.now(),
) {
  const timestamp = headers.get("x-banjg-time") ?? "";
  const nonce = headers.get("x-banjg-nonce") ?? "";
  const signature = headers.get("x-banjg-signature") ?? "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 60_000 ||
    !/^[0-9a-f-]{36}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return false;
  return crypto.subtle.verify(
    "HMAC",
    await key(secret),
    Uint8Array.from(signature.match(/../g)!, (v) => parseInt(v, 16)),
    encode.encode(`${timestamp}.${nonce}.${body}`),
  );
}
