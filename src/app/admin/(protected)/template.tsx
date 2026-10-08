import { ViewTransition, type ReactNode } from "react";

export default function ProtectedAdminTemplate({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="admin-section-enter" exit="admin-section-exit" default="none">
      {children}
    </ViewTransition>
  );
}
