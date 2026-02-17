import { NextResponse } from "next/server";

const MARK2_API_URL = process.env.MARK2_API_URL || "http://76.13.42.188:3456";

// GET - Proxy vers Mark2 /health (pas d'auth requise)
export async function GET() {
  try {
    const res = await fetch(`${MARK2_API_URL}/health`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { status: "error", error: `Mark2 unreachable: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}
