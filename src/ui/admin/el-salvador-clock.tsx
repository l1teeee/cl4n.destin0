"use client";

import { useSyncExternalStore } from "react";

import { formatElSalvadorClock } from "@/infrastructure/time/el-salvador-time";

const REFRESH_MS = 30_000;

function subscribe(notify: () => void): () => void {
  const interval = window.setInterval(notify, REFRESH_MS);
  return () => window.clearInterval(interval);
}

function currentTime(): string {
  return formatElSalvadorClock(new Date());
}

// The server has no browser clock to show, so the first render is empty and hydration stays stable.
function serverTime(): string {
  return "";
}

// Display only: the schedule rules are checked against the database clock on the server.
export function ElSalvadorClock() {
  const time = useSyncExternalStore(subscribe, currentTime, serverTime);

  if (time === "") return null;
  return <span className="admin-muted">Hora actual (El Salvador): {time}</span>;
}
