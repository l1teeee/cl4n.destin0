import { Fragment } from "react";

export interface GuestSummaryItem {
  label: string;
  value: string;
}

export function GuestSummaryBar({ items }: { items: readonly GuestSummaryItem[] }) {
  return (
    <p className="admin-muted">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? " · " : null}
          {item.label} {item.value}
        </Fragment>
      ))}
    </p>
  );
}
