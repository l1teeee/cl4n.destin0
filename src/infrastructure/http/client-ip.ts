import { isIP } from "node:net";

import { env, type ServerEnv } from "../config/env";

type AppEnvironment = ServerEnv["APP_ENV"];

function mappedIpv4(address: string): string | null {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const candidate = match?.[1];
  return candidate && isIP(candidate) === 4 ? candidate : null;
}

function collapseIpv6To64(address: string): string {
  const [left = "", right = ""] = address.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const omittedCount = 8 - leftParts.length - rightParts.length;
  const parts = address.includes("::")
    ? [...leftParts, ...Array.from({ length: omittedCount }, () => "0"), ...rightParts]
    : leftParts;
  const prefix = parts.slice(0, 4).map((part) => Number.parseInt(part, 16).toString(16));

  return `${prefix.join(":")}::/64`;
}

export function getRawClientIp(
  headers: Pick<Headers, "get">,
  appEnvironment: AppEnvironment = env.APP_ENV,
): string | null {
  if (appEnvironment !== "preview" && appEnvironment !== "production") {
    return null;
  }

  const firstForwardedAddress = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();

  if (!firstForwardedAddress) {
    return null;
  }

  const ipVersion = isIP(firstForwardedAddress);

  if (ipVersion === 4) {
    return firstForwardedAddress;
  }

  if (ipVersion === 6) {
    return mappedIpv4(firstForwardedAddress) ?? firstForwardedAddress;
  }

  return null;
}

export function getRateLimitSubject(clientIp: string | null): string {
  if (!clientIp) {
    return "unknown";
  }

  const ipv4 = mappedIpv4(clientIp);
  if (ipv4) {
    return ipv4;
  }

  const ipVersion = isIP(clientIp);
  if (ipVersion === 4) {
    return clientIp;
  }

  if (ipVersion === 6) {
    return collapseIpv6To64(clientIp);
  }

  return "unknown";
}
