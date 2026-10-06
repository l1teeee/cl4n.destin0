export function RollingLabel({ children }: { children: string }) {
  return (
    <span className="rolling-label">
      <span className="rolling-label-line">{children}</span>
      <span className="rolling-label-line" aria-hidden="true">
        {children}
      </span>
    </span>
  );
}
