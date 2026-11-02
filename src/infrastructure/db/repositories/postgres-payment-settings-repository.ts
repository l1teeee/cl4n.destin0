import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { PaymentSettingsRepository } from "@/application/payments/payment-settings";
import {
  changedPaymentFields,
  type AccountType,
  type PaymentSettings,
} from "@/domain/payment/payment-settings";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

export const PAYMENT_SETTINGS_AUDIT_ID = "5d2c8f4e-7a31-4b6d-9c80-2e1f3a6b9d02";

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

interface PaymentSettingsRow extends QueryResultRow {
  bank_name: string;
  account_type: AccountType;
  account_number: string;
  account_holder: string;
  payment_link: string | null;
}

const selectSettings = `SELECT bank_name, account_type, account_number, account_holder, payment_link
                          FROM payment_settings
                         WHERE id = 1`;

function paymentSettingsFromRow(row: PaymentSettingsRow): PaymentSettings {
  return {
    bankName: row.bank_name,
    accountType: row.account_type,
    accountNumber: row.account_number,
    accountHolder: row.account_holder,
    paymentLink: row.payment_link,
  };
}

async function insertAudit(
  client: PoolClient,
  adminId: string,
  changedFields: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_type, actor_admin_id, action, entity_type, entity_id, metadata)
     VALUES ('ADMIN', $1, 'PAYMENT_SETTINGS_UPDATED', 'PAYMENT_SETTINGS', $2, $3::jsonb)`,
    [adminId, PAYMENT_SETTINGS_AUDIT_ID, JSON.stringify({ changedFields })],
  );
}

export class PostgresPaymentSettingsRepository implements PaymentSettingsRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async find(): Promise<PaymentSettings | null> {
    const result = await this.pool.query<PaymentSettingsRow>(selectSettings);
    const row = result.rows[0];
    return row ? paymentSettingsFromRow(row) : null;
  }

  save(settings: PaymentSettings, adminId: string): Promise<void> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const current = await client.query<PaymentSettingsRow>(`${selectSettings} FOR UPDATE`);
      const before = current.rows[0] ? paymentSettingsFromRow(current.rows[0]) : null;
      const changedFields = changedPaymentFields(before, settings);
      if (changedFields.length === 0) return;

      await client.query(
        `INSERT INTO payment_settings
           (id, bank_name, account_type, account_number, account_holder, payment_link, updated_by)
         VALUES (1, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           bank_name = EXCLUDED.bank_name,
           account_type = EXCLUDED.account_type,
           account_number = EXCLUDED.account_number,
           account_holder = EXCLUDED.account_holder,
           payment_link = EXCLUDED.payment_link,
           updated_by = EXCLUDED.updated_by,
           updated_at = clock_timestamp()`,
        [
          settings.bankName,
          settings.accountType,
          settings.accountNumber,
          settings.accountHolder,
          settings.paymentLink,
          adminId,
        ],
      );
      await insertAudit(client, adminId, changedFields);
    });
  }
}

export const postgresPaymentSettingsRepository = new PostgresPaymentSettingsRepository();
