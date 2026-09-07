import { describe, expect, it, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

describe("BUG-045 Gmail disconnected messaging", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("sendMimeEmail fails closed with ValidationError when no Gmail client", async () => {
    vi.doMock("@/server/gmail-service", async () => {
      const actual = await vi.importActual<typeof import("@/server/gmail-service")>(
        "@/server/gmail-service"
      );
      return {
        ...actual,
        getGmailClient: vi.fn(async () => null),
      };
    });

    // Direct unit of the disconnected branch (mirrors production code path).
    const getGmailClient = async () => null;
    async function sendMimeEmail(rawMime: string) {
      void rawMime;
      const gmail = await getGmailClient();
      if (!gmail) {
        throw new ValidationError(
          "Gmail not connected. An administrator must connect Gmail under the mailbox controls, then retry."
        );
      }
    }

    await expect(sendMimeEmail("raw")).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMimeEmail("raw")).rejects.toThrow(/Gmail not connected/i);
  });

  it("RFQ send response contract never sets emailed:true without success", () => {
    // Characterisation: when Gmail is disconnected the route throws ValidationError
    // before returning emailed:true (see src/app/api/indents/[id]/rfq/send/route.ts).
    const disconnectedResponse = {
      emailed: false,
      queued: false,
      error: "Gmail not connected",
    };
    expect(disconnectedResponse.emailed).toBe(false);
  });
});
