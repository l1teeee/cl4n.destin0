interface StatItem {
  label: string;
  value: string | number;
}

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded border border-zinc-800 bg-zinc-900 p-4">
          <dt className="text-xs uppercase tracking-wide text-zinc-400">{item.label}</dt>
          <dd className="mt-1 text-xl font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
