// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";

let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/lib/db.server", () => ({ getDb: async () => db }));

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hoursAgo = (n: number) => String(Date.now() - n * 3600 * 1000);
const msg = (
  id: string,
  from: string,
  to: string,
  subject: string,
  body: string,
  at: string,
  labels: string[],
) => ({
  id,
  threadId: `thread-${id}`,
  snippet: body.slice(0, 80),
  internalDate: at,
  labelIds: labels,
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Subject", value: subject },
    ],
    body: { data: b64u(body) },
  },
});

const mailbox = [
  msg(
    "m1",
    "Mia Russo <Mia.Russo@tenant.test>",
    "pm@agency.test",
    "Leaking tap",
    "Tap is dripping",
    hoursAgo(72),
    ["INBOX"],
  ),
  msg(
    "m2",
    "Sarah <pm@agency.test>",
    "Inner West Plumbing <jobs@iwp.test>",
    "Quote request",
    "Can you quote?",
    hoursAgo(48),
    ["SENT"],
  ),
  msg(
    "m3",
    "Inner West Plumbing <jobs@iwp.test>",
    "pm@agency.test",
    "Re: Quote request",
    "$320 incl GST",
    hoursAgo(24),
    ["INBOX"],
  ),
  msg(
    "m4",
    "David Chen <david@owner.test>",
    "pm@agency.test",
    "Re: Tap",
    "Please go ahead",
    hoursAgo(3),
    ["INBOX", "UNREAD"],
  ),
  msg(
    "m5",
    "Council <noreply@council.test>",
    "pm@agency.test",
    "Rates notice",
    "Your notice is ready",
    hoursAgo(30),
    ["INBOX"],
  ),
];

const sentBodies: { raw: string; threadId?: string }[] = [];
let sendStatus = 200;

beforeAll(async () => {
  process.env["GOOGLE_CLIENT_ID"] = "cid";
  process.env["GOOGLE_CLIENT_SECRET"] = "secret";
  process.env["TOKEN_ENCRYPTION_KEY"] = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64");
  process.env["GOOGLE_TOKEN_URL"] = "https://google.test/token";
  process.env["GOOGLE_USERINFO_URL"] = "https://google.test/userinfo";
  process.env["GMAIL_API_BASE"] = "https://gmail.test";

  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ DB: import("drizzle-orm/d1").AnyD1Database }>({
    persist: { path: mkdtempSync(join(tmpdir(), "banjg-d1-")) },
  });
  afterAll(() => proxy.dispose());
  const raw = proxy.env.DB as unknown as { prepare(q: string): { run(): Promise<unknown> } };
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const stmt of readFileSync(join("drizzle", file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (stmt.trim()) await raw.prepare(stmt).run();
    }
  }
  db = drizzle(proxy.env.DB, { schema });
});

beforeEach(() => {
  sentBodies.length = 0;
  sendStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (o: unknown, status = 200) =>
        new Response(JSON.stringify(o), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url === "https://google.test/token") {
        const grant = new URLSearchParams(String(init?.body)).get("grant_type");
        return json(
          grant === "authorization_code"
            ? { access_token: "at", refresh_token: "rt-secret" }
            : { access_token: "at2" },
        );
      }
      if (url === "https://google.test/userinfo") return json({ email: "PM@agency.test" });
      if (url.startsWith("https://gmail.test/gmail/v1/users/me/messages?")) {
        expect(decodeURIComponent(url)).toContain("in:sent");
        return json({ messages: mailbox.map((m) => ({ id: m.id })) });
      }
      if (url.endsWith("/messages/send")) {
        sentBodies.push(JSON.parse(String(init?.body)));
        return sendStatus === 200
          ? json({ id: "sent-1", threadId: "thread-m1" })
          : json({}, sendStatus);
      }
      if (/\/messages\/m1\/(trash|untrash)$/.test(url)) {
        return json({ labelIds: url.endsWith("/untrash") ? ["INBOX"] : ["TRASH"] });
      }
      const m = /messages\/([^?]+)\?format=full/.exec(url);
      const found = mailbox.find((x) => x.id === m?.[1]);
      return found ? json(found) : json({}, 404);
    }),
  );
});

const USER = "user_test";

async function seedRequest() {
  await db
    .insert(schema.repairRequests)
    .values({
      userId: USER,
      id: "REQ-1",
      title: "Leaking tap",
      address: "3/22 Oxford St",
      priority: "High",
      boardColumn: "New",
      status: "Awaiting triage",
      waitingOn: "Property Manager",
      nextAction: "Triage",
      waiting: "1 day",
      lastUpdate: "Today",
      sortOrder: 1,
    })
    .onConflictDoNothing();
  await db
    .insert(schema.requestParticipants)
    .values([
      {
        userId: USER,
        requestId: "REQ-1",
        role: "Tenant",
        name: "Mia Russo",
        email: "mia.russo@tenant.test",
      },
      {
        userId: USER,
        requestId: "REQ-1",
        role: "Repair Team",
        name: "Inner West Plumbing",
        email: "jobs@iwp.test",
      },
      {
        userId: USER,
        requestId: "REQ-1",
        role: "Landlord",
        name: "David Chen",
        email: "david@owner.test",
      },
    ])
    .onConflictDoNothing();
}

describe("Gmail sync, linking and sending", () => {
  it("connects, stores the refresh token encrypted, syncs inbox and sent mail, and links by participant", async () => {
    const gmail = await import("@/lib/gmail.server");
    await seedRequest();
    await gmail.connectAccount(USER, "code", "https://app.test");

    const [account] = await db
      .select()
      .from(schema.gmailAccounts)
      .where(eq(schema.gmailAccounts.userId, USER));
    expect(account?.email).toBe("PM@agency.test");
    expect(account?.refreshToken).not.toContain("rt-secret");

    expect(await gmail.syncInbox(USER, "https://app.test")).toBe(5);
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, USER));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId["m1"]?.requestId).toBe("REQ-1"); // tenant, mixed-case address
    expect(byId["m2"]?.requestId).toBe("REQ-1"); // sent to repair team
    expect(byId["m3"]?.requestId).toBe("REQ-1"); // from repair team
    expect(byId["m4"]?.requestId).toBe("REQ-1"); // from landlord
    expect(byId["m5"]?.requestId).toBeNull(); // unknown sender stays unlinked
    expect(byId["m1"]?.fromEmail).toBe("mia.russo@tenant.test");
    expect(byId["m2"]?.toEmails).toBe("jobs@iwp.test");
    expect(byId["m4"]?.unread).toBe(true);
    expect(byId["m1"]?.body).toBe("Tap is dripping");
  });

  it("moves mail to Gmail trash and restores it without losing request links", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.moveMail(USER, "https://app.test", "m1", true);
    const read = async () =>
      (
        await db
          .select()
          .from(schema.emailMessages)
          .where(and(eq(schema.emailMessages.userId, USER), eq(schema.emailMessages.id, "m1")))
      )[0];
    expect((await read())?.trashed).toBe(true);
    expect((await read())?.requestId).toBe("REQ-1");
    await gmail.moveMail(USER, "https://app.test", "m1", false);
    expect((await read())?.trashed).toBe(false);
    expect((await read())?.inInbox).toBe(true);
  });

  it("does not link emails to a request when the sender is not a participant", async () => {
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(and(eq(schema.emailMessages.userId, USER), eq(schema.emailMessages.id, "m5")));
    expect(rows[0]?.requestId).toBeNull();
  });

  it("sends a UTF-8 email in the right thread and records it against the request", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.sendMail(USER, "https://app.test", {
      to: "mia.russo@tenant.test\r\nBcc: attacker@evil.test",
      subject: "Plumber booked ✔ Thursday",
      body: "Hi Mia,\nThe plumber attends Thursday 5:30pm.\n— Sarah",
      requestId: "REQ-1",
      threadId: "thread-m1",
    });
    const payload = sentBodies[0]!;
    expect(payload.threadId).toBe("thread-m1");
    const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(mime).toContain("To: mia.russo@tenant.test Bcc: attacker@evil.test"); // CRLF stripped, no header injection
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
    const body = mime.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toContain("— Sarah");

    const [stored] = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.id, "sent-1"));
    expect(stored?.requestId).toBe("REQ-1");
    expect(stored?.fromEmail).toBe("pm@agency.test");
  });

  it("asks the user to reconnect when Gmail rejects sending permission", async () => {
    const gmail = await import("@/lib/gmail.server");
    sendStatus = 403;
    await expect(
      gmail.sendMail(USER, "https://app.test", {
        to: "a@b.test",
        subject: "x",
        body: "y",
        requestId: null,
      }),
    ).rejects.toBeInstanceOf(gmail.ReconnectRequired);
  });
});

describe("Reliable operations", () => {
  const origin = "https://app.test";
  async function account(userId: string) {
    await db
      .insert(schema.gmailAccounts)
      .values({ userId, email: "pm@agency.test", refreshToken: "demo-account" })
      .onConflictDoNothing();
  }
  async function request(userId: string, id: string) {
    await db.insert(schema.repairRequests).values({
      userId,
      id,
      title: "Repair",
      address: "Test",
      priority: "High",
      boardColumn: "New",
      status: "New",
      waitingOn: "PM",
      nextAction: "Review",
      waiting: "",
      lastUpdate: "",
      sortOrder: 0,
    });
  }
  async function mail(
    userId: string,
    id: string,
    threadId = id,
    requestId: string | null = null,
    subject = "Repair",
  ) {
    await db.insert(schema.emailMessages).values({
      userId,
      id,
      threadId,
      requestId,
      subject,
      fromName: "Trade",
      fromEmail: "trade@example.test",
      toEmails: "pm@agency.test",
      body: "Repair update",
      snippet: "",
      receivedAt: Date.now(),
      unread: true,
    });
  }

  it("reserves distinct request numbers concurrently above existing records", async () => {
    const { createRequestRecord } = await import("@/lib/request-create.server");
    await request("numbers", "REQ-250");
    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        createRequestRecord(db, "numbers", { title: "New", address: "Test", priority: "High" }),
      ),
    );
    expect(new Set(created.map((r) => r.id)).size).toBe(8);
    expect(created.every((r) => Number(r.id.slice(4)) > 250)).toBe(true);
    const events = await db
      .select()
      .from(schema.requestEvents)
      .where(eq(schema.requestEvents.userId, "numbers"));
    expect(events).toHaveLength(8);
  });

  it("leaves shared contacts ambiguous but respects a unique thread or explicit request reference", async () => {
    const gmail = await import("@/lib/gmail.server");
    const userId = "ambiguous";
    await account(userId);
    for (const id of ["REQ-10", "REQ-20"]) {
      await request(userId, id);
      await db.insert(schema.requestParticipants).values({
        userId,
        requestId: id,
        role: "Repair Team",
        name: "Trade",
        email: "trade@example.test",
      });
    }
    await mail(userId, "ambiguous");
    await mail(userId, "anchor", "known-thread", "REQ-10");
    await mail(userId, "thread-reply", "known-thread");
    await mail(userId, "explicit", "explicit", null, "Update REQ-20");
    await mail(userId, "conflicting", "known-thread", null, "Update REQ-20");
    await gmail.autoLinkEmails(userId);
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, userId));
    const links = Object.fromEntries(rows.map((r) => [r.id, r.requestId]));
    expect(links).toMatchObject({
      ambiguous: null,
      "thread-reply": "REQ-10",
      explicit: "REQ-20",
      conflicting: null,
    });
  });

  it("can use an existing thread before any participants have been added", async () => {
    const gmail = await import("@/lib/gmail.server");
    await account("thread-only");
    await request("thread-only", "REQ-30");
    await mail("thread-only", "thread-anchor", "thread-without-people", "REQ-30");
    await mail("thread-only", "thread-child", "thread-without-people");
    await gmail.autoLinkEmails("thread-only");
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(
        and(
          eq(schema.emailMessages.userId, "thread-only"),
          eq(schema.emailMessages.id, "thread-child"),
        ),
      );
    expect(rows[0]?.requestId).toBe("REQ-30");
  });

  it("rejects a different mailbox without changing the account or its existing mail", async () => {
    const gmail = await import("@/lib/gmail.server");
    await db
      .insert(schema.gmailAccounts)
      .values({ userId: "switch", email: "old@agency.test", refreshToken: "original" });
    await mail("switch", "old-message");
    await expect(gmail.connectAccount("switch", "code", origin)).rejects.toBeInstanceOf(
      gmail.MailboxChangeRequired,
    );
    const [stored] = await db
      .select()
      .from(schema.gmailAccounts)
      .where(eq(schema.gmailAccounts.userId, "switch"));
    expect(stored?.email).toBe("old@agency.test");
    expect(stored?.refreshToken).toBe("original");
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, "switch"));
    expect(rows).toHaveLength(1);
  });

  it("preserves cached mail when reconnecting the same address", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.connectAccount("same-address", "code", origin);
    await mail("same-address", "preserved");
    await db
      .update(schema.gmailAccounts)
      .set({ lastSyncAt: 123 })
      .where(eq(schema.gmailAccounts.userId, "same-address"));
    await gmail.connectAccount("same-address", "code", origin);
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, "same-address"));
    expect(rows).toHaveLength(1);
    const [stored] = await db
      .select()
      .from(schema.gmailAccounts)
      .where(eq(schema.gmailAccounts.userId, "same-address"));
    expect(stored?.lastSyncAt).toBe(123);
  });

  it("permits retry of a definite Gmail rejection using the same operation", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.connectAccount("rejected-retry", "code", origin);
    const input = {
      to: "trade@example.test",
      subject: "Repair",
      body: "Attend",
      requestId: null,
      operationId: crypto.randomUUID(),
    };
    sendStatus = 403;
    await expect(gmail.sendMail("rejected-retry", origin, input)).rejects.toBeInstanceOf(
      gmail.ReconnectRequired,
    );
    sendStatus = 200;
    await gmail.sendMail("rejected-retry", origin, input);
    expect(sentBodies).toHaveLength(2);
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, "rejected-retry"));
    expect(rows).toHaveLength(1);
  });

  it("retries local persistence without sending the message twice", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.connectAccount("persist-retry", "code", origin);
    const input = {
      to: "trade@example.test",
      subject: "Repair",
      body: "Please attend",
      requestId: null,
      operationId: crypto.randomUUID(),
    };
    const spy = vi
      .spyOn(db, "all")
      .mockRejectedValueOnce(new Error("Database temporarily unavailable"));
    try {
      await expect(gmail.sendMail("persist-retry", origin, input)).rejects.toThrow(
        "Database temporarily unavailable",
      );
    } finally {
      spy.mockRestore();
    }
    await gmail.sendMail("persist-retry", origin, input);
    expect(sentBodies).toHaveLength(1);
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, "persist-retry"));
    expect(rows).toHaveLength(1);
    await expect(
      gmail.sendMail("persist-retry", origin, { ...input, body: "Changed" }),
    ).rejects.toThrow("does not match");
    expect(sentBodies).toHaveLength(1);
  });

  it("does not let an old sync write mail after the mailbox is disconnected", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.connectAccount("in-flight", "code", origin);
    const original = fetch;
    let disconnected = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (!disconnected && String(url).includes("?format=full")) {
          disconnected = true;
          await gmail.disconnectAccount("in-flight");
          await db
            .insert(schema.gmailAccounts)
            .values({ userId: "in-flight", email: "new@agency.test", refreshToken: "new-token" });
        }
        return original(url, init);
      }),
    );
    await expect(gmail.syncInbox("in-flight", origin)).rejects.toBeInstanceOf(
      gmail.ReconnectRequired,
    );
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, "in-flight"));
    expect(rows).toHaveLength(0);
  });

  it("does not resend an uncertain request and recovers it when Gmail confirms delivery", async () => {
    const gmail = await import("@/lib/gmail.server");
    await gmail.connectAccount("lost-response", "code", origin);
    const original = fetch;
    let sends = 0;
    let searchable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/messages/send")) {
          sends++;
          throw new Error("Connection lost after delivery");
        }
        if (String(url).includes("rfc822msgid"))
          return new Response(
            JSON.stringify({
              messages: searchable ? [{ id: "recovered", threadId: "recovered-thread" }] : [],
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        return original(url, init);
      }),
    );
    const input = {
      to: "trade@example.test",
      subject: "Repair",
      body: "Attend",
      requestId: null,
      operationId: crypto.randomUUID(),
    };
    await expect(gmail.sendMail("lost-response", origin, input)).rejects.toBeInstanceOf(
      gmail.SendUncertain,
    );
    await expect(gmail.sendMail("lost-response", origin, input)).rejects.toBeInstanceOf(
      gmail.SendUncertain,
    );
    searchable = true;
    await gmail.sendMail("lost-response", origin, input);
    expect(sends).toBe(1);
    const rows = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, "lost-response"));
    expect(rows[0]?.id).toBe("recovered");
  });
});

describe("Demo account", () => {
  const DEMO = "user_demoaccount1";

  it("seeds a complete, linked data set and can be re-seeded without duplicates", async () => {
    const seed = () =>
      execFileSync("node", ["scripts/seed-demo.mjs", DEMO], { encoding: "utf8" })
        .split(/;\n(?=INSERT|DELETE|--)/)
        .filter((stmt) => stmt.trim() && !stmt.trim().startsWith("--"));
    const run = async () => {
      const raw = (
        db as unknown as { $client: { prepare(q: string): { run(): Promise<unknown> } } }
      ).$client;
      for (const stmt of seed()) await raw.prepare(stmt.trim().replace(/;$/, "")).run();
    };
    await run();
    await run();

    const requests = await db
      .select()
      .from(schema.repairRequests)
      .where(eq(schema.repairRequests.userId, DEMO));
    expect(requests).toHaveLength(8);
    expect(new Set(requests.map((r) => r.boardColumn))).toEqual(
      new Set(["New", "Waiting", "Action Needed", "Scheduled", "Completed"]),
    );
    const mail = await db
      .select()
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.userId, DEMO));
    expect(mail.filter((m) => m.requestId === null)).toHaveLength(2);
    expect(
      mail.every((m) => !/@(gmail|outlook|yahoo|hotmail)\./.test(m.fromEmail + m.toEmails)),
    ).toBe(true);
  });

  it("syncs and sends without ever calling Google", async () => {
    const gmail = await import("@/lib/gmail.server");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    expect(await gmail.syncInbox(DEMO, "https://app.test")).toBeGreaterThan(20);
    await gmail.sendMail(DEMO, "https://app.test", {
      to: "david.chen@example.com",
      subject: "Reminder: air conditioning quote",
      body: "Hi David, just checking in on the $680 quote.",
      requestId: "REQ-101",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const [row] = await db
      .select()
      .from(schema.emailMessages)
      .where(
        and(
          eq(schema.emailMessages.userId, DEMO),
          eq(schema.emailMessages.subject, "Reminder: air conditioning quote"),
        ),
      );
    expect(row?.requestId).toBe("REQ-101");
    expect(row?.fromEmail).toBe("sarah.miller@harbourrealty.example");
    expect(row?.sent).toBe(true);
    expect(row?.inInbox).toBe(false);
    await gmail.moveMail(DEMO, "https://app.test", row!.id, true);
    const [trashed] = await db
      .select()
      .from(schema.emailMessages)
      .where(and(eq(schema.emailMessages.userId, DEMO), eq(schema.emailMessages.id, row!.id)));
    expect(trashed?.trashed).toBe(true);
    await gmail.moveMail(DEMO, "https://app.test", row!.id, false);
    const [restored] = await db
      .select()
      .from(schema.emailMessages)
      .where(and(eq(schema.emailMessages.userId, DEMO), eq(schema.emailMessages.id, row!.id)));
    expect(restored?.trashed).toBe(false);
    await expect(gmail.moveMail(USER, "https://app.test", row!.id, true)).rejects.toThrow(
      "Email not found",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
