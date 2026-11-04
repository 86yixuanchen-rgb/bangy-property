import { sendEmail as sendEmailOnce } from "./gmail.functions";

type Input = Omit<Parameters<typeof sendEmailOnce>[0]["data"], "operationId">;
const pending = new Map<string, string>();
export async function sendEmail({ data }: { data: Input }) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(data)),
  );
  const key =
    "banjg-send-" +
    Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  let id = pending.get(key);
  try {
    id ??= sessionStorage.getItem(key) ?? undefined;
  } catch {
    /* Storage may be disabled. */
  }
  id ??= crypto.randomUUID();
  pending.set(key, id);
  try {
    sessionStorage.setItem(key, id);
  } catch {
    /* Keep the in-memory key. */
  }
  let result;
  try {
    result = await sendEmailOnce({ data: { ...data, operationId: id } });
  } catch {
    // A lost response does not prove Gmail rejected the message; retain the retry key.
    return { ok: false as const, code: "UNCERTAIN" as const };
  }
  if (result.ok) {
    pending.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Storage may be disabled. */
    }
  }
  return result;
}
