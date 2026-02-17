import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const MARK2_API_URL = process.env.MARK2_API_URL || process.env.MARK01_API_URL || "http://76.13.42.188:3456";
const MARK2_API_KEY = process.env.MARK2_API_KEY || process.env.MARK01_API_KEY || "";

const mark2Headers = {
  "Authorization": `Bearer ${MARK2_API_KEY}`,
  "Content-Type": "application/json",
};

// GET - Recuperer l'historique depuis Mark2
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const agentId = req.nextUrl.searchParams.get("agentId") || "jarvis";

  try {
    const res = await fetch(`${MARK2_API_URL}/history/${agentId}?limit=100`, {
      headers: mark2Headers,
    });

    if (!res.ok) {
      return NextResponse.json({ messages: [] });
    }

    const data = await res.json();
    const mark2Messages = data.messages || [];

    // Convertir le format Mark2 en format attendu par le front
    // Mark2 stocke des messages individuels {role, content, timestamp, source}
    // Le front attend des paires {userMessage, jarvisResponse}
    const paired: Array<{
      id: string;
      source: string;
      userMessage: string;
      jarvisResponse: string;
      timestamp: number;
    }> = [];

    for (let i = 0; i < mark2Messages.length; i++) {
      const msg = mark2Messages[i];
      if (msg.role === "user") {
        const next = mark2Messages[i + 1];
        const jarvisResponse = next && next.role === "assistant" ? next.content : "";
        paired.push({
          id: `mark2-${msg.timestamp}-${i}`,
          source: msg.source || "WEB",
          userMessage: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          jarvisResponse: typeof jarvisResponse === "string" ? jarvisResponse : JSON.stringify(jarvisResponse),
          timestamp: msg.timestamp,
        });
        if (next && next.role === "assistant") i++;
      }
    }

    return NextResponse.json({ messages: paired });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

// POST - Envoyer un message via Mark2
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const { message, source, agentId } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message vide" }, { status: 400 });
    }

    const msgSource = source === "APPEL" ? "APPEL" : "WEB";
    const effectiveAgentId = agentId || "jarvis";

    // Envoyer directement a Mark2 - il gere l'historique automatiquement
    let jarvisResponse = "Erreur de communication avec Jarvis.";
    let responseModel = "";

    try {
      const apiResponse = await fetch(`${MARK2_API_URL}/chat`, {
        method: "POST",
        headers: mark2Headers,
        body: JSON.stringify({
          message: message.trim(),
          agentId: effectiveAgentId,
          source: msgSource,
        }),
      });

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        jarvisResponse = data.response || jarvisResponse;
        responseModel = data.model || "";
      } else {
        const errorData = await apiResponse.json().catch(() => ({ error: "Erreur inconnue" }));
        jarvisResponse = `Erreur ${apiResponse.status}: ${errorData.error || ""}`;
      }
    } catch (e) {
      jarvisResponse = `Erreur de connexion: ${e instanceof Error ? e.message : "inconnue"}`;
    }

    const msgId = `${msgSource.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return NextResponse.json({
      id: msgId,
      response: jarvisResponse,
      model: responseModel,
      agentId: effectiveAgentId,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
