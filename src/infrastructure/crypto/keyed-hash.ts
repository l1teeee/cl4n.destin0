import { createHmac } from "node:crypto";

import { env } from "../config/env";

export function keyedHash(value: string): string {
  return createHmac("sha256", env.APP_SECRET).update(value).digest("hex");
}
