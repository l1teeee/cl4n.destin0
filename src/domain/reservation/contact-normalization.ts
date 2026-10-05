import { parsePhoneNumberFromString } from "libphonenumber-js";

export type NormalizationResult =
  { ok: true; value: string } | { ok: false; reason: "EMPTY" | "INVALID_FORMAT" };

function normalizedValue(value: string): NormalizationResult {
  if (!value) {
    return { ok: false, reason: "EMPTY" };
  }

  return { ok: true, value };
}

export function normalizeEmail(email: string): NormalizationResult {
  return normalizedValue(email.trim().toLowerCase());
}

export function normalizeInstagram(instagram: string): NormalizationResult {
  const handle = instagram.trim().replace(/^@/, "").toLowerCase();

  if (!handle) {
    return { ok: false, reason: "EMPTY" };
  }

  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    return { ok: false, reason: "INVALID_FORMAT" };
  }

  return { ok: true, value: handle };
}

export function normalizePhone(phone: string): NormalizationResult {
  const input = phone.trim();

  if (!input) {
    return { ok: false, reason: "EMPTY" };
  }

  const parsed = parsePhoneNumberFromString(input, "SV");

  if (!parsed?.isValid()) {
    return { ok: false, reason: "INVALID_FORMAT" };
  }

  return { ok: true, value: parsed.number };
}
