import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const MARK01_API_URL = process.env.MARK01_API_URL || "https://mark01-api.jarvisfirstproto.cloud";
const MARK01_API_KEY = process.env.MARK01_API_KEY || "";

const headers = {
  "Authorization": `Bearer ${MARK01_API_KEY}`,
  "Content-Type": "application/json",
};

// GET - Recuperer l'historique depuis le VPS
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const res = await fetch(`${MARK01_API_URL}/chat-history`, { headers });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ messages: data.messages || [] });
    } else {
      return NextResponse.json({ messages: [] });
    }
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

// POST - Envoyer un message et sauvegarder dans l'historique VPS
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message vide" }, { status: 400 });
    }

    const msgId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Sauvegarder le message utilisateur dans l'historique VPS
    await fetch(`${MARK01_API_URL}/chat-history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: {
          id: msgId,
          source: "WEB",
          userMessage: message.trim(),
          jarvisResponse: "",
          timestamp: Date.now(),
        },
      }),
    }).catch(() => {});

    // Envoyer au mark01-api pour obtenir la reponse de Jarvis
    let jarvisResponse = "Erreur de communication avec Jarvis.";

    try {
      const apiResponse = await fetch(`${MARK01_API_URL}/voice-code`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: message.trim(),
          mode: "text",
          response_format: "text",
        }),
      });

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        jarvisResponse = data.response || data.details || jarvisResponse;
      } else {
        const errorText = await apiResponse.text().catch(() => "");
        jarvisResponse = `Erreur ${apiResponse.status}: ${errorText.slice(0, 200)}`;
      }
    } catch (e) {
      jarvisResponse = `Erreur de connexion: ${e instanceof Error ? e.message : "inconnue"}`;
    }

    // Mettre a jour l'historique avec la reponse
    await fetch(`${MARK01_API_URL}/chat-history`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id: msgId, jarvisResponse }),
    }).catch(() => {});

    return NextResponse.json({ id: msgId, response: jarvisResponse });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
