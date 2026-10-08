import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AttemptOutcome {
  status: number;
  code?: ReservationErrorCode;
}

export type KeyFactory = () => string;

function storageKey(eventSlug: string): string {
  return `cl4n:idem:${eventSlug}`;
}

export function getOrCreateAttemptKey(
  storage: KeyStorage,
  eventSlug: string,
  createKey: KeyFactory,
): string {
  const key = storage.getItem(storageKey(eventSlug));
  if (key) {
    return key;
  }

  return rotateAttemptKey(storage, eventSlug, createKey);
}

export function rotateAttemptKey(
  storage: KeyStorage,
  eventSlug: string,
  createKey: KeyFactory,
): string {
  const key = createKey();
  storage.setItem(storageKey(eventSlug), key);
  return key;
}

export function shouldRotateAttemptKey(outcome: AttemptOutcome): boolean {
  if (outcome.status === 201 || outcome.status === 202) {
    return true;
  }

  if (outcome.status < 400 || outcome.status >= 500) {
    return false;
  }

  if (outcome.status === 403 || outcome.status === 429) {
    return false;
  }

  return !(outcome.status === 422 && outcome.code === "VALIDATION_FAILED");
}
