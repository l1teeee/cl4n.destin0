import type { PaymentSettings } from "@/domain/payment/payment-settings";

export interface PaymentSettingsRepository {
  find(): Promise<PaymentSettings | null>;
  save(settings: PaymentSettings, adminId: string): Promise<void>;
}

export function loadPaymentSettings(repository: PaymentSettingsRepository) {
  return repository.find();
}

export function savePaymentSettings(
  repository: PaymentSettingsRepository,
  settings: PaymentSettings,
  adminId: string,
) {
  return repository.save(settings, adminId);
}
