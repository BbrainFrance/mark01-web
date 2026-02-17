import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "mark01-jwt-secret-default"
);

export async function createToken(): Promise<string> {
  return new SignJWT({ sub: "mark01-user", role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifie l'authentification via JWT (web) ou cle API Mark2 (Android).
 */
export async function verifyAuth(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const mark2Key = process.env.MARK2_API_KEY || process.env.MARK01_API_KEY || "";
  if (mark2Key && token === mark2Key) return true;
  return verifyToken(token);
}
