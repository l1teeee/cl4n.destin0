import { describe, expect, it, vi } from "vitest";

import type { OutgoingEmail } from "@/application/ports/email-sender";
import { createBrevoEmailSender } from "@/infrastructure/email/brevo-email-sender";
import { EmailDeliveryError } from "@/infrastructure/email/email-delivery-error";

const outgoingEmail: OutgoingEmail = {
  to: { email: "guest@example.com", name: "Guest Name" },
  subject: "Reservation confirmed",
  html: "<p>Your reservation is confirmed.</p>",
  text: "Your reservation is confirmed.",
};

function sender(fetchImpl: typeof fetch) {
  return createBrevoEmailSender({
    apiKey: "brevo-api-key",
    fromAddress: "reservations@clandestino.example",
    fromName: "Clandestino",
    fetchImpl,
  });
}

describe("createBrevoEmailSender", () => {
  it("posts the email to Brevo with the required headers and body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));

    await sender(fetchImpl).send(outgoingEmail);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "api-key": "brevo-api-key",
        "content-type": "application/json",
        accept: "application/json",
      },
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      sender: { name: "Clandestino", email: "reservations@clandestino.example" },
      to: [{ email: "guest@example.com", name: "Guest Name" }],
      subject: "Reservation confirmed",
      htmlContent: "<p>Your reservation is confirmed.</p>",
      textContent: "Your reservation is confirmed.",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits the recipient name when it is undefined", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));

    await sender(fetchImpl).send({
      ...outgoingEmail,
      to: { email: outgoingEmail.to.email },
    });

    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string);
    expect(body.to).toEqual([{ email: "guest@example.com" }]);
    expect(body.to[0]).not.toHaveProperty("name");
  });

  it.each([400, 503])("throws a sanitized delivery error for status %s", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("provider response containing details", {
        status,
      }),
    );

    const error = await sender(fetchImpl)
      .send(outgoingEmail)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error).toMatchObject({
      name: "EmailDeliveryError",
      status,
      message: `Brevo rejected the email with status ${status}`,
    });
    expect(error.message).not.toContain(outgoingEmail.to.email);
    expect(error.message).not.toContain(outgoingEmail.subject);
    expect(error.message).not.toContain(outgoingEmail.html);
    expect(error.message).not.toContain(outgoingEmail.text);
    expect(error.message).not.toContain("provider response containing details");
  });

  it("preserves a rejected fetch as the delivery error cause", async () => {
    const cause = new Error("network unavailable");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(cause);

    const error = await sender(fetchImpl)
      .send(outgoingEmail)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error).toMatchObject({
      name: "EmailDeliveryError",
      status: null,
      message: "Brevo request failed",
      cause,
    });
  });
});
