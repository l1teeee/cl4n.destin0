import { z } from "zod";

import { adminRoles } from "@/domain/admin/admin-access";

const controlCharacters = /[\u0000-\u001f\u007f]/;
const controlCharacterMessage = "No se permiten caracteres de control.";
const passwordMismatchMessage = "Las contraseñas no coinciden.";

const id = z
  .string({ error: "El identificador es obligatorio." })
  .uuid("El identificador no es válido.");

const email = z
  .string({ error: "El email es obligatorio." })
  .trim()
  .max(254, "El email no puede superar 254 caracteres.")
  .email("Ingresa un email válido.");

const displayName = z
  .string({ error: "El nombre es obligatorio." })
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(80, "El nombre no puede superar 80 caracteres.")
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage);

const role = z.enum(adminRoles, { error: "El rol no es válido." });

const newPassword = z
  .string({ error: "La contraseña es obligatoria." })
  .min(12, "La contraseña debe tener al menos 12 caracteres.")
  .max(256, "La contraseña no puede superar 256 caracteres.")
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage);

const passwordConfirmation = z.string({ error: "Confirma la contraseña." });

export const createAdminUserSchema = z
  .object({ email, displayName, role, password: newPassword, passwordConfirmation })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: passwordMismatchMessage,
  });

export const updateAdminUserSchema = z
  .object({ id, displayName, role, expectedRole: role })
  .strict();

export const adminUserIdSchema = z.object({ id }).strict();

export const adminDeletionCodeSchema = z
  .object({
    id,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Ingresa el código de 6 dígitos."),
  })
  .strict();

export const resetAdminPasswordSchema = z
  .object({ id, password: newPassword, passwordConfirmation })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: passwordMismatchMessage,
  });

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "La contraseña actual es obligatoria." })
      .min(1, "La contraseña actual es obligatoria.")
      .max(1024, "La contraseña actual no es válida."),
    newPassword,
    newPasswordConfirmation: passwordConfirmation,
  })
  .strict()
  .refine((value) => value.newPassword === value.newPasswordConfirmation, {
    path: ["newPasswordConfirmation"],
    message: passwordMismatchMessage,
  });
