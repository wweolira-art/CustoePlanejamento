import { createHash, scrypt, timingSafeEqual } from "node:crypto";

function equalBytes(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function derive(password: string, salt: string | Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Legacy scrypt$salt$key uses base64url components and Node's default cost. */
export async function verifyPassword(password: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== "string" || !password) return false;
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return equalBytes(createHash("sha256").update(password, "utf8").digest(), Buffer.from(stored, "hex"));
  }

  const match = /^scrypt\$([A-Za-z0-9_-]{16,128})\$([A-Za-z0-9_-]{22,128})$/.exec(stored);
  if (!match) return false;
  const [, saltText, keyText] = match;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  if (salt.toString("base64url") !== saltText || expected.toString("base64url") !== keyText) return false;
  if (salt.length < 12 || expected.length < 16 || expected.length > 96) return false;

  // Legacy producers may pass the encoded salt directly to scrypt or decode it first.
  for (const candidate of [saltText, salt]) {
    if (equalBytes(await derive(password, candidate, expected.length), expected)) return true;
  }
  return false;
}
