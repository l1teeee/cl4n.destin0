import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import type { ClosedStateVariant } from "./home-view-model";
import { getPublicLocale } from "./i18n/locale";
import { publicMessages, type PublicLocale } from "./i18n/messages";
import { PublicLanding } from "./public-landing";

interface ClosedStateProps {
  variant: ClosedStateVariant;
}

function closedStateCopy(variant: ClosedStateVariant, locale: PublicLocale): string {
  const messages = publicMessages[locale].home;
  switch (variant.state) {
    case "SCHEDULED":
      return `${messages.scheduled} ${formatPublicEventDate(variant.opensAt, locale)}`;
    case "FULL":
      return messages.fullClosed;
    case "CLOSED":
      return messages.closedExperience;
    case "DEFAULT":
      return messages.noDate;
  }
}

export async function ClosedState({ variant }: ClosedStateProps) {
  const locale = await getPublicLocale();
  return (
    <PublicLanding status={publicMessages[locale].home.closed}>
      <p className="public-home-copy">{closedStateCopy(variant, locale)}</p>
    </PublicLanding>
  );
}
