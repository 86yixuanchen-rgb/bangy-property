import { and, eq, isNull, inArray } from "drizzle-orm";
import { caseAttachments } from "@/db/schema";
import type { AppDatabase } from "./db.server";
export async function resolveAttachments(
  db: AppDatabase,
  userId: string,
  requestId: string | null,
  ids: string[] = [],
) {
  const unique = [...new Set(ids)].sort();
  if (unique.length > 5) throw new Error("Choose at most five attachments.");
  if (!unique.length) return [];
  if (!requestId) throw new Error("Select an event before adding files.");
  const files = await db
    .select()
    .from(caseAttachments)
    .where(
      and(
        eq(caseAttachments.userId, userId),
        eq(caseAttachments.requestId, requestId),
        isNull(caseAttachments.trashedAt),
        inArray(caseAttachments.id, unique),
      ),
    );
  if (files.length !== unique.length)
    throw new Error(
      "An attachment is missing, in the recycle bin, or belongs to another event. Review your selection.",
    );
  return files.sort((a, b) => a.id.localeCompare(b.id));
}
export function buildMailMime(
  input: { operationId: string; to: string; subject: string; body: string },
  files: Array<{ name: string; mime: string; content: string }>,
) {
  const b64 = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  };
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const subject = clean(input.subject);
  const encoded = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${b64(subject)}?=`;
  const headers = [
    `Message-ID: <banjg-${input.operationId}@mail.banjg.invalid>`,
    `To: ${clean(input.to)}`,
    `Subject: ${encoded}`,
    "MIME-Version: 1.0",
  ];
  const text = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    (b64(input.body).match(/.{1,76}/g) ?? []).join("\r\n"),
  ];
  if (!files.length) return [...headers, ...text].join("\r\n");
  const boundary = `banjg_${input.operationId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const sections = files.map((f) => {
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.mime))
      throw new Error("Unsupported attachment format");
    const safe = clean(f.name).replace(/[^a-zA-Z0-9_. -]/g, "_");
    return [
      `--${boundary}`,
      `Content-Type: ${f.mime}`,
      `Content-Disposition: attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(clean(f.name)).replace(/'/g, "%27")}`,
      "Content-Transfer-Encoding: base64",
      "",
      (f.content.match(/.{1,76}/g) ?? []).join("\r\n"),
    ].join("\r\n");
  });
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...text,
    ...sections,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
