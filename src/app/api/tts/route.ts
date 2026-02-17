import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";

const MARK2_API_URL = process.env.MARK2_API_URL || "http://76.13.42.188:3456";
const MARK2_API_KEY = process.env.MARK2_API_KEY || "";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { text, voice } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: 'Parametre "text" requis' }, { status: 400 });
    }

    const res = await fetch(`${MARK2_API_URL}/tts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MARK2_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, voice: voice || "onyx" }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `TTS error: ${res.status} - ${errorText}` },
        { status: res.status }
      );
    }

    const audioBuffer = await res.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `TTS proxy error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}
