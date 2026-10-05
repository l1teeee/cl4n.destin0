import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { inspect } from "node:util";

import { Pool } from "pg";

const MAX_TRANSPORT_RETRIES = 5;

interface LoadSummary {
  requests: number;
  confirmed: number;
  fullRejected: number;
  otherOutcomes: number;
  reservedSeats: number;
  capacity: number;
  oversold: number;
  durationMs: number;
  transportRetries: number;
  transportErrors: number;
  invariantPassed: boolean;
}

interface ReservationResponse {
  kind: "response";
  status: number;
  body: Record<string, unknown>;
  code: string;
  key: string;
  transportRetries: number;
}

interface ReservationTransportError {
  kind: "transportError";
  key: string;
  error: unknown;
  transportRetries: number;
}

type ReservationResult = ReservationResponse | ReservationTransportError;

interface ScenarioResult {
  summary: LoadSummary;
  firstTransportError: unknown | null;
}

function redactDatabaseCredentials(message: string): string {
  return message.replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1***@");
}

function operatorError(error: unknown): string {
  return redactDatabaseCredentials(inspect(error, { depth: null }));
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

async function sendReservationRequest(
  baseUrl: string,
  key: string,
  requestBody: string,
): Promise<ReservationResult> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/reservations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        body: requestBody,
      });
    } catch (error) {
      if (attempt === MAX_TRANSPORT_RETRIES) {
        return {
          kind: "transportError",
          key,
          error,
          transportRetries: attempt,
        };
      }

      await delay(50 + Math.floor(Math.random() * 201));
      continue;
    }

    const body = (await response.json()) as Record<string, unknown>;
    return {
      kind: "response",
      status: response.status,
      body,
      code: outcomeCode(body),
      key,
      transportRetries: attempt,
    };
  }
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
): Promise<ScenarioResult> {
  const event = await createEvent(pool, requestCount);
  const keys = Array.from({ length: requestCount }, () => randomUUID());
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedAt = performance.now();
  const pending = keys.map(async (key, index) => {
    const sequence = sequenceOffset + index;
    const requestBody = JSON.stringify({
      eventSlug: event.slug,
      fullName: `Load Guest ${sequence}`,
      instagram: `load.${sequence}`,
      phone: phoneFor(sequence),
      email: `load.${sequence}@example.com`,
      partySize: 1,
      acceptTerms: true,
      turnstileToken: "load-test-disabled",
    });
    await barrier;
    return sendReservationRequest(baseUrl, key, requestBody);
  });

  release();
  const requestResults = await Promise.all(pending);
  const responses = requestResults.filter(
    (result): result is ReservationResponse => result.kind === "response",
  );
  const transportFailures = requestResults.filter(
    (result): result is ReservationTransportError => result.kind === "transportError",
  );
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
  const idempotency = await pool.query<{ key: string }>(
    "SELECT key::text AS key FROM idempotency_records WHERE key = ANY($1::uuid[])",
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
  const idempotencyKeys = new Set(idempotency.rows.map((row) => row.key));
  const retryKeys = responses
    .filter((response) => response.code === "TRY_AGAIN")
    .map((response) => response.key);
  const transportRetries = requestResults.reduce(
    (total, result) => total + result.transportRetries,
    0,
  );
  const invariantPassed =
    eventRow.reserved_seats === confirmedSeats &&
    eventRow.reserved_seats <= eventRow.capacity &&
    JSON.stringify(numbers) === JSON.stringify(expectedNumbers) &&
    new Set(numbers).size === numbers.length &&
    duplicates.rowCount === 0 &&
    nonRetryKeys.every((key) => idempotencyKeys.has(key)) &&
    retryKeys.every((key) => !idempotencyKeys.has(key));

  return {
    summary: {
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
      transportRetries,
      transportErrors: transportFailures.length,
      invariantPassed,
    },
    firstTransportError: transportFailures[0]?.error ?? null,
  };
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: localDatabaseUrl(), max: 5 });
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3100";

  try {
    const scenarios = [
      await runScenario(pool, baseUrl, 100, 8_000_000),
      await runScenario(pool, baseUrl, 1_000, 9_000_000),
    ];
    const results = scenarios.map((scenario) => scenario.summary);
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

    const scenarioWithTransportError = scenarios.find(
      (scenario) => scenario.summary.transportErrors > 0,
    );
    if (scenarioWithTransportError) {
      throw new Error("One or more requests exhausted transport retries.", {
        cause: scenarioWithTransportError.firstTransportError,
      });
    }
    if (results.some((result) => result.oversold > 0 || !result.invariantPassed)) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Load test failed.");
  console.error(operatorError(error));
  process.exitCode = 1;
});
