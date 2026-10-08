import { describe, expect, it, vi } from "vitest";

import { createLogEmailSender } from "@/infrastructure/email/log-email-sender";

describe("createLogEmailSender", () => {
  it("writes the recipient, subject, and plain-text body in one block", async () => {
    const write = vi.fn<(line: string) => void>();
    const sender = createLogEmailSender(write);

    await sender.send({
      to: { email: "admin@example.com", name: "Admin" },
      subject: "Deletion code",
      html: "<p>Code: 123456</p>",
      text: "Code: 123456",
    });

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      "To: Admin <admin@example.com>\nSubject: Deletion code\n\nCode: 123456",
    );
  });
});
