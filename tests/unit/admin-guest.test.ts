import { describe, expect, it } from "vitest";

import {
  adminGuestFieldsSchema,
  expectedCancellationStageSchema,
  expectedPromotedEntryIdsSchema,
  paymentNoteSchema,
  readAdminGuestFields,
  readReservationReplacement,
  readSendMessage,
  reservationReplacementSchema,
} from "@/contracts/admin-guest";

function guestForm(overrides: Record<string, string | undefined> = {}): FormData {
  const values: Record<string, string | undefined> = {
    partySize: "1",
    guest1Name: "  Ana Pérez  ",
    guest1Instagram: " https://www.instagram.com/Ana.Perez/ ",
    hasAllergies: "false",
    notes: "",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) formData.set(key, value);
  }
  return formData;
}

describe("admin guest contract", () => {
  it("defaults missing replacement mode to auto and keeps the preview ids", () => {
    const formData = new FormData();
    const entryId = "00000000-0000-4000-8000-000000000001";
    formData.append("expectedPromotedEntryIds", entryId);
    expect(reservationReplacementSchema.parse(readReservationReplacement(formData))).toEqual({
      mode: "auto",
      expectedPromotedEntryIds: [entryId],
    });
    formData.set("replacementMode", "auto");
    expect(reservationReplacementSchema.parse(readReservationReplacement(formData))).toEqual({
      mode: "auto",
      expectedPromotedEntryIds: [entryId],
    });
  });

  it("requires a UUID for chosen mode and ignores the auto preview", () => {
    const formData = new FormData();
    formData.set("replacementMode", "chosen");
    for (const entryId of [null, "", "invalid"]) {
      if (entryId !== null) formData.set("replacementEntryId", entryId);
      const parsed = reservationReplacementSchema.safeParse(readReservationReplacement(formData));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({ path: ["replacementEntryId"] }),
        );
      }
    }
    const entryId = "00000000-0000-4000-8000-000000000002";
    formData.set("replacementEntryId", entryId);
    formData.append("expectedPromotedEntryIds", "stale-preview");
    expect(reservationReplacementSchema.parse(readReservationReplacement(formData))).toEqual({
      mode: "chosen",
      waitlistEntryId: entryId,
    });
    formData.set("replacementMode", "invalid");
    expect(
      reservationReplacementSchema.safeParse(readReservationReplacement(formData)).success,
    ).toBe(false);
  });

  it("trims fields, normalizes Instagram URLs, and turns empty notes into null", () => {
    const result = adminGuestFieldsSchema.parse(readAdminGuestFields(guestForm()));

    expect(result).toEqual({
      partySize: 1,
      guest1Name: "Ana Pérez",
      guest1Instagram: "ana.perez",
      guest2Name: null,
      guest2Instagram: null,
      hasAllergies: false,
      allergies: null,
      notes: null,
    });
  });

  it("requires the allergy answer instead of coercing a missing value", () => {
    const result = adminGuestFieldsSchema.safeParse(
      readAdminGuestFields(guestForm({ hasAllergies: undefined })),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["hasAllergies"], message: "Indica si hay alergias." }),
      );
    }
  });

  it("requires both guests and distinct normalized handles for a couple", () => {
    const missing = adminGuestFieldsSchema.safeParse(
      readAdminGuestFields(guestForm({ partySize: "2" })),
    );
    expect(missing.success).toBe(false);

    const duplicate = adminGuestFieldsSchema.safeParse(
      readAdminGuestFields(
        guestForm({
          partySize: "2",
          guest2Name: "Bea",
          guest2Instagram: "@ANA.PEREZ",
        }),
      ),
    );
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.error.issues).toContainEqual(
        expect.objectContaining({ path: ["guest2Instagram"] }),
      );
    }
  });

  it("requires and trims allergy details only for yes", () => {
    const missing = adminGuestFieldsSchema.safeParse(
      readAdminGuestFields(guestForm({ hasAllergies: "true" })),
    );
    expect(missing.success).toBe(false);

    const parsed = adminGuestFieldsSchema.parse(
      readAdminGuestFields(guestForm({ hasAllergies: "true", allergies: "  Maní y mariscos  " })),
    );
    expect(parsed).toMatchObject({ hasAllergies: true, allergies: "Maní y mariscos" });
  });

  it("reads checkbox, repeated replacement ids, and optional payment note exactly", () => {
    const formData = guestForm({ sendMessage: "on" });
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    formData.append("expectedPromotedEntryIds", first);
    formData.append("expectedPromotedEntryIds", second);

    expect(readSendMessage(formData)).toBe(true);
    expect(
      expectedPromotedEntryIdsSchema.parse(formData.getAll("expectedPromotedEntryIds")),
    ).toEqual([first, second]);
    expect(paymentNoteSchema.parse("  Transferencia  ")).toBe("Transferencia");
    expect(paymentNoteSchema.parse(null)).toBeNull();
    expect(paymentNoteSchema.safeParse("Pago\u0007manual").success).toBe(false);
    expect(paymentNoteSchema.safeParse(`Pago${String.fromCharCode(9)}manual`).success).toBe(false);
    expect(paymentNoteSchema.safeParse(`Pago${String.fromCharCode(10)}manual`).success).toBe(false);
    expect(expectedCancellationStageSchema.parse("ON_LIST")).toBe("ON_LIST");
    expect(expectedCancellationStageSchema.parse("PAID")).toBe("PAID");
    expect(expectedCancellationStageSchema.safeParse("IN_REVIEW").success).toBe(false);
    expect(expectedCancellationStageSchema.safeParse(null).success).toBe(false);
    expect(readSendMessage(guestForm())).toBe(false);
  });
});
