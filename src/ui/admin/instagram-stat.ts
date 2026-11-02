type InstagramStatus =
  { mode: "log" } | { mode: "instagram"; connection: { username: string } | null };

interface InstagramStatItem {
  label: "Instagram";
  value: string;
  detail?: string;
}

export function instagramStatItem(status: InstagramStatus): InstagramStatItem {
  if (status.mode === "log") {
    return { label: "Instagram", value: "Modo de prueba" };
  }

  if (status.connection === null) {
    return { label: "Instagram", value: "Sin sincronizar" };
  }

  return {
    label: "Instagram",
    value: "Sincronizado",
    detail: `@${status.connection.username}`,
  };
}
