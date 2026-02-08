import { NextRequest, NextResponse } from "next/server";
import { setOTP } from "@/lib/otp-store";

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "@eb80114!";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Rate limiting
const attempts = new Map<string, { count: number; blockedUntil: number }>();

function getIP(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getIP(req);

  // Rate limit check
  const entry = attempts.get(ip);
  if (entry && Date.now() < entry.blockedUntil) {
    return NextResponse.json(
      { error: "Trop de tentatives. Reessayez dans 15 minutes." },
      { status: 429 }
    );
  }

  try {
    const { password } = await req.json();

    if (password !== AUTH_PASSWORD) {
      // Incrementer les tentatives
      const e = attempts.get(ip) || { count: 0, blockedUntil: 0 };
      e.count++;
      if (e.count >= 5) {
        e.blockedUntil = Date.now() + 15 * 60 * 1000;
      }
      attempts.set(ip, e);

      return NextResponse.json(
        { error: "Mot de passe incorrect" },
        { status: 401 }
      );
    }

    // Reset tentatives
    attempts.delete(ip);

    // Generer OTP 6 chiffres
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setOTP(code);

    // Envoyer via Telegram
    const sent = await sendTelegramOTP(code);
    if (!sent) {
      return NextResponse.json(
        { error: "Impossible d'envoyer le code OTP." },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Code envoye sur Telegram" });
  } catch {
    return NextResponse.json({ error: "Requete invalide" }, { status: 400 });
  }
}

async function sendTelegramOTP(code: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: `🔐 Mark01 Web Login\n\nCode : ${code}\n\nExpire dans 5 minutes.`,
          parse_mode: "HTML",
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
