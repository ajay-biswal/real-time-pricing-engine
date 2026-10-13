import bcrypt from "bcryptjs";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const BCRYPT_ROUNDS = 12;
const LEGACY_KEY_LENGTH = 64;

function deriveLegacyKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, LEGACY_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return bcrypt.compare(password, storedHash);
  }

  // Existing accounts created before the bcrypt migration remain able to sign in.
  const [algorithm, salt, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = await deriveLegacyKey(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isLegacyPasswordHash(storedHash: string): boolean {
  return storedHash.startsWith("scrypt$");
}
