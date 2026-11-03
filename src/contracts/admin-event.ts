import { z } from "zod";

import { parseDrinkPriceCents } from "@/domain/drink/drink-price";
import { mapProviderOf } from "@/domain/event/map-links";

// Number("") is 0, which would silently turn an empty field into "waitlist off".
export function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return Number(value);
}

export function readCreateEventFormData(formData: FormData) {
  return {
    internalName: formData.get("internalName"),
    slug: formData.get("slug"),
    eventDate: formData.get("eventDate"),
    eventTime: formData.get("eventTime"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    openNow: formData.get("openNow") === "1",
    capacity: optionalNumber(formData.get("capacity")),
    maxPartySize: optionalNumber(formData.get("maxPartySize")),
    autoCloseOnFull: formData.get("autoCloseOnFull") === "on",
    waitlistCapacity: optionalNumber(formData.get("waitlistCapacity")),
    paymentInstructions: formData.get("paymentInstructions"),
    price: formData.get("price"),
    status: formData.get("status"),
    locationName: formData.get("locationName"),
    locationAddress: formData.get("locationAddress"),
    locationMapsUrl: formData.get("locationMapsUrl"),
    locationWazeUrl: formData.get("locationWazeUrl"),
    locationNotes: formData.get("locationNotes"),
    locationStatus: formData.get("locationStatus"),
  };
}

const localDate = z
  .string({ error: "La fecha es obligatoria." })
  .min(1, "La fecha del evento es obligatoria.")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.");
const localTime = z
  .string({ error: "La hora es obligatoria." })
  .min(1, "La hora del evento es obligatoria.")
  .regex(/^\d{2}:\d{2}$/, "Usa el formato HH:mm.");
const localDateTime = (requiredMessage: string) =>
  z
    .string({ error: requiredMessage })
    .min(1, requiredMessage)
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Usa el formato AAAA-MM-DDTHH:mm.");
const slug = z
  .string({ error: "El slug es obligatorio." })
  .trim()
  .min(1, "El slug es obligatorio.")
  .max(80, "El slug no puede superar 80 caracteres.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "El slug no tiene un formato válido.");

const PRICE_REQUIRED_MESSAGE = "El precio por persona es obligatorio.";
const PRICE_INVALID_MESSAGE = "Escribe el precio con números, por ejemplo 25.00.";

const pricePerPerson = z
  .string({ error: PRICE_REQUIRED_MESSAGE })
  .trim()
  .superRefine((value, context) => {
    if (value === "") {
      context.addIssue({ code: "custom", message: PRICE_REQUIRED_MESSAGE });
    } else if (parseDrinkPriceCents(value) === null) {
      context.addIssue({ code: "custom", message: PRICE_INVALID_MESSAGE });
    }
  })
  .transform((value) => parseDrinkPriceCents(value)!);

const optionalPricePerPerson = z.preprocess(
  (value) =>
    value === null || (typeof value === "string" && value.trim() === "") ? undefined : value,
  pricePerPerson.optional(),
);

function isSecureMapUrl(value: string): boolean {
  // WHATWG parsing treats a backslash as a slash, but other consumers do not; refuse the ambiguity.
  if (value.includes("\\")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;

  return true;
}

export function isAllowedGoogleMapsUrl(value: string): boolean {
  return isSecureMapUrl(value) && mapProviderOf(value) === "GOOGLE_MAPS";
}

function nullableTrimmedText(max: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().min(1).max(max).nullable(),
  );
}

const locationFields = {
  locationName: nullableTrimmedText(120),
  locationAddress: nullableTrimmedText(300),
  locationMapsUrl: nullableTrimmedText(2048)
    .superRefine((value, context) => {
      if (value === null || isAllowedGoogleMapsUrl(value)) return;
      context.addIssue({
        code: "custom",
        message:
          mapProviderOf(value) === "WAZE"
            ? "Este enlace es de Waze: pégalo en el campo de Waze."
            : "Este enlace no es de Google Maps.",
      });
    })
    .transform((value) => (value === null ? null : new URL(value).href)),
  locationWazeUrl: nullableTrimmedText(2048)
    .superRefine((value, context) => {
      if (value === null || (isSecureMapUrl(value) && mapProviderOf(value) === "WAZE")) return;
      context.addIssue({
        code: "custom",
        message:
          mapProviderOf(value) === "GOOGLE_MAPS"
            ? "Este enlace es de Google Maps: pégalo en el campo de Google Maps."
            : "Este enlace no es de Waze.",
      });
    })
    .transform((value) => (value === null ? null : new URL(value).href))
    .optional(),
  locationNotes: nullableTrimmedText(1000),
  locationStatus: z.enum(["PENDING", "CONFIRMED"]),
};

const eventFields = {
  internalName: z
    .string({ error: "El nombre interno es obligatorio." })
    .trim()
    .min(1, "El nombre interno es obligatorio.")
    .max(120, "El nombre interno no puede superar 120 caracteres."),
  slug,
  eventDate: localDate,
  eventTime: localTime,
  opensAt: localDateTime("La fecha de apertura es obligatoria."),
  closesAt: localDateTime("La fecha de cierre es obligatoria."),
  openNow: z.boolean({ error: "La apertura inmediata debe ser verdadera o falsa." }),
  capacity: z
    .number({ error: "La capacidad debe ser un número." })
    .int("La capacidad debe ser un número entero.")
    .positive("La capacidad debe ser mayor que cero."),
  maxPartySize: z.union([z.literal(1), z.literal(2)], {
    error: "Máximo 2 personas por solicitud.",
  }),
  autoCloseOnFull: z.boolean({ error: "El cierre automático debe ser verdadero o falso." }),
  waitlistCapacity: z
    .number({ error: "Los lugares en cola deben ser un número." })
    .int("Los lugares en cola deben ser un número entero.")
    .min(0, "Los lugares en cola no pueden ser negativos.")
    .max(50, "Los lugares en cola no pueden superar 50."),
  paymentInstructions: nullableTrimmedText(600),
  ...locationFields,
};

export const createAdminEventSchema = z
  .object({
    ...eventFields,
    price: pricePerPerson,
    status: z.enum(["DRAFT", "SCHEDULED"], {
      error: "El estado debe ser DRAFT o SCHEDULED.",
    }),
  })
  .strict()
  .refine((value) => value.maxPartySize <= value.capacity, {
    path: ["maxPartySize"],
    message: "El tamaño máximo del grupo no puede superar la capacidad.",
  })
  .transform(({ price, ...input }) => ({ ...input, priceCents: price }));

export const updateAdminEventSchema = z
  .object({
    internalName: eventFields.internalName,
    slug: eventFields.slug,
    eventDate: eventFields.eventDate,
    eventTime: eventFields.eventTime,
    opensAt: eventFields.opensAt,
    closesAt: eventFields.closesAt,
    openNow: eventFields.openNow,
    maxPartySize: eventFields.maxPartySize,
    autoCloseOnFull: eventFields.autoCloseOnFull,
    paymentInstructions: eventFields.paymentInstructions.optional(),
    price: optionalPricePerPerson,
    ...locationFields,
    keepMapsUrl: z.boolean(),
    locationRevision: z.string().regex(/^\d+$/).transform(Number),
    locationStatusLoaded: z.enum(["PENDING", "CONFIRMED"]),
  })
  .strict()
  .transform(({ price, ...input }) => ({ ...input, priceCents: price }));

export const reopenEventSchema = z.object({
  closesAt: localDateTime("Elige hasta cuándo estará abierta."),
});

export const changeWaitlistCapacitySchema = z
  .object({
    id: z.string().uuid("El identificador no es válido."),
    waitlistCapacity: eventFields.waitlistCapacity,
  })
  .strict();

export type CreateAdminEventInput = z.output<typeof createAdminEventSchema>;
export type UpdateAdminEventInput = z.output<typeof updateAdminEventSchema>;
