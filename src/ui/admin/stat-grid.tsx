interface StatItem {
  label: string;
  value: string | number;
}

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <dl className="admin-stat-grid">
      {items.map((item) => (
        <div key={item.label} className="admin-stat">
          <dt className="admin-stat-label">{item.label}</dt>
          <dd className="admin-stat-value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
