import type { AdminAuthRepository } from "./admin-auth-repository";

export function signOut(repository: AdminAuthRepository, token: string): Promise<void> {
  return repository.deleteSession(token);
}
