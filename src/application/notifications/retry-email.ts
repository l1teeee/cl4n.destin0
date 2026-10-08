import type { EmailOutboxRepository } from "./email-outbox";

export function retryEmail(repository: EmailOutboxRepository, id: string): Promise<boolean> {
  return repository.retry(id);
}
