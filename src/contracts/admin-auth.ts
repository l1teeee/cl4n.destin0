import { z } from "zod";

export const adminSignInSchema = z
  .object({
    email: z
      .string({ error: "El email es obligatorio." })
      .trim()
      .max(254, "El email no puede superar 254 caracteres.")
      .email("Ingresa un email válido."),
    password: z
      .string({ error: "La contraseña es obligatoria." })
      .min(1, "La contraseña es obligatoria.")
      .max(1024, "La contraseña no es válida."),
  })
  .strict();
