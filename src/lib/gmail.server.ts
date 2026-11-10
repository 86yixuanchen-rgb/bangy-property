import { resolveAttachments, buildMailMime } from "./mail-attachments.server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  emailMessages,
  gmailAccounts,
  mailSendOperations,
  mailSendFiles,
  repairRequests,
  requestParticipants,
} from "@/db/schema";
import { getDb } from "./db.server";

export const GMAIL_SCOPES = "openid email https://www.googleapis.com/auth/gmail.modify";

// Endpoints can be redirected (for example to a local fake Google server in tests).
const GOOGLE_TOKEN_URL = () =>
  process.env["GOOGLE_TOKEN_URL"] ?? "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = () =>
  process.env["GOOGLE_USERINFO_URL"] ?? "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API = () => process.env["GMAIL_API_BASE"] ?? "https://gmail.googleapis.com";
export const GOOGLE_AUTH_URL = () =>
  process.env["GOOGLE_AUTH_URL"] ?? "https://accounts.google.com/o/oauth2/v2/auth";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function googleConfig(origin: string) {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${origin}/api/gmail/callback`,
  };
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function cryptoKey() {
  return crypto.subtle.importKey("raw", unb64(env("TOKEN_ENCRYPTION_KEY")), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptoKey(),
    new TextEncoder().encode(plain),
  );
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

async function decrypt(value: string) {
  const [iv, ct] = value.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv ?? "") },
    await cryptoKey(),
    unb64(ct ?? ""),
  );
  return new TextDecoder().decode(plain);
}

export async function connectAccount(userId: string, code: string, origin: string) {
  const cfg = googleConfig(origin);
  const res = await fetch(GOOGLE_TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const tokens = (await res.json()) as { access_token: string; refresh_token?: string };
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");

  const info = await fetch(GOOGLE_USERINFO_URL(), {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!info.ok) throw new Error(`Google userinfo failed (${info.status})`);
  const { email } = (await info.json()) as { email: string };

  const db = await getDb();
  const [previous] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  if (previous && previous.email.toLowerCase() !== email.toLowerCase()) {
    throw new MailboxChangeRequired(
      "Disconnect the current mailbox before connecting a different account",
    );
  }
  const refreshToken = await encrypt(tokens.refresh_token);
  const connected = await db
    .insert(gmailAccounts)
    .values({ userId, email, refreshToken })
    .onConflictDoUpdate({
      target: gmailAccounts.userId,
      set: { email, refreshToken },
      setWhere: sql`lower(${gmailAccounts.email}) = lower(${email})`,
    })
    .returning();
  if (!connected.length)
    throw new MailboxChangeRequired(
      "Disconnect the current mailbox before connecting a different account",
    );
}

export class ReconnectRequired extends Error {}
export class MailboxChangeRequired extends Error {}
export class SendUncertain extends Error {}

// The seeded demo account has no real mailbox: it never calls Google and never sends email.
export const DEMO_REFRESH_TOKEN = "demo-account";

async function accessToken(
  userId: string,
  origin: string,
  account: typeof gmailAccounts.$inferSelect,
) {
  if (!account) throw new ReconnectRequired("Gmail is not connected");
  const cfg = googleConfig(origin);
  const res = await fetch(GOOGLE_TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: await decrypt(account.refreshToken),
      grant_type: "refresh_token",
    }),
  });
  if (res.status === 400 || res.status === 401) {
    throw new ReconnectRequired("Google authorization expired");
  }
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type Part = {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: Part;
};

function decodeBase64Url(data: string) {
  const bytes = unb64(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(bytes);
}

function findPart(part: Part | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

function decodeEntities(s: string) {
  return s
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function parseMessage(userId: string, m: GmailMessage) {
  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const from = header("from");
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const fromEmail = (match?.[2] ?? from).trim();
  const fromName = (match?.[1] ?? "").trim() || fromEmail;
  const toEmails = (header("to").match(/[^\s<>,"]+@[^\s<>,"]+/g) ?? [])
    .map((e) => e.toLowerCase())
    .join(",");
  const text = findPart(m.payload, "text/plain");
  const html = findPart(m.payload, "text/html");
  const body = (text ?? (html ? htmlToText(html) : decodeEntities(m.snippet ?? ""))).slice(
    0,
    20000,
  );
  return {
    userId,
    id: m.id,
    threadId: m.threadId,
    fromName,
    fromEmail: fromEmail.toLowerCase(),
    toEmails,
    subject: header("subject") || "(no subject)",
    snippet: decodeEntities(m.snippet ?? "").slice(0, 300),
    body,
    receivedAt: Number(m.internalDate ?? Date.now()),
    unread: m.labelIds?.includes("UNREAD") ?? false,
    inInbox: m.labelIds?.includes("INBOX") ?? false,
    sent: m.labelIds?.includes("SENT") ?? false,
    trashed: m.labelIds?.includes("TRASH") ?? false,
  };
}

// The account predicate is evaluated in the same SQL statement as the write, so an
// old in-flight sync/send cannot insert mail after disconnecting or changing accounts.
async function storeMailboxMessage(
  db: Awaited<ReturnType<typeof getDb>>,
  account: typeof gmailAccounts.$inferSelect,
  row: typeof emailMessages.$inferInsert,
  labelsOnly: boolean,
) {
  const entries = Object.entries(row) as [keyof typeof row, unknown][];
  const columns = sql.join(
    entries.map(([key]) => sql.identifier(emailMessages[key].name)),
    sql`, `,
  );
  const values = sql.join(
    entries.map(([, value]) => sql`${value}`),
    sql`, `,
  );
  const update = labelsOnly
    ? sql`unread = excluded.unread, in_inbox = excluded.in_inbox, sent = excluded.sent, trashed = excluded.trashed`
    : sql`id = excluded.id`;
  const rows = await db.all<{ id: string }>(sql`INSERT INTO email_messages (${columns})
    SELECT ${values} WHERE EXISTS (SELECT 1 FROM gmail_accounts
      WHERE user_id = ${account.userId} AND email = ${account.email} AND refresh_token = ${account.refreshToken})
    ON CONFLICT(user_id, id) DO UPDATE SET ${update} RETURNING id`);
  if (!rows.length) throw new ReconnectRequired("Mailbox changed while the operation was running");
}

export async function syncInbox(userId: string, origin: string) {
  const db = await getDb();
  const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  if (!account) throw new ReconnectRequired("Gmail is not connected");
  if (account.refreshToken === DEMO_REFRESH_TOKEN) {
    const stored = await db.select().from(emailMessages).where(eq(emailMessages.userId, userId));
    await db
      .update(gmailAccounts)
      .set({ lastSyncAt: Date.now() })
      .where(
        and(eq(gmailAccounts.userId, userId), eq(gmailAccounts.refreshToken, account.refreshToken)),
      );
    await autoLinkEmails(userId);
    return stored.length;
  }
  const token = await accessToken(userId, origin, account);
  const headers = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    `${GMAIL_API()}/gmail/v1/users/me/messages?maxResults=100&includeSpamTrash=true&q=` +
      encodeURIComponent("(in:inbox OR in:sent OR in:trash) newer_than:30d"),
    { headers },
  );
  if (!list.ok) throw new Error(`Gmail list failed (${list.status})`);
  const ids = ((await list.json()) as { messages?: { id: string }[] }).messages ?? [];

  const messages = await Promise.all(
    ids.map(async ({ id }) => {
      const res = await fetch(`${GMAIL_API()}/gmail/v1/users/me/messages/${id}?format=full`, {
        headers,
      });
      return res.ok ? ((await res.json()) as GmailMessage) : null;
    }),
  );

  for (const m of messages) {
    if (!m) continue;
    await storeMailboxMessage(db, account, parseMessage(userId, m), true);
  }
  await db
    .update(gmailAccounts)
    .set({ lastSyncAt: Date.now() })
    .where(
      and(eq(gmailAccounts.userId, userId), eq(gmailAccounts.refreshToken, account.refreshToken)),
    );
  await autoLinkEmails(userId);
  return messages.filter(Boolean).length;
}

// Links unlinked emails to the request whose participant is the other party in the conversation.
export async function autoLinkEmails(userId: string) {
  const db = await getDb();
  const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  const own = account?.email.toLowerCase() ?? "";
  const people = await db
    .select()
    .from(requestParticipants)
    .where(eq(requestParticipants.userId, userId));
  const requests = await db
    .select({ id: repairRequests.id, column: repairRequests.boardColumn })
    .from(repairRequests)
    .where(eq(repairRequests.userId, userId))
    .orderBy(desc(repairRequests.sortOrder));
  const valid = new Set(requests.map((r) => r.id));
  const allMail = await db.select().from(emailMessages).where(eq(emailMessages.userId, userId));
  const threadLinks = new Map<string, Set<string>>();
  for (const mail of allMail) {
    if (mail.requestId && valid.has(mail.requestId)) {
      const links = threadLinks.get(mail.threadId) ?? new Set<string>();
      links.add(mail.requestId);
      threadLinks.set(mail.threadId, links);
    }
  }
  for (const mail of allMail.filter((m) => !m.requestId)) {
    const thread = threadLinks.get(mail.threadId);
    const explicitIds = [...`${mail.subject}\n${mail.body}`.matchAll(/\bREQ-\d+\b/g)].map(
      (m) => m[0],
    );
    if (explicitIds.some((id) => !valid.has(id))) continue;
    const addresses = [mail.fromEmail, ...mail.toEmails.split(",")]
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a && a !== own);
    const participants = new Set(
      people
        .filter((p) => addresses.includes(p.email.toLowerCase()))
        .map((p) => p.requestId)
        .filter((id) => valid.has(id)),
    );
    // Conflicting thread or explicit request references always require human review.
    const references = new Set([...(thread ?? []), ...explicitIds]);
    const candidates = references.size ? references : participants;
    if (candidates.size !== 1) continue;
    const [requestId] = candidates;
    await db
      .update(emailMessages)
      .set({ requestId })
      .where(
        and(
          eq(emailMessages.userId, userId),
          eq(emailMessages.id, mail.id),
          isNull(emailMessages.requestId),
        ),
      );
  }
}

export async function disconnectAccount(userId: string) {
  const db = await getDb();
  await db.batch([
    db.delete(emailMessages).where(eq(emailMessages.userId, userId)),
    db.delete(gmailAccounts).where(eq(gmailAccounts.userId, userId)),
  ]);
}

const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

export async function sendMail(
  userId: string,
  origin: string,
  input: {
    to: string;
    subject: string;
    body: string;
    requestId: string | null;
    threadId?: string;
    operationId?: string;
    reconcileOnly?: boolean;
    attachmentIds?: string[];
  },
) {
  const db = await getDb();
  const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  if (!account) throw new ReconnectRequired("Gmail is not connected");
  const demo = account.refreshToken === DEMO_REFRESH_TOKEN;
  const token = demo ? "" : await accessToken(userId, origin, account);

  if (input.requestId) {
    const [request] = await db
      .select({ id: repairRequests.id })
      .from(repairRequests)
      .where(and(eq(repairRequests.userId, userId), eq(repairRequests.id, input.requestId)));
    if (!request) throw new Error("Repair request not found");
  }

  const operationId = input.operationId ?? crypto.randomUUID();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])].sort();
  const payload = JSON.stringify({
    to: input.to,
    subject: input.subject,
    body: input.body,
    requestId: input.requestId,
    threadId: input.threadId ?? null,
    ...(attachmentIds.length ? { attachmentIds } : {}),
  });
  const condition = and(
    eq(mailSendOperations.userId, userId),
    eq(mailSendOperations.operationId, operationId),
  );
  const [priorOperation] = await db.select().from(mailSendOperations).where(condition);
  if (input.reconcileOnly && (!priorOperation || priorOperation.state === "failed"))
    throw new SendUncertain(
      "No pending delivery to reconcile. Review the draft before a new send attempt.",
    );
  const files = priorOperation
    ? []
    : await resolveAttachments(db, userId, input.requestId, attachmentIds);
  const [claimed] = await db.batch([
    db
      .insert(mailSendOperations)
      .values({
        userId,
        operationId,
        mailbox: account.email.toLowerCase(),
        payload,
        state: "sending",
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .returning(),
    ...files.map((f) =>
      db
        .insert(mailSendFiles)
        .select(
          sql`SELECT ${userId}, ${operationId}, ${f.id}, ${f.name}, ${f.mime}, ${f.content} WHERE EXISTS (SELECT 1 FROM mail_send_operations WHERE user_id=${userId} AND operation_id=${operationId} AND payload=${payload})`,
        )
        .onConflictDoNothing(),
    ),
  ]);
  let [operation] = await db.select().from(mailSendOperations).where(condition);
  if (
    !operation ||
    operation.payload !== payload ||
    operation.mailbox !== account.email.toLowerCase()
  )
    throw new Error("Send operation does not match this message or mailbox");
  if (!claimed.length && operation.state === "failed") {
    if (input.reconcileOnly)
      throw new SendUncertain("The send failed. Review the draft before retrying.");
    const retry = await db
      .update(mailSendOperations)
      .set({ state: "sending" })
      .where(and(condition, eq(mailSendOperations.state, "failed")))
      .returning();
    if (!retry.length) throw new SendUncertain("This email is already being processed");
    operation = retry[0]!;
  } else if (!claimed.length && operation.state === "sending") {
    // Search by our stable RFC Message-ID to recover a lost response without replaying the send.
    if (demo) throw new SendUncertain("This email is already being processed");
    let recovered: { id: string; threadId?: string } | undefined;
    try {
      const response = await fetch(
        `${GMAIL_API()}/gmail/v1/users/me/messages?q=` +
          encodeURIComponent(`in:sent rfc822msgid:banjg-${operationId}@mail.banjg.invalid`),
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (response.ok) {
        const result = (await response.json()) as {
          messages?: { id: string; threadId?: string }[];
        };
        if (result.messages?.length === 1) recovered = result.messages[0];
      }
    } catch {
      /* Keep the uncertain operation locked; never send it again. */
    }
    if (!recovered?.id)
      throw new SendUncertain(
        "Delivery is not confirmed. Check Gmail Sent before sending another message.",
      );
    const [saved] = await db
      .update(mailSendOperations)
      .set({ state: "sent", messageId: recovered.id, threadId: recovered.threadId ?? recovered.id })
      .where(condition)
      .returning();
    operation = saved!;
  }
  const to = cleanHeader(input.to);
  const snapshots = await db
    .select()
    .from(mailSendFiles)
    .where(and(eq(mailSendFiles.userId, userId), eq(mailSendFiles.operationId, operationId)));
  if (snapshots.length !== attachmentIds.length)
    throw new Error("Attachment snapshot is incomplete. Do not retry with a different message.");
  const mime = buildMailMime(
    { operationId, to, subject: input.subject, body: input.body },
    snapshots.sort((a, b) => a.fileId.localeCompare(b.fileId)),
  );
  const raw = b64(new TextEncoder().encode(mime))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  let sent: { id: string; threadId?: string };
  if (operation.state === "sent" && operation.messageId) {
    sent = {
      id: operation.messageId,
      ...(operation.threadId ? { threadId: operation.threadId } : {}),
    };
  } else {
    if (demo) {
      sent = {
        id: `demo-sent-${operationId}`,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      };
    } else {
      let res: Response;
      try {
        res = await fetch(`${GMAIL_API()}/gmail/v1/users/me/messages/send`, {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw, ...(input.threadId ? { threadId: input.threadId } : {}) }),
        });
      } catch {
        throw new SendUncertain(
          "Delivery is not confirmed. Check Gmail Sent before sending another message.",
        );
      }
      if (!res.ok) {
        // A server failure may happen after delivery; only definite client rejections can be retried.
        if ([400, 401, 403, 404, 413, 422, 429].includes(res.status)) {
          await db.update(mailSendOperations).set({ state: "failed" }).where(condition);
          if (res.status === 401 || res.status === 403)
            throw new ReconnectRequired("Gmail send permission is missing");
          throw new Error(`Gmail send failed (${res.status})`);
        }
        throw new SendUncertain(
          "Delivery is not confirmed. Check Gmail Sent before sending another message.",
        );
      }
      try {
        sent = (await res.json()) as { id: string; threadId?: string };
        if (!sent.id) throw new Error("Missing message ID");
      } catch {
        throw new SendUncertain(
          "Delivery is not confirmed. Check Gmail Sent before sending another message.",
        );
      }
    }
    await db
      .update(mailSendOperations)
      .set({ state: "sent", messageId: sent.id, threadId: sent.threadId ?? sent.id })
      .where(condition);
  }

  await storeMailboxMessage(
    db,
    account,
    {
      userId,
      id: sent.id,
      threadId: sent.threadId ?? sent.id,
      fromName: "You",
      fromEmail: account.email.toLowerCase(),
      toEmails: to.toLowerCase(),
      subject: cleanHeader(input.subject),
      snippet: input.body.slice(0, 300),
      body: input.body.slice(0, 20000),
      receivedAt: operation.createdAt,
      unread: false,
      inInbox: false,
      sent: true,
      trashed: false,
      requestId: input.requestId,
    },
    false,
  );
  if (!input.requestId) await autoLinkEmails(userId);
}

export async function moveMail(userId: string, origin: string, id: string, trash: boolean) {
  const db = await getDb();
  const [account] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.userId, userId));
  if (!account) throw new ReconnectRequired("Gmail is not connected");
  const condition = and(eq(emailMessages.userId, userId), eq(emailMessages.id, id));
  const [mail] = await db.select().from(emailMessages).where(condition);
  if (!mail) throw new Error("Email not found");
  let labels: string[] | undefined;
  if (account.refreshToken !== DEMO_REFRESH_TOKEN) {
    const token = await accessToken(userId, origin, account);
    const response = await fetch(
      `${GMAIL_API()}/gmail/v1/users/me/messages/${encodeURIComponent(id)}/${trash ? "trash" : "untrash"}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (response.status === 403 || response.status === 401)
      throw new ReconnectRequired("Reconnect Gmail to allow moving emails");
    if (!response.ok) throw new Error(`Gmail move failed (${response.status})`);
    labels = ((await response.json()) as { labelIds?: string[] }).labelIds;
  }
  await db
    .update(emailMessages)
    .set({
      trashed: trash,
      ...(labels
        ? {
            inInbox: labels.includes("INBOX"),
            sent: labels.includes("SENT"),
            unread: labels.includes("UNREAD"),
          }
        : {}),
    })
    .where(
      and(
        condition,
        sql`EXISTS (SELECT 1 FROM gmail_accounts WHERE user_id = ${userId}
      AND email = ${account.email} AND refresh_token = ${account.refreshToken})`,
      ),
    );
}
