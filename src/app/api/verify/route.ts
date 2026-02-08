import { NextRequest, NextResponse } from "next/server";
import { getOTP, deleteOTP, incrementAttempts } from "@/lib/otp-store";
import { createToken } from "@/lib/auth";

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "@eb80114!";

export async function POST(req: NextRequest) {
  try {
    const { otp, password } = await req.json();

    // Re-valider le mot de passe
    if (password !== AUTH_PASSWORD) {
      return NextResponse.json({ error: "Session invalide" }, { status: 401 });
    }

    if (!otp || otp.length !== 6) {
      return NextResponse.json({ error: "Code invalide" }, { status: 400 });
    }

    const stored = getOTP();

    if (!stored) {
      return NextResponse.json(
        { error: "Aucun code en attente. Recommencez la connexion." },
        { status: 401 }
      );
    }

    // Trop de tentatives
    const attempts = incrementAttempts();
    if (attempts > 5) {
      deleteOTP();
      return NextResponse.json(
        { error: "Trop de tentatives. Redemandez un code." },
        { status: 429 }
      );
    }

    // Code expire
    if (Date.now() > stored.expiresAt) {
      deleteOTP();
      return NextResponse.json(
        { error: "Code expire. Redemandez un code." },
        { status: 401 }
      );
    }

    // Mauvais code
    if (otp !== stored.code) {
      return NextResponse.json({ error: "Code incorrect" }, { status: 401 });
    }

    // Succes!
    deleteOTP();
    const token = await createToken();

    return NextResponse.json({ token, message: "Authentifie" });
  } catch {
    return NextResponse.json({ error: "Requete invalide" }, { status: 400 });
  }
}
