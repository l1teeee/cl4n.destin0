import type { ExtraDetails, ExtraItem, ExtraRepository, PickerItem } from "./extra-repository";

export function listExtras(repository: ExtraRepository): Promise<ExtraItem[]> {
  return repository.listForAdmin();
}

export function listActiveExtras(repository: ExtraRepository): Promise<PickerItem[]> {
  return repository.listActive();
}

export function createExtra(
  repository: ExtraRepository,
  input: ExtraDetails & { actorId: string },
): Promise<ExtraItem> {
  return repository.create(input);
}

export function updateExtra(
  repository: ExtraRepository,
  input: ExtraDetails & { id: string; actorId: string },
): Promise<ExtraItem | null> {
  return repository.update(input);
}

export function deleteExtra(
  repository: ExtraRepository,
  id: string,
  actorId: string,
): Promise<boolean> {
  return repository.delete(id, actorId);
}
