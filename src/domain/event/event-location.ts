import { mapProviderOf } from "./map-links";

export type EventLocationStatus = "PENDING" | "CONFIRMED";

export interface EventLocationConfirmationInput {
  address: string | null;
  mapsUrl: string | null;
  status: EventLocationStatus;
}

export function isEventLocationConfirmationValid(
  location: EventLocationConfirmationInput,
): boolean {
  return location.status === "PENDING" || location.address !== null || location.mapsUrl !== null;
}

export interface MapsLinkState {
  address: string | null;
  mapsUrl: string | null;
}

export type MapsLinkReconciliation =
  { mapsUrl: string | null; mapsUrlCleared: false } | { mapsUrl: null; mapsUrlCleared: true };

function normalizeAddress(address: string | null): string | null {
  if (address === null) return null;
  return address.trim().replace(/\s+/g, " ");
}

export function normalizeMapsUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

// An address edit that leaves the old Maps link untouched would send guests to the previous place.
export function reconcileMapsLink(
  previous: MapsLinkState,
  next: MapsLinkState,
  keepMapsUrl: boolean,
): MapsLinkReconciliation {
  const addressChanged = normalizeAddress(previous.address) !== normalizeAddress(next.address);
  const mapsUrlUntouched =
    previous.mapsUrl !== null &&
    next.mapsUrl !== null &&
    normalizeMapsUrl(next.mapsUrl) === normalizeMapsUrl(previous.mapsUrl);
  if (addressChanged && mapsUrlUntouched && !keepMapsUrl) {
    return { mapsUrl: null, mapsUrlCleared: true };
  }
  return { mapsUrl: next.mapsUrl, mapsUrlCleared: false };
}

export interface MapsCoordinates {
  latitude: number;
  longitude: number;
}

const coordinatePair = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const pinPattern = new RegExp(`!3d${coordinatePair}!4d${coordinatePair}`);
const viewportPattern = new RegExp(`@${coordinatePair},${coordinatePair}`);
const coordinateValuePattern = new RegExp(String.raw`^${coordinatePair},\s*${coordinatePair}$`);
const coordinateQueryParams = ["q", "query", "ll", "center", "destination"];

function toCoordinates(latitudeText: string, longitudeText: string): MapsCoordinates | null {
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function coordinatesFromMatch(match: RegExpMatchArray | null): MapsCoordinates | null {
  if (match === null) return null;
  return toCoordinates(match[1]!, match[2]!);
}

// `!3d!4d` is the place pin; `@` is only the viewport the map was centered on when shared.
export function parseMapsCoordinates(value: string): MapsCoordinates | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (mapProviderOf(value) === "WAZE") return parseWazeCoordinates(url);

  const decodedPath = decodeURIComponentSafely(url.pathname);
  const pin = coordinatesFromMatch(decodedPath.match(pinPattern));
  if (pin) return pin;

  const viewport = coordinatesFromMatch(decodedPath.match(viewportPattern));
  if (viewport) return viewport;

  for (const name of coordinateQueryParams) {
    const queryValue = url.searchParams.get(name);
    if (queryValue === null) continue;
    const fromQuery = coordinatesFromMatch(queryValue.trim().match(coordinateValuePattern));
    if (fromQuery) return fromQuery;
  }
  return null;
}

const wazeGeohashPathPattern = /^\/ul\/h([0-9bcdefghjkmnpqrstuvwxyz]{1,12})\/?$/;
const wazeDestinationPrefix = "ll.";
const geohashAlphabet = "0123456789bcdefghjkmnpqrstuvwxyz";

// Waze shares a place as `ll=lat,lng`, as `to=ll.lat,lng` or as a short `/ul/h<geohash>` path.
function parseWazeCoordinates(url: URL): MapsCoordinates | null {
  const fromLl = coordinatesFromMatch(
    (url.searchParams.get("ll") ?? "").trim().match(coordinateValuePattern),
  );
  if (fromLl) return fromLl;

  const destination = (url.searchParams.get("to") ?? "").trim();
  if (destination.startsWith(wazeDestinationPrefix)) {
    const fromDestination = coordinatesFromMatch(
      destination.slice(wazeDestinationPrefix.length).match(coordinateValuePattern),
    );
    if (fromDestination) return fromDestination;
  }

  const geohash = url.pathname.match(wazeGeohashPathPattern)?.[1];
  return geohash === undefined ? null : decodeGeohash(geohash);
}

// Each geohash character carries 5 bits that alternately halve the longitude and latitude ranges.
function decodeGeohash(geohash: string): MapsCoordinates | null {
  let latitudeRange = [-90, 90];
  let longitudeRange = [-180, 180];
  let isLongitudeBit = true;
  for (const character of geohash) {
    const value = geohashAlphabet.indexOf(character);
    for (let bit = 4; bit >= 0; bit -= 1) {
      const range = isLongitudeBit ? longitudeRange : latitudeRange;
      const middle = (range[0]! + range[1]!) / 2;
      const upperHalf = ((value >> bit) & 1) === 1;
      const narrowed = upperHalf ? [middle, range[1]!] : [range[0]!, middle];
      if (isLongitudeBit) longitudeRange = narrowed;
      else latitudeRange = narrowed;
      isLongitudeBit = !isLongitudeBit;
    }
  }
  const latitude = (latitudeRange[0]! + latitudeRange[1]!) / 2;
  const longitude = (longitudeRange[0]! + longitudeRange[1]!) / 2;
  return toCoordinates(String(latitude), String(longitude));
}

function decodeURIComponentSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export interface StoredCoordinatesChoice {
  previousMapsUrl: string | null;
  previousCoordinates: MapsCoordinates | null;
  nextMapsUrl: string | null;
  resolvedCoordinates: MapsCoordinates | null;
}

export function chooseStoredCoordinates(choice: StoredCoordinatesChoice): MapsCoordinates | null {
  if (choice.nextMapsUrl === null) return null;
  const linkUnchanged =
    choice.previousMapsUrl !== null &&
    normalizeMapsUrl(choice.nextMapsUrl) === normalizeMapsUrl(choice.previousMapsUrl);
  if (linkUnchanged && choice.resolvedCoordinates === null) return choice.previousCoordinates;
  return choice.resolvedCoordinates;
}
