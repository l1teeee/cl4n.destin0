import { describe, expect, it } from "vitest";
import {
  adminAccountNoticeEmail,
  type AdminAccountNotice,
} from "@/infrastructure/email/templates/admin-account-notice-email";
import { adminPasswordResetEmail } from "@/infrastructure/email/templates/admin-password-reset-email";
import { adminSignInAlertEmail } from "@/infrastructure/email/templates/admin-sign-in-alert-email";
import { reservationCancelledEmail } from "@/infrastructure/email/templates/reservation-cancelled-email";
import { reservationWaitlistedEmail } from "@/infrastructure/email/templates/reservation-waitlisted-email";
import { waitlistPromotedEmail } from "@/infrastructure/email/templates/waitlist-promoted-email";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import type { RenderedEmail } from "@/infrastructure/email/templates/rendered-email";

const hostileName = `<script>alert("x")</script> & 'Ana'`;
const escapedHostileName = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Ana&#39;";
const loginUrl = "https://admin.example.com/login?next=a&b=c";
const resetUrl = "https://admin.example.com/reset?token=abc&b=c";
const eventStartsAt = new Date("2026-11-14T02:00:00.000Z");
const eventDate = formatPublicEventDate(eventStartsAt);

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

function expectNoHtmlInText(email: RenderedEmail, allowedUrl?: string): void {
  const text = allowedUrl ? email.text.replace(allowedUrl, "") : email.text;
  expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);
  expect(text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
  expect(text).not.toContain("undefined");
  expect(text).not.toContain("null");
}

function expectHostileNameEscaped(email: RenderedEmail, allowedUrl?: string): void {
  expect(email.html).toContain(escapedHostileName);
  expect(email.html).not.toContain(hostileName);
  expect(email.text).toContain(hostileName);
  expectCleanHtml(email, allowedUrl);
}

describe("reservationWaitlistedEmail", () => {
  const input = { fullName: "Ana Perez", position: 4, partySize: 3, eventStartsAt };
  const email = reservationWaitlistedEmail(input);

  it("uses the specified subject, preheader and heading", () => {
    expect(email.subject).toBe("Estás en la cola del clan");
    expect(email.html).toContain("Posición #4 en la cola.");
    expect(email.html).toContain("Quedaste en la cola");
  });

  it("contains every input value in html and text", () => {
    for (const value of ["Ana Perez", "#4", "3", eventDate]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.text).toContain("Posición: #4");
    expect(email.text).toContain("Personas: 3");
    expect(email.text).toContain("Si se libera un lugar, te avisaremos por este medio.");
  });

  it("has clean html and text", () => {
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("escapes hostile names in html only", () => {
    expectHostileNameEscaped(reservationWaitlistedEmail({ ...input, fullName: hostileName }));
  });
});

describe("waitlistPromotedEmail", () => {
  const input = { fullName: "Ana Perez", reservationNumber: 7, partySize: 3, eventStartsAt };
  const email = waitlistPromotedEmail(input);

  it("uses the specified subject, preheader and heading", () => {
    expect(email.subject).toBe("Se liberó un lugar: estás dentro");
    expect(email.html).toContain("Reserva #007 confirmada.");
    expect(email.html).toContain("Entraste al clan");
  });

  it("contains every input value in html and text", () => {
    for (const value of ["Ana Perez", "#007", "3", eventDate]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.text).toContain("Reserva: #007");
    expect(email.text).toContain("Guarda este correo como comprobante de tu reserva.");
  });

  it("has clean html and text", () => {
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("escapes hostile names in html only", () => {
    expectHostileNameEscaped(waitlistPromotedEmail({ ...input, fullName: hostileName }));
  });
});

describe("reservationCancelledEmail", () => {
  const confirmedInput = { fullName: "Ana Perez", reservationNumber: 7, eventStartsAt };
  const waitlistInput = { fullName: "Ana Perez", reservationNumber: null, eventStartsAt };

  it("describes a cancelled reservation when it has a number", () => {
    const email = reservationCancelledEmail(confirmedInput);
    expect(email.subject).toBe("Tu reserva fue cancelada");
    expect(email.html).toContain("Tu reserva fue cancelada");
    for (const value of ["Ana Perez", "tu reserva #7", eventDate]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.text).toContain(
      "Si crees que es un error, responde a la persona que te invitó al clan.",
    );
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("describes a removed waitlist entry when the number is null", () => {
    const email = reservationCancelledEmail(waitlistInput);
    expect(email.subject).toBe("Saliste de la cola");
    expect(email.html).toContain("Saliste de la cola");
    for (const value of ["Ana Perez", "tu lugar en la cola para", eventDate, "fue retirado."]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.text).not.toContain("#");
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("escapes hostile names in html only", () => {
    expectHostileNameEscaped(
      reservationCancelledEmail({ ...confirmedInput, fullName: hostileName }),
    );
    expectHostileNameEscaped(
      reservationCancelledEmail({ ...waitlistInput, fullName: hostileName }),
    );
  });
});

describe("adminSignInAlertEmail", () => {
  const occurredAt = new Date("2026-11-14T20:05:00.000Z");
  const input = { displayName: "Luis Mejia", occurredAt, ipAddress: "203.0.113.9" };
  const email = adminSignInAlertEmail(input);

  it("uses the specified subject, preheader and heading", () => {
    expect(email.subject).toBe("Nuevo inicio de sesión en Clandestino");
    expect(email.html).toContain("Se inició sesión en tu cuenta.");
    expect(email.html).toContain("Nuevo inicio de sesión");
  });

  it("contains every input value in html and text", () => {
    for (const value of [
      "Luis Mejia",
      "14 de noviembre 2026, 14:05 (hora de El Salvador)",
      "203.0.113.9",
    ]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.text).toContain("Fecha: 14 de noviembre 2026, 14:05 (hora de El Salvador)");
    expect(email.text).toContain("IP: 203.0.113.9");
    expect(email.text).toContain("Si no fuiste tú, cambia tu contraseña de inmediato");
  });

  it("shows No disponible when the ip is null", () => {
    const withoutIp = adminSignInAlertEmail({ ...input, ipAddress: null });
    expect(withoutIp.html).toContain("No disponible");
    expect(withoutIp.text).toContain("IP: No disponible");
    expectCleanHtml(withoutIp);
    expectNoHtmlInText(withoutIp);
  });

  it("has clean html and text", () => {
    expectCleanHtml(email);
    expectNoHtmlInText(email);
  });

  it("escapes hostile names in html only", () => {
    expectHostileNameEscaped(adminSignInAlertEmail({ ...input, displayName: hostileName }));
  });
});

describe("adminAccountNoticeEmail", () => {
  const unrecognizedChangeWarning =
    "Si no reconoces este cambio, contacta de inmediato a un super administrador.";

  const cases: {
    notice: AdminAccountNotice;
    subject: string;
    body: string;
    hasButton: boolean;
    hasWarning: boolean;
  }[] = [
    {
      notice: "PASSWORD_RESET_BY_ADMIN",
      subject: "Tu contraseña fue restablecida",
      body: "Luis Mejia, un super administrador restableció tu contraseña y cerró tus sesiones. Pídele la nueva contraseña por un canal seguro.",
      hasButton: true,
      hasWarning: false,
    },
    {
      notice: "PASSWORD_CHANGED",
      subject: "Cambiaste tu contraseña",
      body: "Luis Mejia, la contraseña de tu cuenta se cambió y las demás sesiones se cerraron.",
      hasButton: true,
      hasWarning: true,
    },
    {
      notice: "PASSWORD_RESET_COMPLETED",
      subject: "Recuperaste tu contraseña",
      body: "Luis Mejia, tu contraseña se cambió con el enlace de recuperación y todas tus sesiones se cerraron.",
      hasButton: true,
      hasWarning: true,
    },
    {
      notice: "DEACTIVATED",
      subject: "Tu acceso fue desactivado",
      body: "Luis Mejia, un super administrador desactivó tu acceso a la administración.",
      hasButton: false,
      hasWarning: false,
    },
    {
      notice: "REACTIVATED",
      subject: "Tu acceso fue reactivado",
      body: "Luis Mejia, tu acceso a la administración está activo de nuevo.",
      hasButton: true,
      hasWarning: false,
    },
    {
      notice: "ROLE_CHANGED",
      subject: "Tu rol cambió",
      body: "Luis Mejia, ahora tu rol es administrador.",
      hasButton: true,
      hasWarning: true,
    },
    {
      notice: "DELETED",
      subject: "Tu acceso fue eliminado",
      body: "Luis Mejia, tu cuenta de administración fue eliminada.",
      hasButton: false,
      hasWarning: false,
    },
    {
      notice: "SESSIONS_REVOKED",
      subject: "Tus sesiones se cerraron",
      body: "Luis Mejia, un super administrador cerró tus sesiones abiertas.",
      hasButton: true,
      hasWarning: true,
    },
  ];

  describe.each(cases)("$notice", ({ notice, subject, body, hasButton, hasWarning }) => {
    const input = { displayName: "Luis Mejia", notice, role: "ADMIN" as const, loginUrl };
    const email = adminAccountNoticeEmail(input);

    it("uses the specified subject, preheader, heading and body", () => {
      expect(email.subject).toBe(subject);
      expect(email.html).toContain(`${subject}.`);
      expect(email.html).toContain(subject);
      expect(email.html).toContain(body);
      expect(email.text).toBe(
        [
          subject,
          body,
          ...(hasButton ? [`Entrar al panel: ${loginUrl}`] : []),
          ...(hasWarning ? [unrecognizedChangeWarning] : []),
        ].join("\n\n"),
      );
    });

    it("shows the login button only when expected", () => {
      if (hasButton) {
        expect(email.html).toContain('href="https://admin.example.com/login?next=a&amp;b=c"');
        expect(email.html).toContain("Entrar al panel");
      } else {
        expect(email.html).not.toContain("Entrar al panel");
        expect(email.html).not.toContain("href=");
        expect(email.text).not.toContain(loginUrl);
      }
    });

    it("shows the unrecognized change warning only when expected", () => {
      expect(email.html.includes(unrecognizedChangeWarning)).toBe(hasWarning);
      expect(email.text.includes(unrecognizedChangeWarning)).toBe(hasWarning);
    });

    it("has clean html and text", () => {
      expectCleanHtml(email, loginUrl);
      expectNoHtmlInText(email, loginUrl);
    });

    it("escapes hostile names in html only", () => {
      expectHostileNameEscaped(
        adminAccountNoticeEmail({ ...input, displayName: hostileName }),
        loginUrl,
      );
    });
  });

  it("labels the super admin role", () => {
    const email = adminAccountNoticeEmail({
      displayName: "Luis Mejia",
      notice: "ROLE_CHANGED",
      role: "SUPER_ADMIN",
      loginUrl,
    });
    expect(email.text).toContain("ahora tu rol es super administrador.");
  });

  it("throws when ROLE_CHANGED has no role", () => {
    expect(() =>
      adminAccountNoticeEmail({ displayName: "Luis Mejia", notice: "ROLE_CHANGED", loginUrl }),
    ).toThrow();
  });
});

describe("adminPasswordResetEmail", () => {
  const input = { displayName: "Luis Mejia", resetUrl, expiresInMinutes: 30 };
  const email = adminPasswordResetEmail(input);

  it("uses the specified subject, preheader and heading", () => {
    expect(email.subject).toBe("Recupera tu contraseña");
    expect(email.html).toContain("El enlace vence en 30 minutos.");
    expect(email.html).toContain("Recupera tu contraseña");
  });

  it("contains every input value in html and text", () => {
    for (const value of ["Luis Mejia", "30 minutos", "Crear nueva contraseña"]) {
      expect(email.html).toContain(value);
      expect(email.text).toContain(value);
    }
    expect(email.html).toContain('href="https://admin.example.com/reset?token=abc&amp;b=c"');
    expect(email.text).toContain("Si no lo pediste, ignora este correo.");
  });

  it("puts the url on its own line in the text", () => {
    expect(email.text.split("\n")).toContain(resetUrl);
  });

  it("has clean html and text", () => {
    expectCleanHtml(email, resetUrl);
    expectNoHtmlInText(email, resetUrl);
  });

  it("escapes hostile names in html only", () => {
    expectHostileNameEscaped(
      adminPasswordResetEmail({ ...input, displayName: hostileName }),
      resetUrl,
    );
  });
});
