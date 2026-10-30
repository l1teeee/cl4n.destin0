import { randomInt } from "node:crypto";

import { isLinkCode, LINK_CODE_ALPHABET, LINK_CODE_LENGTH } from "@/domain/messaging/link-code";

export function generateLinkCode(): string {
  for (;;) {
    let code = "";
    for (let index = 0; index < LINK_CODE_LENGTH; index += 1) {
      code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)]!;
    }
    if (isLinkCode(code)) {
      return code;
    }
  }
}
