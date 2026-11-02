import { describe, expect, it } from "vitest";

import {
  paymentSettingsSchema,
  readPaymentSettingsFormData,
} from "@/contracts/admin-payment-settings";
import { hasPermission } from "@/domain/admin/admin-access";

const valid = {
  bankName: "  Banco Agrícola ",
  accountType: "Corriente",
  accountNumber: "0123456789",
  accountHolder: "Ana Pérez",
  paymentLink: "",
};

function firstError(input: Record<string, unknown>, field: string): string | undefined {
  const result = paymentSettingsSchema.safeParse(input);
  return result.success
    ? undefined
    : result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("payment settings contract", () => {
  it("trims the fields and stores an empty link as null", () => {
    expect(paymentSettingsSchema.parse(valid)).toEqual({
      bankName: "Banco Agrícola",
      accountType: "Corriente",
      accountNumber: "0123456789",
      accountHolder: "Ana Pérez",
      paymentLink: null,
    });
  });

  it("reads the form fields and treats a missing link as empty", () => {
    const formData = new FormData();
    for (const [field, value] of Object.entries({ ...valid, paymentLink: "https://a.example/p" })) {
      formData.set(field, value);
    }

    expect(paymentSettingsSchema.parse(readPaymentSettingsFormData(formData)).paymentLink).toBe(
      "https://a.example/p",
    );
    formData.delete("paymentLink");
    expect(
      paymentSettingsSchema.parse(readPaymentSettingsFormData(formData)).paymentLink,
    ).toBeNull();
  });

  it.each([
    ["bankName", "", "El banco es obligatorio."],
    ["bankName", "x".repeat(81), "El banco no puede superar 80 caracteres."],
    ["accountType", "Otra", "Elige Ahorro o Corriente."],
    ["accountNumber", "  ", "El número de cuenta es obligatorio."],
    ["accountHolder", "", "El titular es obligatorio."],
    ["paymentLink", "http://a.example/p", "Si es un enlace, debe empezar con https://."],
    ["paymentLink", "HTTP://a.example/p", "Si es un enlace, debe empezar con https://."],
    [
      "paymentLink",
      `https://a.example/${"x".repeat(300)}`,
      "El enlace o código no puede superar 300 caracteres.",
    ],
  ])("rejects %s = %j", (field, value, message) => {
    expect(firstError({ ...valid, [field]: value }, field)).toBe(message);
  });

  it.each(["codigo-123", "Transfer 365 ref 99", "https://a.example/p", "HTTPS://A.EXAMPLE/P"])(
    "accepts %j as a payment link or code",
    (paymentLink) => {
      expect(paymentSettingsSchema.parse({ ...valid, paymentLink }).paymentLink).toBe(paymentLink);
    },
  );

  it("accepts a code of exactly 300 characters", () => {
    const paymentLink = "c".repeat(300);

    expect(paymentSettingsSchema.parse({ ...valid, paymentLink }).paymentLink).toBe(paymentLink);
  });

  it("rejects unknown fields", () => {
    expect(paymentSettingsSchema.safeParse({ ...valid, id: 2 }).success).toBe(false);
  });
});

describe("payments.manage permission", () => {
  it("belongs to super admins only", () => {
    expect(hasPermission("SUPER_ADMIN", "payments.manage")).toBe(true);
    expect(hasPermission("ADMIN", "payments.manage")).toBe(false);
  });
});
