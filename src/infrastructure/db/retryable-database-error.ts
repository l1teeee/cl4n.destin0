interface DatabaseError {
  code?: string;
}

const retryableDatabaseCodes = new Set([
  "55P03",
  "57014",
  "40P01",
  "40001",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
]);

export function retryableDatabaseErrorCode(error: unknown): string | null {
  const details = typeof error === "object" && error !== null ? (error as DatabaseError) : {};
  if (details.code && retryableDatabaseCodes.has(details.code)) {
    return details.code;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("connection timeout") ||
    message.includes("timeout exceeded when trying to connect")
  ) {
    return "POOL_CONNECTION_TIMEOUT";
  }

  return null;
}
