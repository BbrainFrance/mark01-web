import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const MARK01_API_URL = process.env.MARK01_API_URL || "https://mark01-api.jarvisfirstproto.cloud";
const MARK01_API_KEY = process.env.MARK01_API_KEY || "";

// Chat history en memoire (pour un usage personnel, suffisant)
// Pour multi-device sync, le mark01-api devrait stocker ca
interface ChatMessage {
  id: string;
  source: "TEXTE" | "VOCAL" | "WEB";
  userMessage: string;
  jarvisResponse: string;
  timestamp: number;
}

const chatHistory: ChatMessage[] = [];
const MAX_HISTORY = 200;

// GET - Recuperer l'historique
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  return NextResponse.json({ messages: chatHistory });
}

// POST - Envoyer un message
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

    // Envoyer au mark01-api
    const apiResponse = await fetch(`${MARK01_API_URL}/voice-code`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MARK01_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: message.trim(),
        mode: "text",
        response_format: "text",
      }),
    });

    let jarvisResponse = "Erreur de communication avec Jarvis.";

    if (apiResponse.ok) {
      const data = await apiResponse.json();
      jarvisResponse = data.response || data.details || jarvisResponse;
    } else {
      const errorText = await apiResponse.text().catch(() => "");
      jarvisResponse = `Erreur ${apiResponse.status}: ${errorText.slice(0, 200)}`;
    }

    // Sauvegarder dans l'historique
    const chatMsg: ChatMessage = {
      id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "WEB",
      userMessage: message.trim(),
      jarvisResponse,
      timestamp: Date.now(),
    };

    chatHistory.push(chatMsg);

    // Limiter la taille
    while (chatHistory.length > MAX_HISTORY) {
      chatHistory.shift();
    }

    return NextResponse.json({
      id: chatMsg.id,
      response: jarvisResponse,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
