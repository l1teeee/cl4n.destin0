export function splitIntoChunks(text: string, maxBytes = 1000): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive integer");
  }

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (new TextEncoder().encode(remaining).byteLength <= maxBytes) {
      chunks.push(remaining);
      break;
    }

    let bytes = 0;
    let limitIndex = 0;
    let whitespaceIndex = -1;
    for (const character of remaining) {
      const nextBytes = new TextEncoder().encode(character).byteLength;
      if (bytes + nextBytes > maxBytes) break;
      bytes += nextBytes;
      limitIndex += character.length;
      if (/\s/u.test(character)) whitespaceIndex = limitIndex - character.length;
    }

    const cutIndex = whitespaceIndex > 0 ? whitespaceIndex : limitIndex;
    const chunk = remaining.slice(0, cutIndex).trimEnd();
    if (chunk.length > 0) chunks.push(chunk);
    remaining = remaining.slice(cutIndex).trimStart();
  }

  return chunks;
}
