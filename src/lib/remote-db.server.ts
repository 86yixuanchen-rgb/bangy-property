import {
  drizzle,
  type AsyncBatchRemoteCallback,
  type AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy";
import * as schema from "@/db/schema";
import { signGatewayRequest, type GatewayRequest } from "./db-gateway-protocol";

export function createRemoteDb(url: string, secret: string, transport: typeof fetch = fetch) {
  if (!url.startsWith("https://")) throw new Error("Database gateway requires HTTPS");
  async function call(input: GatewayRequest) {
    const body = JSON.stringify(input);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const response = await transport(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        "x-banjg-time": timestamp,
        "x-banjg-nonce": nonce,
        "x-banjg-signature": await signGatewayRequest(secret, timestamp, nonce, body),
      },
      body,
    });
    if (!response.ok) throw new Error(`Database gateway failed (${response.status})`);
    const result = (await response.json()) as { results: { rows: unknown[] }[] };
    if (result.results?.length !== input.queries.length)
      throw new Error("Invalid database gateway response");
    return result.results;
  }
  const query: AsyncRemoteCallback = async (sql, params, method) =>
    (await call({ queries: [{ sql, params, method }], batch: false }))[0]!;
  const batch: AsyncBatchRemoteCallback = async (queries) => call({ queries, batch: true });
  return drizzle(query, batch, { schema });
}
