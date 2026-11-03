import { describe, expect, it } from "vitest";

import {
  changeWaitlistCapacitySchema,
  createAdminEventSchema,
  readCreateEventFormData,
  updateAdminEventSchema,
} from "@/contracts/admin-event";
import {
  formatUtcForElSalvador,
  localDateTimeToUtc,
  localEventDateTimeToUtc,
} from "@/infrastructure/time/el-salvador-time";

const validCreate = {
  internalName: "Cena de noviembre",
  slug: "cena-noviembre",
  eventDate: "2026-11-20",
  eventTime: "19:30",
  opensAt: "2026-11-01T08:00",
  closesAt: "2026-11-19T20:00",
  openNow: false,
  capacity: 20,
  maxPartySize: 2,
  autoCloseOnFull: false,
  waitlistCapacity: 5,
  paymentInstructions: null,
  price: "25.00",
  status: "DRAFT",
  locationName: null,
  locationAddress: null,
  locationMapsUrl: null,
  locationNotes: null,
  locationStatus: "PENDING",
} as const;

describe("admin event contracts", () => {
  it("accepts Waze links, trims them and reads the field from a form", () => {
    const form = new FormData();
    form.set("locationWazeUrl", "https://waze.com/ul");
    expect(readCreateEventFormData(form).locationWazeUrl).toBe("https://waze.com/ul");
    expect(
      createAdminEventSchema.parse({
        ...validCreate,
        locationWazeUrl: "  https://waze.com/ul  ",
      }).locationWazeUrl,
    ).toBe("https://waze.com/ul");
    expect(
      createAdminEventSchema.parse({ ...validCreate, locationWazeUrl: "  " }).locationWazeUrl,
    ).toBeNull();
  });

  it.each([
    [
      "locationMapsUrl",
      "https://waze.com/ul",
      "Este enlace es de Waze: pégalo en el campo de Waze.",
    ],
    ["locationMapsUrl", "https://example.com/maps", "Este enlace no es de Google Maps."],
    [
      "locationWazeUrl",
      "https://google.com/maps",
      "Este enlace es de Google Maps: pégalo en el campo de Google Maps.",
    ],
    ["locationWazeUrl", "https://example.com/ul", "Este enlace no es de Waze."],
  ])("explains a misplaced link in %s", (field, url, message) => {
    const result = createAdminEventSchema.safeParse({ ...validCreate, [field]: url });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid link");
    expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [field], message }));
  });

  it.each([
    "http://waze.com/ul",
    "https://user@waze.com/ul",
    "https://waze.com:444/ul",
    "https://waze.com/\\ul",
    `https://waze.com/ul?q=${"a".repeat(2048)}`,
  ])("rejects unsafe or oversized Waze links: %s", (locationWazeUrl) => {
    expect(createAdminEventSchema.safeParse({ ...validCreate, locationWazeUrl }).success).toBe(
      false,
    );
  });

  it("reads create form numbers, empty values, and checkboxes", () => {
    const formData = new FormData();
    for (const [field, value] of Object.entries({
      internalName: "Cena",
      slug: "cena",
      eventDate: "2026-11-20",
      eventTime: "19:30",
      opensAt: "2026-11-01T08:00",
      closesAt: "2026-11-19T20:00",
      capacity: "20",
      maxPartySize: "",
      waitlistCapacity: "5",
      paymentInstructions: "",
      price: "25.00",
      openNow: "1",
      status: "DRAFT",
      locationName: "",
      locationAddress: "",
      locationMapsUrl: "",
      locationNotes: "",
      locationStatus: "PENDING",
      autoCloseOnFull: "on",
    })) {
      formData.set(field, value);
    }

    expect(readCreateEventFormData(formData)).toMatchObject({
      capacity: 20,
      maxPartySize: undefined,
      waitlistCapacity: 5,
      autoCloseOnFull: true,
      paymentInstructions: "",
      price: "25.00",
      openNow: true,
    });
    formData.delete("openNow");
    expect(readCreateEventFormData(formData).openNow).toBe(false);
  });

  it("accepts strict create and update inputs", () => {
    const { price, ...createWithoutPrice } = validCreate;
    void price;
    expect(createAdminEventSchema.parse(validCreate)).toEqual({
      ...createWithoutPrice,
      priceCents: 2500,
    });
    const update = {
      internalName: validCreate.internalName,
      slug: validCreate.slug,
      eventDate: validCreate.eventDate,
      eventTime: validCreate.eventTime,
      opensAt: validCreate.opensAt,
      closesAt: validCreate.closesAt,
      openNow: validCreate.openNow,
      maxPartySize: validCreate.maxPartySize,
      autoCloseOnFull: validCreate.autoCloseOnFull,
      paymentInstructions: validCreate.paymentInstructions,
      locationName: validCreate.locationName,
      locationAddress: validCreate.locationAddress,
      locationMapsUrl: validCreate.locationMapsUrl,
      locationNotes: validCreate.locationNotes,
      locationStatus: validCreate.locationStatus,
      keepMapsUrl: false,
      locationRevision: "3",
      locationStatusLoaded: "PENDING",
    };
    expect(updateAdminEventSchema.parse(update)).toEqual({ ...update, locationRevision: 3 });
    expect(updateAdminEventSchema.parse({ ...update, price: "30" })).toMatchObject({
      priceCents: 3000,
    });
    expect(updateAdminEventSchema.safeParse({ ...update, locationRevision: "-1" }).success).toBe(
      false,
    );
    const { locationRevision: _omitted, ...withoutRevision } = update;
    void _omitted;
    expect(updateAdminEventSchema.safeParse(withoutRevision).success).toBe(false);
  });

  it("trims location values and stores empty strings as null", () => {
    const parsed = createAdminEventSchema.parse({
      ...validCreate,
      locationName: "  Casa  ",
      locationAddress: "   ",
      locationMapsUrl: "",
      locationNotes: "  Entrada lateral  ",
    });
    expect(parsed).toMatchObject({
      locationName: "Casa",
      locationAddress: null,
      locationMapsUrl: null,
      locationNotes: "Entrada lateral",
    });
  });

  it("rejects unknown fields and max party size above capacity", () => {
    expect(createAdminEventSchema.safeParse({ ...validCreate, eventId: "client" }).success).toBe(
      false,
    );
    expect(
      createAdminEventSchema.safeParse({ ...validCreate, capacity: 1, maxPartySize: 2 }).success,
    ).toBe(false);
    const tooLarge = createAdminEventSchema.safeParse({ ...validCreate, maxPartySize: 3 });
    expect(tooLarge.success).toBe(false);
    if (!tooLarge.success) {
      expect(tooLarge.error.issues.find((issue) => issue.path[0] === "maxPartySize")?.message).toBe(
        "Máximo 2 personas por solicitud.",
      );
    }
  });

  it("requires a valid price per person on create and keeps it optional on update", () => {
    const priceError = (price: unknown) => {
      const result = createAdminEventSchema.safeParse({ ...validCreate, price });
      return result.success
        ? null
        : result.error.issues.find((issue) => issue.path[0] === "price")?.message;
    };

    expect(priceError("")).toBe("El precio por persona es obligatorio.");
    expect(priceError(undefined)).toBe("El precio por persona es obligatorio.");
    expect(priceError("abc")).toBe("Escribe el precio con números, por ejemplo 25.00.");
    expect(priceError("0")).toBeNull();
    expect(createAdminEventSchema.parse({ ...validCreate, price: "12,5" }).priceCents).toBe(1250);

    const update = {
      internalName: validCreate.internalName,
      slug: validCreate.slug,
      eventDate: validCreate.eventDate,
      eventTime: validCreate.eventTime,
      opensAt: validCreate.opensAt,
      closesAt: validCreate.closesAt,
      openNow: false,
      maxPartySize: validCreate.maxPartySize,
      autoCloseOnFull: validCreate.autoCloseOnFull,
      locationName: null,
      locationAddress: null,
      locationMapsUrl: null,
      locationNotes: null,
      locationStatus: "PENDING",
      keepMapsUrl: false,
      locationRevision: "0",
      locationStatusLoaded: "PENDING",
    };
    expect(updateAdminEventSchema.parse({ ...update, price: "" }).priceCents).toBeUndefined();
    expect(updateAdminEventSchema.parse({ ...update, price: null }).priceCents).toBeUndefined();
    expect(updateAdminEventSchema.safeParse({ ...update, price: "abc" }).success).toBe(false);
  });

  it("trims optional payment instructions and enforces 600 characters", () => {
    expect(
      createAdminEventSchema.parse({
        ...validCreate,
        paymentInstructions: "  Transferir a la cuenta indicada  ",
      }).paymentInstructions,
    ).toBe("Transferir a la cuenta indicada");
    expect(
      createAdminEventSchema.safeParse({
        ...validCreate,
        paymentInstructions: "x".repeat(601),
      }).success,
    ).toBe(false);
  });

  it.each([
    ["eventDate", "La fecha del evento es obligatoria."],
    ["eventTime", "La hora del evento es obligatoria."],
    ["opensAt", "La fecha de apertura es obligatoria."],
    ["closesAt", "La fecha de cierre es obligatoria."],
  ] as const)("reports the required message for %s", (field, message) => {
    const result = createAdminEventSchema.safeParse({ ...validCreate, [field]: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.find((issue) => issue.path[0] === field)?.message).toBe(message);
    }
  });
});

describe("waitlist capacity contract", () => {
  it.each([0, 5, 50])("accepts %i queue places", (waitlistCapacity) => {
    expect(createAdminEventSchema.safeParse({ ...validCreate, waitlistCapacity }).success).toBe(
      true,
    );
  });

  it.each([-1, 51, 2.5, Number.NaN])("rejects %s queue places", (waitlistCapacity) => {
    expect(createAdminEventSchema.safeParse({ ...validCreate, waitlistCapacity }).success).toBe(
      false,
    );
  });

  it("reports a missing queue size on the waitlist capacity field", () => {
    const result = createAdminEventSchema.safeParse({
      ...validCreate,
      waitlistCapacity: undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "waitlistCapacity")).toBe(true);
    }
  });

  it("applies the same bounds to the quick action input", () => {
    const id = "00000000-0000-4000-8000-000000000001";

    expect(changeWaitlistCapacitySchema.safeParse({ id, waitlistCapacity: 0 }).success).toBe(true);
    expect(changeWaitlistCapacitySchema.safeParse({ id, waitlistCapacity: 50 }).success).toBe(true);
    expect(changeWaitlistCapacitySchema.safeParse({ id, waitlistCapacity: -1 }).success).toBe(
      false,
    );
    expect(changeWaitlistCapacitySchema.safeParse({ id, waitlistCapacity: 51 }).success).toBe(
      false,
    );
  });

  it("requires the queue size on update", () => {
    const { waitlistCapacity, ...withoutQueue } = validCreate;
    void waitlistCapacity;
    const update = {
      internalName: withoutQueue.internalName,
      slug: withoutQueue.slug,
      eventDate: withoutQueue.eventDate,
      eventTime: withoutQueue.eventTime,
      opensAt: withoutQueue.opensAt,
      closesAt: withoutQueue.closesAt,
      maxPartySize: withoutQueue.maxPartySize,
      autoCloseOnFull: withoutQueue.autoCloseOnFull,
    };

    expect(updateAdminEventSchema.safeParse(update).success).toBe(false);
    expect(updateAdminEventSchema.safeParse({ ...update, waitlistCapacity: 5 }).success).toBe(
      false,
    );
  });
});

describe("El Salvador time conversion", () => {
  it("converts local event date and time to UTC and back", () => {
    const utc = localEventDateTimeToUtc("2026-11-20", "19:30");
    expect(utc.toISOString()).toBe("2026-11-21T01:30:00.000Z");
    expect(formatUtcForElSalvador(utc)).toBe("2026-11-20 19:30");
  });

  it("converts a local date-time field", () => {
    expect(localDateTimeToUtc("2026-11-20T19:30").toISOString()).toBe("2026-11-21T01:30:00.000Z");
  });

  it("rejects impossible calendar dates", () => {
    expect(() => localDateTimeToUtc("2026-02-30T19:30")).toThrow(/inválid/i);
  });
});
