"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";

interface ActionFeedback {
  ok: boolean;
  message: string;
}

interface ActionFeedbackContextValue {
  report: (feedback: ActionFeedback) => void;
}

const ActionFeedbackContext = createContext<ActionFeedbackContextValue | null>(null);

export function useActionFeedback(): ActionFeedbackContextValue | null {
  return useContext(ActionFeedbackContext);
}

// Lives above the rows so a success message survives the row disappearing after revalidation.
export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const report = useCallback((next: ActionFeedback) => setFeedback(next), []);
  const value = useMemo(() => ({ report }), [report]);

  return (
    <ActionFeedbackContext.Provider value={value}>
      {feedback ? (
        <Alert variant={feedback.ok ? "success" : "destructive"} role="status">
          <div className="col-start-2 flex items-center justify-between gap-3">
            <span>{feedback.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setFeedback(null)}>
              Cerrar
            </Button>
          </div>
        </Alert>
      ) : null}
      {children}
    </ActionFeedbackContext.Provider>
  );
}
