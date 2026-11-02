export interface PersonalDataRetentionRepository {
  listDueEventIds(limit: number): Promise<string[]>;
  purgeEvent(eventId: string): Promise<boolean>;
}

export interface PersonalDataPurgeBatch {
  deleted: number;
  hasMore: boolean;
}

export interface UnattributedPersonalDataRetentionRepository {
  purgeUnattributedMessagesBatch(): Promise<PersonalDataPurgeBatch>;
  purgeOrphanedContactsBatch(): Promise<PersonalDataPurgeBatch>;
}

interface Dependencies {
  repository: PersonalDataRetentionRepository;
  onEventFailure(eventId: string): void;
}

export async function purgeExpiredPersonalData(
  deps: Dependencies,
  input: { limit: number },
): Promise<number> {
  const eventIds = await deps.repository.listDueEventIds(Math.min(input.limit, 20));
  let purgedEvents = 0;
  for (const eventId of eventIds) {
    try {
      if (await deps.repository.purgeEvent(eventId)) purgedEvents += 1;
    } catch {
      deps.onEventFailure(eventId);
    }
  }
  return purgedEvents;
}

export async function purgeExpiredUnattributedPersonalData(
  deps: {
    repository: UnattributedPersonalDataRetentionRepository;
    now?: () => number;
  },
  input: { timeBudgetMs: number },
): Promise<{ messages: number; contacts: number }> {
  const now = deps.now ?? Date.now;
  const deadline = now() + Math.min(input.timeBudgetMs, 40_000);
  const counts = { messages: 0, contacts: 0 };
  while (now() < deadline) {
    const batch = await deps.repository.purgeUnattributedMessagesBatch();
    counts.messages += batch.deleted;
    if (!batch.hasMore) break;
  }
  while (now() < deadline) {
    const batch = await deps.repository.purgeOrphanedContactsBatch();
    counts.contacts += batch.deleted;
    if (!batch.hasMore) break;
  }
  return counts;
}
