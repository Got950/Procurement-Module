import "dotenv/config";
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  assertMailAddress,
  buildMimeMessage,
  signGmailOauthState,
  verifyGmailOauthState,
} from "@/server/gmail-service";

describe("MIME headers", () => {
  it("strips CRLF from Subject so a Bcc injection cannot land", () => {
    const mime = buildMimeMessage({
      to: "vendor@example.com",
      subject: "RFQ\r\nBcc: attacker@example.com",
      bodyText: "hello",
    });
    expect(mime).not.toMatch(/\nBcc:/i);
    expect(mime).toContain("Subject: RFQ Bcc: attacker@example.com");
  });

  it("rejects a malformed recipient", () => {
    expect(() => assertMailAddress("not-an-email")).toThrow(ValidationError);
    expect(() => assertMailAddress("a@b.com\r\nBcc: x@y.com")).toThrow(ValidationError);
  });
});

describe("Gmail OAuth state", () => {
  it("binds the signed state to the issuing user", async () => {
    const token = await signGmailOauthState("user-1");
    expect(await verifyGmailOauthState(token, "user-1")).toBe(true);
    expect(await verifyGmailOauthState(token, "user-2")).toBe(false);
    expect(await verifyGmailOauthState("tampered", "user-1")).toBe(false);
  });
});
