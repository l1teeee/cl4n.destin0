import { getPublicHomeEvents } from "@/application/events/event-use-cases";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { ClosedState } from "@/ui/public/closed-state";
import { HomeExperience } from "@/ui/public/home-experience";
import { buildHomeViewModel } from "@/ui/public/home-view-model";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import { publicMessages } from "@/ui/public/i18n/messages";
import { RefreshAt } from "@/ui/refresh-at";

export const dynamic = "force-dynamic";

export default async function Home() {
  const readModel = await getPublicHomeEvents(postgresEventRepository);
  const locale = await getPublicLocale();
  const viewModel = buildHomeViewModel(readModel.value, locale);

  if (viewModel.state === "OPEN") {
    return <HomeExperience viewModel={viewModel} messages={publicMessages[locale].home} />;
  }

  if (viewModel.state === "SCHEDULED") {
    return (
      <>
        <ClosedState variant={{ state: "SCHEDULED", opensAt: viewModel.opensAt }} />
        <RefreshAt delayMs={viewModel.opensAt.getTime() - readModel.databaseTime.getTime()} />
      </>
    );
  }

  return <ClosedState variant={{ state: viewModel.state === "FULL" ? "FULL" : "DEFAULT" }} />;
}
