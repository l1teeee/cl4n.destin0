import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { savePaymentSettingsAction } from "@/app/admin/(protected)/account/payment-settings-actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import {
  PAYMENT_SETTINGS_AUDIT_ID,
  PostgresPaymentSettingsRepository,
} from "@/infrastructure/db/repositories/postgres-payment-settings-repository";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";

import { configurePaymentSettings, insertGuestReservation } from "../helpers/guest-flow-test-data";
import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
const ACCOUNT_NUMBER = "9988776655";
let pool: Pool;
let repository: PostgresPaymentSettingsRepository;
let superAdminId: string;
let superAdminToken: string;
let adminToken: string;

async function createAdmin(email: string, role: "SUPER_ADMIN" | "ADMIN") {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
     VALUES ($1, $1, 'hash', $1, $2::admin_role)
     RETURNING id`,
    [email, role],
  );
  const id = result.rows[0]!.id;
  const session = await postgresAdminAuthRepository.createSession(id, "hash", null);
  return { id, token: session!.token };
}

beforeEach(async () => {
  authState.token = undefined;
  if (pool) await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresPaymentSettingsRepository(pool);
  const superAdmin = await createAdmin("super-payments@example.com", "SUPER_ADMIN");
  const admin = await createAdmin("admin-payments@example.com", "ADMIN");
  superAdminId = superAdmin.id;
  superAdminToken = superAdmin.token;
  adminToken = admin.token;
});

afterAll(async () => {
  if (pool) await pool.end();
});

function paymentForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields = {
    bankName: "Banco Agrícola",
    accountType: "Ahorro",
    accountNumber: ACCOUNT_NUMBER,
    accountHolder: "Ana Pérez",
    paymentLink: "",
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

async function paymentAudit() {
  const result = await pool.query<{ actor_admin_id: string; metadata: Record<string, unknown> }>(
    `SELECT actor_admin_id, metadata FROM audit_logs
      WHERE action = 'PAYMENT_SETTINGS_UPDATED' AND entity_type = 'PAYMENT_SETTINGS'
        AND entity_id = $1
      ORDER BY id`,
    [PAYMENT_SETTINGS_AUDIT_ID],
  );
  return result.rows;
}

describe("payment settings repository", () => {
  const settings = {
    bankName: "Banco Agrícola",
    accountType: "Ahorro",
    accountNumber: ACCOUNT_NUMBER,
    accountHolder: "Ana Pérez",
    paymentLink: null,
  } as const;

  it("has no settings until they are saved", async () => {
    expect(await repository.find()).toBeNull();
  });

  it("saves and reads the singleton, auditing the changed fields without their values", async () => {
    await repository.save(settings, superAdminId);

    expect(await repository.find()).toEqual(settings);
    const audit = await paymentAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_admin_id).toBe(superAdminId);
    expect(audit[0]!.metadata).toEqual({
      changedFields: ["bankName", "accountType", "accountNumber", "accountHolder", "paymentLink"],
    });
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain(ACCOUNT_NUMBER);
  });

  it("audits only what changed and skips a save that changes nothing", async () => {
    await repository.save(settings, superAdminId);
    await repository.save(settings, superAdminId);
    await repository.save(
      { ...settings, accountNumber: "1111", paymentLink: "https://pago.example.com/abc" },
      superAdminId,
    );

    const audit = await paymentAudit();
    expect(audit).toHaveLength(2);
    expect(audit[1]!.metadata).toEqual({ changedFields: ["accountNumber", "paymentLink"] });
    expect((await pool.query("SELECT 1 FROM payment_settings")).rowCount).toBe(1);
  });

  it("keeps a single row and valid values in the database", async () => {
    await configurePaymentSettings(pool);

    await expect(
      pool.query(
        `INSERT INTO payment_settings (id, bank_name, account_type, account_number, account_holder)
         VALUES (2, 'B', 'Ahorro', '1', 'T')`,
      ),
    ).rejects.toMatchObject({ constraint: "payment_settings_singleton" });
    await expect(
      pool.query("UPDATE payment_settings SET account_type = 'Otra'"),
    ).rejects.toMatchObject({ constraint: "payment_settings_account_type_chk" });
    await expect(
      pool.query("UPDATE payment_settings SET payment_link = 'http://pago.example.com'"),
    ).rejects.toMatchObject({ constraint: "payment_settings_payment_link_chk" });
    await expect(
      pool.query("UPDATE payment_settings SET payment_link = 'HTTP://pago.example.com'"),
    ).rejects.toMatchObject({ constraint: "payment_settings_payment_link_chk" });
    await expect(
      pool.query("UPDATE payment_settings SET payment_link = repeat('c', 301)"),
    ).rejects.toMatchObject({ constraint: "payment_settings_payment_link_chk" });
    await expect(
      pool.query("UPDATE payment_settings SET payment_link = 'codigo-123' RETURNING payment_link"),
    ).resolves.toMatchObject({ rows: [{ payment_link: "codigo-123" }] });
    await expect(
      pool.query("UPDATE payment_settings SET payment_link = 'https://pago.example.com'"),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rejects a negative event price", async () => {
    const event = await insertTestEvent(pool);

    await expect(
      pool.query("UPDATE events SET price_cents = -1 WHERE id = $1", [event.id]),
    ).rejects.toMatchObject({ constraint: "events_price_cents_chk" });
  });
});

describe("savePaymentSettingsAction", () => {
  it("refuses a signed-out visitor", async () => {
    expect(await savePaymentSettingsAction(initialState, paymentForm())).toMatchObject({
      ok: false,
    });
    expect(await repository.find()).toBeNull();
  });

  it("refuses an administrator without the payments.manage permission", async () => {
    authState.token = adminToken;

    expect(await savePaymentSettingsAction(initialState, paymentForm())).toEqual({
      ok: false,
      message: "Solo un superadministrador puede cambiar los datos de pago.",
    });
    expect(await repository.find()).toBeNull();
  });

  it("saves the data for a super administrator", async () => {
    authState.token = superAdminToken;

    expect(
      await savePaymentSettingsAction(
        initialState,
        paymentForm({ accountType: "Corriente", paymentLink: "https://pago.example.com/abc" }),
      ),
    ).toEqual({ ok: true, message: "Datos de pago guardados." });
    expect(await repository.find()).toEqual({
      bankName: "Banco Agrícola",
      accountType: "Corriente",
      accountNumber: ACCOUNT_NUMBER,
      accountHolder: "Ana Pérez",
      paymentLink: "https://pago.example.com/abc",
    });
  });

  it("returns field errors and saves nothing for invalid data", async () => {
    authState.token = superAdminToken;

    const result = await savePaymentSettingsAction(
      initialState,
      paymentForm({ bankName: "", paymentLink: "http://inseguro.example.com" }),
    );

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        bankName: "El banco es obligatorio.",
        paymentLink: "Si es un enlace, debe empezar con https://.",
      },
    });
    expect(await repository.find()).toBeNull();
  });
});

describe("accepting a guest without the payment data or the price", () => {
  async function acceptWith(options: { settings: boolean; priceCents: number | null }) {
    if (options.settings) await configurePaymentSettings(pool);
    const event = await insertTestEvent(pool, { priceCents: options.priceCents });
    const reservationId = await insertGuestReservation(pool, event.id, {
      stage: "IN_REVIEW",
      guest2FullName: "Luis Pérez",
    });
    const result = await new PostgresGuestAdminRepository(pool).accept({
      reservationId,
      actorAdminId: superAdminId,
    });
    const stored = await pool.query<{ stage: string }>(
      "SELECT stage FROM reservations WHERE id = $1",
      [reservationId],
    );
    const messages = await pool.query<{ body: string }>(
      "SELECT body FROM messages WHERE reservation_id = $1 AND kind = 'ON_LIST'",
      [reservationId],
    );
    return { result, stage: stored.rows[0]!.stage, messages: messages.rows };
  }

  it("accepts without payment settings and sends the message without the bank data", async () => {
    const outcome = await acceptWith({ settings: false, priceCents: 2500 });

    expect(outcome.result).toMatchObject({ ok: true, paymentMissing: true });
    expect(outcome.stage).toBe("ON_LIST");
    expect(outcome.messages).toHaveLength(1);
    const body = outcome.messages[0]!.body;
    expect(body).toContain("Monto: $50.00");
    expect(body).not.toContain("Banco Demo");
    expect(body).not.toContain("{");
  });

  it("accepts an event without a price and sends the message without the amount", async () => {
    const outcome = await acceptWith({ settings: true, priceCents: null });

    expect(outcome.result).toMatchObject({ ok: true, paymentMissing: true });
    expect(outcome.stage).toBe("ON_LIST");
    expect(outcome.messages).toHaveLength(1);
    const body = outcome.messages[0]!.body;
    expect(body).toContain("Banco: Banco Demo");
    expect(body).toContain("Cuenta: 0123456789");
    expect(body).not.toContain("Monto");
    expect(body).not.toContain("$");
    expect(body).not.toContain("{");
  });

  it("puts the guest on the list with the amount for the whole party", async () => {
    const outcome = await acceptWith({ settings: true, priceCents: 2500 });

    expect(outcome.result).toMatchObject({ ok: true, paymentMissing: false });
    expect(outcome.stage).toBe("ON_LIST");
    expect(outcome.messages).toHaveLength(1);
    expect(outcome.messages[0]!.body).toContain("$50.00");
    expect(outcome.messages[0]!.body).toContain("Banco: Banco Demo");
    expect(outcome.messages[0]!.body).toContain("Cuenta: 0123456789");
  });
});
