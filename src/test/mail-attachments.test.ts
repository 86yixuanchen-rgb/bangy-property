// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildMailMime } from "@/lib/mail-attachments.server";
describe("MIME attachments", () => {
  it("encodes multilingual subjects, message and filenames into separate MIME parts", () => {
    const mime = buildMailMime(
      {
        operationId: "stable-id",
        to: "tenant@example.test",
        subject: "维修报价",
        body: "Please review\n附件",
      },
      [{ name: "报价.pdf", mime: "application/pdf", content: btoa("%PDF-1.4\nquote") }],
    );
    expect(mime).toContain("multipart/mixed");
    expect(mime).toContain("filename*=UTF-8''%E6%8A%A5%E4%BB%B7.pdf");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain(btoa("%PDF-1.4\nquote"));
    expect(mime).toContain("Message-ID: <banjg-stable-id@mail.banjg.invalid>");
    expect(mime).toContain("--banjg_stableid--");
  });
  it("prevents filename and header line injection", () => {
    const mime = buildMailMime(
      {
        operationId: "id",
        to: "x@example.test\r\nBcc: evil@example.test",
        subject: "Hello\r\nBcc: evil@example.test",
        body: "Body",
      },
      [{ name: 'bad"\r\nBcc: evil.pdf', mime: "application/pdf", content: btoa("%PDF") }],
    );
    expect(mime).not.toContain("\r\nBcc:");
  });
});
