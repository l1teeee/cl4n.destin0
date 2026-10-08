import { describe, expect, it } from "vitest";
import { adminAddedEmail } from "@/infrastructure/email/templates/admin-added-email";
import { adminDeletionCodeEmail } from "@/infrastructure/email/templates/admin-deletion-code-email";
import { reservationConfirmationEmail } from "@/infrastructure/email/templates/reservation-confirmation-email";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import type { RenderedEmail } from "@/infrastructure/email/templates/rendered-email";

const hostileName = `<script>alert("x")</script> & 'Ana'`;
const escapedHostileName = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Ana&#39;";
const loginUrl = "https://admin.example.com/login?next=a&b=c";
const eventStartsAt = new Date("2026-11-14T02:00:00.000Z");

function expectCleanHtml(email: RenderedEmail, allowedUrl?: string): void {
  expect(email.html).not.toContain("undefined");
  expect(email.html).not.toContain("null");
  expect(email.html).not.toContain("<img");
  expect(email.html).not.toContain("<script");
  const withoutAllowedUrl = allowedUrl
    ? email.html.replace(allowedUrl.replace(/&/g, "&amp;"), "")
    : email.html;
  expect(withoutAllowedUrl).not.toContain("http");
}

function expectNoHtmlInText(email: RenderedEmail): void {
  expect(email.text).not.toMatch(/<\/?[a-z][^>]*>/i);
  expect(email.text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
}

describe("reservationConfirmationEmail", () => {
  const email = reservationConfirmationEmail({
    fullName: "Ana Perez",
    reservationNumber: 7,
    partySize: 3,
    eventStartsAt,
  });

  it("uses the specified subject and preheader", () => {
    expect(email.subject).toBe("Tu lugar en el clan está confirmado");
    expect(email.html).toContain("Reserva #007 confirmada.");
  });

  it("contains every input value in html and text", () => {
    const eventDate = formatPublicEventDate(eventStartsAt);
    for (const value of ["Ana Perez", "#007", "3", eventDate]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
  });

  it("pads the reservation number to 3 digits", () => {
    expect(email.text).toContain("Reserva: #007");
  });

  it("has clean html and text", () => {
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("escapes hostile names in html only", () => {
    const hostile = reservationConfirmationEmail({
      fullName: hostileName,
      reservationNumber: 7,
      partySize: 3,
      eventStartsAt,
    });
    expect(hostile.html).toContain(escapedHostileName);
    expect(hostile.html).not.toContain(hostileName);
    expect(hostile.text).toContain(hostileName);
    expectCleanHtml(hostile);
  });
});

describe("adminAddedEmail", () => {
  const input = {
    displayName: "Luis Mejia",
    role: "ADMIN" as const,
    addedByDisplayName: "Marta Ruiz",
    loginUrl,
  };
  const email = adminAddedEmail(input);

  it("uses the specified subject and preheader", () => {
    expect(email.subject).toBe("Te agregaron a la administración de Clandestino");
    expect(email.html).toContain("Ya tienes acceso al panel.");
  });

  it("contains every input value in html and text", () => {
    for (const value of ["Luis Mejia", "Marta Ruiz", "administrador"]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.html).toContain('href="https://admin.example.com/login?next=a&amp;b=c"');
    expect(email.text).toContain(`Entrar al panel: ${loginUrl}`);
  });

  it("labels the super admin role", () => {
    const superAdmin = adminAddedEmail({ ...input, role: "SUPER_ADMIN" });
    expect(superAdmin.text).toContain("como super administrador.");
  });

  it("has clean html and text", () => {
    expectCleanHtml(email, loginUrl);
    expectNoHtmlInText({ ...email, text: email.text.replace(loginUrl, "") });
  });

  it("escapes hostile names in html only", () => {
    const hostile = adminAddedEmail({
      ...input,
      displayName: hostileName,
      addedByDisplayName: hostileName,
    });
    expect(hostile.html).toContain(escapedHostileName);
    expect(hostile.html).not.toContain(hostileName);
    expect(hostile.text).toContain(hostileName);
    expectCleanHtml(hostile, loginUrl);
  });
});

describe("adminDeletionCodeEmail", () => {
  const input = {
    actorDisplayName: "Marta Ruiz",
    targetDisplayName: "Luis Mejia",
    targetEmail: "luis@example.com",
    code: "483920",
    expiresInMinutes: 10,
  };
  const email = adminDeletionCodeEmail(input);

  it("uses the specified subject and preheader", () => {
    expect(email.subject).toBe("Código para eliminar un administrador");
    expect(email.html).toContain("Tu código vence en 10 minutos.");
  });

  it("contains every input value in html and text", () => {
    for (const value of ["Marta Ruiz", "Luis Mejia", "luis@example.com", "483920", "10 minutos"]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
  });

  it("puts the code exactly once in the html code box", () => {
    expect(email.html.split("483920")).toHaveLength(2);
  });

  it("has clean html and text", () => {
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("escapes hostile names in html only", () => {
    const hostile = adminDeletionCodeEmail({
      ...input,
      actorDisplayName: hostileName,
      targetDisplayName: hostileName,
    });
    expect(hostile.html).toContain(escapedHostileName);
    expect(hostile.html).not.toContain(hostileName);
    expect(hostile.text).toContain(hostileName);
    expectCleanHtml(hostile);
  });
});
