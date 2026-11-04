import { sql } from "drizzle-orm";
import { verifyGatewayRequest } from "./db-gateway-protocol";
import { createRemoteDb } from "./remote-db.server";

export async function handleBridgeStatus(request: Request) {
  const secret = process.env["DB_GATEWAY_KEY"];
  const timestamp = request.headers.get("x-banjg-time");
  // Status requests have an empty body, never return business data, and require the same signature.
  if (
    request.method !== "POST" ||
    !secret ||
    !timestamp ||
    !(await verifyGatewayRequest(secret, request.headers, ""))
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env["DB_GATEWAY_URL"];
  if (!url) return Response.json({ mode: "direct" });
  try {
    const db = createRemoteDb(url, secret);
    const rows = await db.all(sql`SELECT 1`);
    if (rows.length !== 1) throw new Error("Invalid result");
    return Response.json(
      {
        database: "ok",
        mode: "shared",
        aiBridge: Boolean(process.env["AI_GATEWAY_URL"]),
        gmailConfigured: Boolean(
          process.env["GOOGLE_CLIENT_ID"] &&
          process.env["GOOGLE_CLIENT_SECRET"] &&
          process.env["TOKEN_ENCRYPTION_KEY"],
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // This authenticated probe only runs SELECT 1: diagnostics cannot contain business records.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return Response.json(
      {
        database: "unavailable",
        diagnostic: cause instanceof Error ? cause.message : "Unknown database error",
      },
      { status: 503 },
    );
  }
}
