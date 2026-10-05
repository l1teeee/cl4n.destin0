import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Pool } from "pg";

interface LoadSummary {
  requests: number;
  confirmed: number;
  fullRejected: number;
  otherOutcomes: number;
  reservedSeats: number;
  capacity: number;
  oversold: number;
  durationMs: number;
  invariantPassed: boolean;
}

function localDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const target = new URL(value);
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    throw new Error("Refusing to run the load test against a non-local database");
  }

  return target.toString();
}

function phoneFor(sequence: number): string {
  return `7${String(10_000_000 + sequence).slice(-7)}`;
}

function outcomeCode(body: Record<string, unknown>): string {
  if (body.status === "CONFIRMED") {
    return "CONFIRMED";
  }
  const error = body.error as { code?: string } | undefined;
  return error?.code ?? "UNKNOWN";
}

async function createEvent(pool: Pool, requests: number): Promise<{ id: string; slug: string }> {
  const slug = `load-${requests}-${randomUUID()}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size,
       opens_at, closes_at, status
     )
     VALUES (
       $1, $2, clock_timestamp() + INTERVAL '1 day', 20, 1,
       clock_timestamp() - INTERVAL '1 hour',
       clock_timestamp() + INTERVAL '1 hour', 'SCHEDULED'
     )
     RETURNING id`,
    [slug, `HTTP load test ${requests}`],
  );
  return { id: result.rows[0]!.id, slug };
}

async function runScenario(
  pool: Pool,
  baseUrl: string,
  requestCount: number,
  sequenceOffset: number,
): Promise<LoadSummary> {
  const event = await createEvent(pool, requestCount);
  const keys = Array.from({ length: requestCount }, () => randomUUID());
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedAt = performance.now();
  const pending = keys.map(async (key, index) => {
    const sequence = sequenceOffset + index;
    await barrier;
    const response = await fetch(`${baseUrl}/api/reservations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        eventSlug: event.slug,
        fullName: `Load Guest ${sequence}`,
        instagram: `load.${sequence}`,
        phone: phoneFor(sequence),
        email: `load.${sequence}@example.com`,
        partySize: 1,
        acceptTerms: true,
        turnstileToken: "load-test-disabled",
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, code: outcomeCode(body), key };
  });

  release();
  const responses = await Promise.all(pending);
  const durationMs = Math.round(performance.now() - startedAt);
  const eventState = await pool.query<{
    capacity: number;
    reserved_seats: number;
    last_reservation_number: number;
  }>("SELECT capacity, reserved_seats, last_reservation_number FROM events WHERE id = $1", [
    event.id,
  ]);
  const reservations = await pool.query<{
    status: string;
    party_size: number;
    reservation_number: number | null;
  }>(
    `SELECT status, party_size, reservation_number
       FROM reservations
      WHERE event_id = $1
      ORDER BY reservation_number NULLS LAST`,
    [event.id],
  );
  const duplicates = await pool.query(
    `SELECT 1 FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED'
      GROUP BY email_normalized HAVING COUNT(*) > 1
     UNION ALL
     SELECT 1 FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED'
      GROUP BY phone_e164 HAVING COUNT(*) > 1`,
    [event.id],
  );
  const nonRetryKeys = responses
    .filter((response) => response.code !== "TRY_AGAIN")
    .map((response) => response.key);
  const idempotency = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM idempotency_records WHERE key = ANY($1::uuid[])",
    [keys],
  );
  const eventRow = eventState.rows[0]!;
  const confirmedRows = reservations.rows.filter((row) => row.status === "CONFIRMED");
  const fullRejectedRows = reservations.rows.filter((row) => row.status === "FULL_REJECTED");
  const confirmedSeats = confirmedRows.reduce((sum, row) => sum + row.party_size, 0);
  const numbers = confirmedRows
    .map((row) => row.reservation_number)
    .filter((number): number is number => number !== null)
    .sort((left, right) => left - right);
  const expectedNumbers = Array.from(
    { length: eventRow.last_reservation_number },
    (_, index) => index + 1,
  );
  const invariantPassed =
    eventRow.reserved_seats === confirmedSeats &&
    eventRow.reserved_seats <= eventRow.capacity &&
    JSON.stringify(numbers) === JSON.stringify(expectedNumbers) &&
    new Set(numbers).size === numbers.length &&
    duplicates.rowCount === 0 &&
    idempotency.rows[0]!.count === nonRetryKeys.length;

  return {
    requests: requestCount,
    confirmed: confirmedRows.length,
    fullRejected: fullRejectedRows.length,
    otherOutcomes: responses.filter(
      (response) => response.code !== "CONFIRMED" && response.code !== "EVENT_FULL",
    ).length,
    reservedSeats: eventRow.reserved_seats,
    capacity: eventRow.capacity,
    oversold: Math.max(0, eventRow.reserved_seats - eventRow.capacity),
    durationMs,
    invariantPassed,
  };
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: localDatabaseUrl(), max: 5 });
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3100";

  try {
    const results = [
      await runScenario(pool, baseUrl, 100, 8_000_000),
      await runScenario(pool, baseUrl, 1_000, 9_000_000),
    ];
    console.table(results);

    const outputDirectory = path.resolve("load-test-results");
    await mkdir(outputDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const outputPath = path.join(outputDirectory, `${timestamp}.json`);
    await writeFile(
      outputPath,
      `${JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
      "utf8",
    );
    console.log(`Load-test results written to ${outputPath}`);

    if (results.some((result) => result.oversold > 0 || !result.invariantPassed)) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
