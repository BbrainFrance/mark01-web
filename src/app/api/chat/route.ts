import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const MARK01_API_URL = process.env.MARK01_API_URL || "https://mark01-api.jarvisfirstproto.cloud";
const MARK01_API_KEY = process.env.MARK01_API_KEY || "";

const headers = {
  "Authorization": `Bearer ${MARK01_API_KEY}`,
  "Content-Type": "application/json",
};

// GET - Recuperer l'historique (mark01-api + openclaw)
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    // Recuperer les deux sources en parallele
    const [localRes, openclawRes] = await Promise.allSettled([
      fetch(`${MARK01_API_URL}/chat-history`, { headers }),
      fetch(`${MARK01_API_URL}/openclaw-history`, { headers }),
    ]);

    const localMessages =
      localRes.status === "fulfilled" && localRes.value.ok
        ? (await localRes.value.json()).messages || []
        : [];

    const openclawMessages =
      openclawRes.status === "fulfilled" && openclawRes.value.ok
        ? (await openclawRes.value.json()).messages || []
        : [];

    // Fusionner et dedupliquer par timestamp + userMessage
    const seen = new Set<string>();
    const all = [...openclawMessages, ...localMessages];
    const unique = [];

    for (const msg of all) {
      const key = `${msg.timestamp}-${msg.userMessage?.slice(0, 50)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(msg);
      }
    }

    // Trier par timestamp
    unique.sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);

    return NextResponse.json({ messages: unique });
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
    const { message, source } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message vide" }, { status: 400 });
    }

    const msgSource = source === "APPEL" ? "APPEL" : "WEB";
    const msgId = `${msgSource.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Sauvegarder le message utilisateur dans l'historique VPS
    await fetch(`${MARK01_API_URL}/chat-history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: {
          id: msgId,
          source: msgSource,
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
          response_format: msgSource === "APPEL" ? "tts" : "text",
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
