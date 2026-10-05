import { isIP } from "node:net";

import { env, type ServerEnv } from "../config/env";

type AppEnvironment = ServerEnv["APP_ENV"];

function expandEmbeddedIpv4(address: string): string {
  const lastColon = address.lastIndexOf(":");
  const ipv4 = address.slice(lastColon + 1);

  if (isIP(ipv4) !== 4) {
    return address;
  }

  const octets = ipv4.split(".").map(Number);
  const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
  const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
  return `${address.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
}

function collapseIpv6To64(address: string): string {
  const expandedAddress = expandEmbeddedIpv4(address);
  const [left = "", right = ""] = expandedAddress.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const omittedCount = 8 - leftParts.length - rightParts.length;
  const parts = expandedAddress.includes("::")
    ? [...leftParts, ...Array.from({ length: omittedCount }, () => "0"), ...rightParts]
    : leftParts;
  const prefix = parts.slice(0, 4).map((part) => Number.parseInt(part, 16).toString(16));

  return `${prefix.join(":")}::/64`;
}

export function getClientIp(
  headers: Pick<Headers, "get">,
  appEnvironment: AppEnvironment = env.APP_ENV,
): string {
  if (appEnvironment !== "preview" && appEnvironment !== "production") {
    return "local";
  }

  const firstForwardedAddress = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();

  if (!firstForwardedAddress) {
    return "unknown";
  }

  const ipVersion = isIP(firstForwardedAddress);

  if (ipVersion === 4) {
    return firstForwardedAddress;
  }

  if (ipVersion === 6) {
    return collapseIpv6To64(firstForwardedAddress);
  }

  return "unknown";
}
