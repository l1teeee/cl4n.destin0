import { z } from "zod";

const controlCharacters = /[\u0000-\u001f\u007f]/;
const controlCharacterMessage = "No se permiten caracteres de control.";

export const PASSWORD_RESET_INVALID_LINK_MESSAGE =
  "El enlace no es válido o venció. Solicita uno nuevo.";

const email = z
  .string({ error: "El email es obligatorio." })
  .trim()
  .max(254, "El email no puede superar 254 caracteres.")
  .email("Ingresa un email válido.");

export const adminSignInSchema = z
  .object({
    email,
    password: z
      .string({ error: "La contraseña es obligatoria." })
      .min(1, "La contraseña es obligatoria.")
      .max(1024, "La contraseña no es válida."),
  })
  .strict();

export const adminPasswordResetRequestSchema = z.object({ email }).strict();

export const adminPasswordResetCompleteSchema = z
  .object({
    token: z
      .string({ error: PASSWORD_RESET_INVALID_LINK_MESSAGE })
      .regex(/^[A-Za-z0-9_-]{43}$/, PASSWORD_RESET_INVALID_LINK_MESSAGE),
    password: z
      .string({ error: "La contraseña es obligatoria." })
      .min(12, "La contraseña debe tener al menos 12 caracteres.")
      .max(256, "La contraseña no puede superar 256 caracteres.")
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage),
    passwordConfirmation: z.string({ error: "Confirma la contraseña." }),
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Las contraseñas no coinciden.",
  });
