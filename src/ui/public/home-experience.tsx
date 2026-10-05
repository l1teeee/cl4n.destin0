import Link from "next/link";

import type { HomeViewModel } from "./home-view-model";

interface HomeExperienceProps {
  viewModel: Extract<HomeViewModel, { state: "OPEN" }>;
}

export function HomeExperience({ viewModel }: HomeExperienceProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-[0.2em]">CLANDESTINO</h1>
      <h2 className="text-xl font-medium">EL CLAN ESTÁ ABIERTO</h2>
      <div className="flex flex-col gap-10">
        {viewModel.events.map((event) => (
          <section key={event.slug} className="flex flex-col items-center gap-4">
            <p>{event.formattedDate}</p>
            <p className="text-sm tracking-[0.18em]">ACCESO LIMITADO</p>
            <Link
              href={`/solicitar/${event.slug}`}
              className="border border-current px-5 py-3 font-medium"
            >
              SOLICITAR ACCESO
            </Link>
          </section>
        ))}
      </div>
    </main>
  );
}
