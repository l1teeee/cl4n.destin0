import { describe, expect, it } from "vitest";

import {
  changeWaitlistCapacitySchema,
  createAdminEventSchema,
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
  capacity: 20,
  maxPartySize: 2,
  autoCloseOnFull: false,
  waitlistCapacity: 5,
  status: "DRAFT",
  locationName: null,
  locationAddress: null,
  locationMapsUrl: null,
  locationNotes: null,
  locationStatus: "PENDING",
} as const;

describe("admin event contracts", () => {
  it("accepts strict create and update inputs", () => {
    expect(createAdminEventSchema.parse(validCreate)).toEqual(validCreate);
    const update = {
      internalName: validCreate.internalName,
      slug: validCreate.slug,
      eventDate: validCreate.eventDate,
      eventTime: validCreate.eventTime,
      opensAt: validCreate.opensAt,
      closesAt: validCreate.closesAt,
      maxPartySize: validCreate.maxPartySize,
      autoCloseOnFull: validCreate.autoCloseOnFull,
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
