import { NextResponse } from "next/server";

import { pool } from "@/infrastructure/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", db: "up" }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
