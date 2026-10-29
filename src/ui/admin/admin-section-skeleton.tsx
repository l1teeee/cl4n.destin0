type Section = "experiences" | "drinks" | "audit" | "emails" | "users" | "account";

const sectionDetails: Record<Section, { title: string; description: string }> = {
  experiences: { title: "Experiencias", description: "Control de eventos y reservaciones." },
  drinks: { title: "Bebidas", description: "Menú de bebidas que ven los comensales." },
  audit: { title: "Auditoría", description: "Actividad reciente de administración." },
  emails: { title: "Correos", description: "Mensajes y envíos transaccionales." },
  users: { title: "Usuarios", description: "Administración de cuentas y accesos." },
  account: { title: "Mi cuenta", description: "Configuración personal de la cuenta." },
};

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-[#292a23] motion-reduce:animate-none ${className}`}
    />
  );
}

export function AdminSectionSkeleton({ section }: { section: Section }) {
  const details = sectionDetails[section];

  return (
    <main
      className="admin-page space-y-8"
      aria-busy="true"
      aria-label={`Cargando ${details.title}`}
    >
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">{details.title}</h1>
        <p className="admin-description">{details.description}</p>
      </div>
      {section === "experiences" && (
        <div className="space-y-4">
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-28 w-full" />
        </div>
      )}
      {section === "drinks" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
        </div>
      )}
      {section === "audit" && (
        <div className="space-y-0 border-l border-[#3a3b33] pl-5">
          <SkeletonBlock className="mb-5 h-20 w-full" />
          <SkeletonBlock className="mb-5 h-20 w-full" />
          <SkeletonBlock className="h-20 w-full" />
        </div>
      )}
      {section === "emails" && (
        <div className="space-y-3">
          <SkeletonBlock className="h-12 w-full" />
          <SkeletonBlock className="h-12 w-full" />
          <SkeletonBlock className="h-12 w-full" />
        </div>
      )}
      {section === "users" && (
        <div className="space-y-0">
          <SkeletonBlock className="h-12 w-full rounded-b-none" />
          <SkeletonBlock className="h-16 w-full rounded-none border-t border-[#11120d]" />
          <SkeletonBlock className="h-16 w-full rounded-none border-t border-[#11120d]" />
          <SkeletonBlock className="h-16 w-full rounded-t-none border-t border-[#11120d]" />
        </div>
      )}
      {section === "account" && (
        <div className="max-w-2xl space-y-6">
          <SkeletonBlock className="h-36 w-full" />
          <SkeletonBlock className="h-56 w-full" />
        </div>
      )}
    </main>
  );
}
