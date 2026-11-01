import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

import { MessageSimulator } from "./message-simulator";
import { shouldShowMessagingSimulator } from "./message-view-model";

type SimulatorAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

export function MessageSimulatorPanel({
  mode,
  appEnvironment,
  action,
}: {
  mode: string;
  appEnvironment: string;
  action: SimulatorAction;
}) {
  if (!shouldShowMessagingSimulator(mode, appEnvironment)) return null;
  return <MessageSimulator action={action} />;
}
