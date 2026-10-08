import type { AdminRole } from "@/domain/admin/admin-access";
import { emailHeading, emailOutlinedButton, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export type AdminAccountNotice =
  | "PASSWORD_RESET_BY_ADMIN"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_COMPLETED"
  | "DEACTIVATED"
  | "REACTIVATED"
  | "ROLE_CHANGED"
  | "DELETED"
  | "SESSIONS_REVOKED";

const roleLabels: Record<AdminRole, string> = {
  SUPER_ADMIN: "super administrador",
  ADMIN: "administrador",
};

const subjects: Record<AdminAccountNotice, string> = {
  PASSWORD_RESET_BY_ADMIN: "Tu contraseña fue restablecida",
  PASSWORD_CHANGED: "Cambiaste tu contraseña",
  PASSWORD_RESET_COMPLETED: "Recuperaste tu contraseña",
  DEACTIVATED: "Tu acceso fue desactivado",
  REACTIVATED: "Tu acceso fue reactivado",
  ROLE_CHANGED: "Tu rol cambió",
  DELETED: "Tu acceso fue eliminado",
  SESSIONS_REVOKED: "Tus sesiones se cerraron",
};

const noticesWithoutLoginButton: AdminAccountNotice[] = ["DELETED", "DEACTIVATED"];

const noticesWithUnrecognizedChangeWarning: AdminAccountNotice[] = [
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_COMPLETED",
  "ROLE_CHANGED",
  "SESSIONS_REVOKED",
];

function noticeBody(notice: AdminAccountNotice, displayName: string, role?: AdminRole): string {
  switch (notice) {
    case "PASSWORD_RESET_BY_ADMIN":
      return `${displayName}, un super administrador restableció tu contraseña y cerró tus sesiones. Pídele la nueva contraseña por un canal seguro.`;
    case "PASSWORD_CHANGED":
      return `${displayName}, la contraseña de tu cuenta se cambió y las demás sesiones se cerraron.`;
    case "PASSWORD_RESET_COMPLETED":
      return `${displayName}, tu contraseña se cambió con el enlace de recuperación y todas tus sesiones se cerraron.`;
    case "DEACTIVATED":
      return `${displayName}, un super administrador desactivó tu acceso a la administración.`;
    case "REACTIVATED":
      return `${displayName}, tu acceso a la administración está activo de nuevo.`;
    case "ROLE_CHANGED":
      if (!role) {
        throw new Error("El aviso ROLE_CHANGED requiere un rol");
      }
      return `${displayName}, ahora tu rol es ${roleLabels[role]}.`;
    case "DELETED":
      return `${displayName}, tu cuenta de administración fue eliminada.`;
    case "SESSIONS_REVOKED":
      return `${displayName}, un super administrador cerró tus sesiones abiertas.`;
  }
}

export function adminAccountNoticeEmail(input: {
  displayName: string;
  notice: AdminAccountNotice;
  role?: AdminRole;
  loginUrl: string;
}): RenderedEmail {
  const subject = subjects[input.notice];
  const preheader = `${subject}.`;
  const body = noticeBody(input.notice, input.displayName, input.role);
  const buttonLabel = "Entrar al panel";
  const warning = "Si no reconoces este cambio, contacta de inmediato a un super administrador.";

  const htmlBlocks = [emailHeading(subject), emailParagraph(body)];
  const textBlocks = [subject, body];

  if (!noticesWithoutLoginButton.includes(input.notice)) {
    htmlBlocks.push(emailOutlinedButton(buttonLabel, input.loginUrl));
    textBlocks.push(`${buttonLabel}: ${input.loginUrl}`);
  }
  if (noticesWithUnrecognizedChangeWarning.includes(input.notice)) {
    htmlBlocks.push(emailParagraph(warning));
    textBlocks.push(warning);
  }

  return {
    subject,
    html: renderEmailLayout({ preheader, bodyHtml: htmlBlocks.join("\n") }),
    text: textBlocks.join("\n\n"),
  };
}
