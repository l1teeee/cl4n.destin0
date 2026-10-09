import { z } from "zod";

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

const mapsUrlMessage =
  "Pega un enlace de Google Maps (https://maps.app.goo.gl/... o https://www.google.com/maps/...).";

const pathPrefixedMapsHosts = new Set([
  "goo.gl",
  "google.com",
  "www.google.com",
  "google.com.sv",
  "www.google.com.sv",
]);

export function isAllowedGoogleMapsUrl(value: string): boolean {
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

  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl" || host === "maps.google.com") return true;
  return pathPrefixedMapsHosts.has(host) && url.pathname.startsWith("/maps");
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
    .refine((value) => value === null || isAllowedGoogleMapsUrl(value), mapsUrlMessage)
    .transform((value) => (value === null ? null : new URL(value).href)),
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
  capacity: z
    .number({ error: "La capacidad debe ser un número." })
    .int("La capacidad debe ser un número entero.")
    .positive("La capacidad debe ser mayor que cero."),
  maxPartySize: z
    .number({ error: "El tamaño máximo del grupo debe ser un número." })
    .int("El tamaño máximo del grupo debe ser un número entero.")
    .positive("El tamaño máximo del grupo debe ser mayor que cero."),
  autoCloseOnFull: z.boolean({ error: "El cierre automático debe ser verdadero o falso." }),
  waitlistCapacity: z
    .number({ error: "Los lugares en cola deben ser un número." })
    .int("Los lugares en cola deben ser un número entero.")
    .min(0, "Los lugares en cola no pueden ser negativos.")
    .max(50, "Los lugares en cola no pueden superar 50."),
  ...locationFields,
};

export const createAdminEventSchema = z
  .object({
    ...eventFields,
    status: z.enum(["DRAFT", "SCHEDULED"], {
      error: "El estado debe ser DRAFT o SCHEDULED.",
    }),
  })
  .strict()
  .refine((value) => value.maxPartySize <= value.capacity, {
    path: ["maxPartySize"],
    message: "El tamaño máximo del grupo no puede superar la capacidad.",
  });

export const updateAdminEventSchema = z
  .object({
    internalName: eventFields.internalName,
    slug: eventFields.slug,
    eventDate: eventFields.eventDate,
    eventTime: eventFields.eventTime,
    opensAt: eventFields.opensAt,
    closesAt: eventFields.closesAt,
    maxPartySize: eventFields.maxPartySize,
    autoCloseOnFull: eventFields.autoCloseOnFull,
    waitlistCapacity: eventFields.waitlistCapacity,
    ...locationFields,
    locationRevision: z.string().regex(/^\d+$/).transform(Number),
    locationStatusLoaded: z.enum(["PENDING", "CONFIRMED"]),
  })
  .strict();

export const changeWaitlistCapacitySchema = z
  .object({
    id: z.string().uuid("El identificador no es válido."),
    waitlistCapacity: eventFields.waitlistCapacity,
  })
  .strict();

export type CreateAdminEventInput = z.output<typeof createAdminEventSchema>;
export type UpdateAdminEventInput = z.output<typeof updateAdminEventSchema>;
