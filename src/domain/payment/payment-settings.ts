export const ACCOUNT_TYPES = ["Ahorro", "Corriente"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const PAYMENT_FIELD_MAX_LENGTH = 80;
export const PAYMENT_LINK_MAX_LENGTH = 300;

export interface PaymentSettings {
  bankName: string;
  accountType: AccountType;
  accountNumber: string;
  accountHolder: string;
  paymentLink: string | null;
}

export type PaymentSettingsField = keyof PaymentSettings;

// The audit trail records which fields changed, never their values: the account number is sensitive.
export function changedPaymentFields(
  before: PaymentSettings | null,
  after: PaymentSettings,
): PaymentSettingsField[] {
  const fields: PaymentSettingsField[] = [
    "bankName",
    "accountType",
    "accountNumber",
    "accountHolder",
    "paymentLink",
  ];
  return fields.filter((field) => before === null || before[field] !== after[field]);
}
