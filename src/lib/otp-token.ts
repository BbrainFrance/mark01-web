import { SignJWT, jwtVerify } from "jose";

const OTP_SECRET = new TextEncoder().encode(
  (process.env.JWT_SECRET || "mark01-jwt-secret-default") + "-otp"
);

/**
 * Encode l'OTP dans un token JWT signe (expire en 5 min).
 * Le client recoit ce token et le renvoie avec le code saisi.
 * Le serveur decode le token pour verifier le code.
 * Comme le token est signe, il ne peut pas etre modifie cote client.
 */
export async function createOTPToken(code: string): Promise<string> {
  return new SignJWT({ code })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(OTP_SECRET);
}

/**
 * Verifie le token OTP et retourne le code stocke dedans.
 * Retourne null si le token est invalide ou expire.
 */
export async function verifyOTPToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, OTP_SECRET);
    return (payload.code as string) || null;
  } catch {
    return null;
  }
}
