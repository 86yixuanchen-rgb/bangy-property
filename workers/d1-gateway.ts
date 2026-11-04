import type { AnyD1Database } from "drizzle-orm/d1";
import { gatewayRequest, verifyGatewayRequest } from "../src/lib/db-gateway-protocol";

type Env = { DB: AnyD1Database; DB_GATEWAY_KEY: string };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function handleGateway(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname !== "/query") return json({ error: "Not found" }, 404);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.DB_GATEWAY_KEY || !env.DB) return json({ error: "Unavailable" }, 503);
  // Read a bounded body before verifying the signature. No SQL, parameters or credentials are logged.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Invalid request" }, 400);
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 1_000_000) {
      await reader.cancel();
      return json({ error: "Request too large" }, 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const body = new TextDecoder().decode(bytes);
  if (!(await verifyGatewayRequest(env.DB_GATEWAY_KEY, request.headers, body)))
    return json({ error: "Unauthorized" }, 401);
  let input;
  try {
    input = gatewayRequest.parse(JSON.parse(body));
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!input.batch && input.queries.length !== 1) return json({ error: "Invalid request" }, 400);
  try {
    const statements = input.queries.map((q) => env.DB.prepare(q.sql).bind(...q.params));
    if (input.batch) {
      const results: { results: Record<string, unknown>[] }[] = await env.DB.batch(statements);
      return json({
        results: results.map((result, i) => ({
          rows:
            input.queries[i]!.method === "run" ? [] : result.results.map((r) => Object.values(r)),
        })),
      });
    }
    const q = input.queries[0]!;
    if (q.method === "run") {
      await statements[0]!.run();
      return json({ results: [{ rows: [] }] });
    }
    const rows = await statements[0]!.raw();
    return json({ results: [{ rows: q.method === "get" ? (rows[0] ?? []) : rows }] });
  } catch {
    // In particular, never repeat a timed-out write or split an atomic batch.
    return json({ error: "Database operation failed" }, 502);
  }
}
export default { fetch: handleGateway };
