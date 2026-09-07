import { z } from "zod";

export const idParam = z.object({ id: z.string().min(1).max(64) });
export const indentIdParam = z.object({ indentId: z.string().min(1).max(64) });

export const approvalBody = z.object({
  stage: z.enum(["tl_indent", "tl_vendor", "director", "md"]),
  decision: z.enum(["APPROVED", "REJECTED"]),
  remarks: z.string().max(4000).optional().default(""),
});

export const rfqSendBody = z.object({
  subject: z.string().min(1).max(500),
  bodyTemplate: z.string().min(1).max(20000),
  vendorIds: z.array(z.string().min(1)).min(1).max(50),
});

export const loginBody = z.object({
  identifier: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
});
