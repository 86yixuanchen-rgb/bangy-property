import { getRequest } from "@tanstack/react-start/server";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "@/db/schema";

type CloudflareRequest = Request & {
  runtime?: { cloudflare?: { env?: { DB?: AnyD1Database } } };
};

let devBinding: Promise<AnyD1Database> | undefined;

// `vite dev` does not run Nitro's Cloudflare emulation, so open the same local D1
// state that `wrangler d1 migrations apply DB --local` writes to.
function getDevBinding(): Promise<AnyD1Database> {
  devBinding ??= import("wrangler").then(async ({ getPlatformProxy }) => {
    const proxy = await getPlatformProxy<{ DB: AnyD1Database }>();
    return proxy.env.DB;
  });
  return devBinding;
}

// Both transports expose the same query API; normalize the unused low-level run result
// so TypeScript retains generic selected-field overloads across the two drivers.
export type AppDatabase = BaseSQLiteDatabase<"async", unknown, typeof schema> &
  Pick<SqliteRemoteDatabase<typeof schema>, "batch">;

export async function getDb(): Promise<AppDatabase> {
  let binding = (getRequest() as CloudflareRequest).runtime?.cloudflare?.env?.DB;
  if (!binding && process.env["DB_GATEWAY_URL"] && process.env["DB_GATEWAY_KEY"]) {
    const { createRemoteDb } = await import("./remote-db.server");
    return createRemoteDb(process.env["DB_GATEWAY_URL"]!, process.env["DB_GATEWAY_KEY"]!);
  }
  if (!binding && import.meta.env.DEV) binding = await getDevBinding();
  if (!binding) throw new Error("D1 binding `DB` is not available in this environment.");
  return drizzle(binding, { schema });
}
