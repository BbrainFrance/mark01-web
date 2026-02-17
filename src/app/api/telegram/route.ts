import { NextRequest, NextResponse } from "next/server";

const MARK2_API_URL = process.env.MARK2_API_URL || "http://76.13.42.188:3456";

// POST - Proxy webhook Telegram vers Mark2 (pas d'auth Bearer - Telegram envoie directement)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(`${MARK2_API_URL}/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Proxy telegram error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}
