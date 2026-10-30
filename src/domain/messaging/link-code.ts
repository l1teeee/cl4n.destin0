export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 6;

const linkCodePattern = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);
const standaloneTokenPattern = /(?<![A-Z0-9])[A-Z0-9]{6}(?![A-Z0-9])/g;

export function isLinkCode(value: string): boolean {
  if (!linkCodePattern.test(value)) {
    return false;
  }

  return (value.match(/\d/g)?.length ?? 0) >= 2;
}

export function extractLinkCode(text: string): string | null {
  for (const match of text.toUpperCase().matchAll(standaloneTokenPattern)) {
    if (isLinkCode(match[0])) {
      return match[0];
    }
  }

  return null;
}
