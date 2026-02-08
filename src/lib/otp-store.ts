// Store OTP en memoire, partage entre les routes API
// Sur Vercel serverless, les fonctions dans le meme bundle partagent le module cache

interface OTPEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

const store = new Map<string, OTPEntry>();

export function setOTP(code: string) {
  store.set("current", {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    attempts: 0,
  });
}

export function getOTP(): OTPEntry | undefined {
  return store.get("current");
}

export function deleteOTP() {
  store.delete("current");
}

export function incrementAttempts(): number {
  const entry = store.get("current");
  if (entry) {
    entry.attempts++;
    return entry.attempts;
  }
  return 0;
}
