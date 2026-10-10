import { getPublicHomeEvents } from "@/application/events/event-use-cases";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { ClosedState } from "@/ui/public/closed-state";
import { HomeExperience } from "@/ui/public/home-experience";
import { buildHomeViewModel } from "@/ui/public/home-view-model";

export const dynamic = "force-dynamic";

export default async function Home() {
  const readModel = await getPublicHomeEvents(postgresEventRepository);
  const viewModel = buildHomeViewModel(readModel.value);

  if (viewModel.state === "OPEN") {
    return <HomeExperience viewModel={viewModel} />;
  }

  if (viewModel.state === "SCHEDULED") {
    return <ClosedState variant={{ state: "SCHEDULED", opensAt: viewModel.opensAt }} />;
  }

  return <ClosedState variant={{ state: viewModel.state === "FULL" ? "FULL" : "DEFAULT" }} />;
}
