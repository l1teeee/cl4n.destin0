const MAX_COUNT_SHOWN = 9;

export function UnreadCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  const shownCount = count > MAX_COUNT_SHOWN ? `${MAX_COUNT_SHOWN}+` : String(count);
  const spokenCount = count === 1 ? "1 mensaje sin leer" : `${count} mensajes sin leer`;

  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.65rem] leading-none font-bold text-primary-foreground">
      <span aria-hidden="true">{shownCount}</span>
      <span className="sr-only">{spokenCount}</span>
    </span>
  );
}
