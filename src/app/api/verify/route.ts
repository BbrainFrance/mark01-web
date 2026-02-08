import { NextRequest, NextResponse } from "next/server";
import { verifyOTPToken } from "@/lib/otp-token";
import { createToken } from "@/lib/auth";

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "@eb80114!";

export async function POST(req: NextRequest) {
  try {
    const { otp, password, otpToken } = await req.json();

    // Re-valider le mot de passe
    if (password !== AUTH_PASSWORD) {
      return NextResponse.json({ error: "Session invalide" }, { status: 401 });
    }

    if (!otp || otp.length !== 6) {
      return NextResponse.json({ error: "Code invalide" }, { status: 400 });
    }

    if (!otpToken) {
      return NextResponse.json(
        { error: "Session expiree. Recommencez la connexion." },
        { status: 401 }
      );
    }

    // Decoder le token OTP pour recuperer le vrai code
    const expectedCode = await verifyOTPToken(otpToken);

    if (!expectedCode) {
      return NextResponse.json(
        { error: "Code expire. Recommencez la connexion." },
        { status: 401 }
      );
    }

    if (otp !== expectedCode) {
      return NextResponse.json({ error: "Code incorrect" }, { status: 401 });
    }

    // Succes! Emettre le JWT de session (7 jours)
    const token = await createToken();

    return NextResponse.json({ token, message: "Authentifie" });
  } catch {
    return NextResponse.json({ error: "Requete invalide" }, { status: 400 });
  }
}
