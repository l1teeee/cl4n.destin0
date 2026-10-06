import { describe, expect, it } from "vitest";

import {
  adminUserIdSchema,
  changeOwnPasswordSchema,
  createAdminUserSchema,
  resetAdminPasswordSchema,
  updateAdminUserSchema,
} from "@/contracts/admin-users";

const id = "00000000-0000-4000-8000-000000000001";
const validCreate = {
  email: "  Nuevo.Admin@Example.com ",
  displayName: "  Nuevo Admin ",
  role: "ADMIN",
  password: "una-clave-segura-1",
  passwordConfirmation: "una-clave-segura-1",
};

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

describe("admin user contracts", () => {
  it("accepts a valid new admin and trims text fields", () => {
    const result = createAdminUserSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      email: "Nuevo.Admin@Example.com",
      displayName: "Nuevo Admin",
      role: "ADMIN",
    });
  });

  it.each([
    [
      "mismatched confirmation",
      { passwordConfirmation: "otra-clave-segura-1" },
      "Las contraseñas no coinciden.",
    ],
    [
      "short password",
      { password: "corta", passwordConfirmation: "corta" },
      "La contraseña debe tener al menos 12 caracteres.",
    ],
    [
      "long password",
      { password: "x".repeat(257), passwordConfirmation: "x".repeat(257) },
      "La contraseña no puede superar 256 caracteres.",
    ],
    [
      "control characters in the name",
      { displayName: "Admin\u0007" },
      "No se permiten caracteres de control.",
    ],
    [
      "control characters in the password",
      { password: "clave-segura\u0000-1", passwordConfirmation: "clave-segura\u0000-1" },
      "No se permiten caracteres de control.",
    ],
    ["unknown role", { role: "OWNER" }, "El rol no es válido."],
    ["invalid email", { email: "no-es-email" }, "Ingresa un email válido."],
    ["empty name", { displayName: "   " }, "El nombre es obligatorio."],
  ])("rejects %s", (_case, override, message) => {
    expect(firstMessage(createAdminUserSchema.safeParse({ ...validCreate, ...override }))).toBe(
      message,
    );
  });

  it("rejects unexpected fields", () => {
    expect(createAdminUserSchema.safeParse({ ...validCreate, isActive: true }).success).toBe(false);
    expect(
      updateAdminUserSchema.safeParse({ id, displayName: "A", role: "ADMIN", x: 1 }).success,
    ).toBe(false);
  });

  it("validates ids, updates, resets and own password changes", () => {
    expect(firstMessage(adminUserIdSchema.safeParse({ id: "1" }))).toBe(
      "El identificador no es válido.",
    );
    expect(
      updateAdminUserSchema.safeParse({
        id,
        displayName: "Admin",
        role: "SUPER_ADMIN",
        expectedRole: "ADMIN",
      }).success,
    ).toBe(true);
    expect(
      firstMessage(
        resetAdminPasswordSchema.safeParse({
          id,
          password: "una-clave-segura-1",
          passwordConfirmation: "una-clave-segura-2",
        }),
      ),
    ).toBe("Las contraseñas no coinciden.");
    expect(
      firstMessage(
        changeOwnPasswordSchema.safeParse({
          currentPassword: "",
          newPassword: "una-clave-segura-1",
          newPasswordConfirmation: "una-clave-segura-1",
        }),
      ),
    ).toBe("La contraseña actual es obligatoria.");
    expect(
      changeOwnPasswordSchema.safeParse({
        currentPassword: "actual",
        newPassword: "una-clave-segura-1",
        newPasswordConfirmation: "una-clave-segura-1",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["invalid", "OWNER"],
  ])("rejects a %s expected role", (_case, expectedRole) => {
    expect(
      updateAdminUserSchema.safeParse({
        id,
        displayName: "Admin",
        role: "ADMIN",
        ...(expectedRole === undefined ? {} : { expectedRole }),
      }).success,
    ).toBe(false);
  });
});
