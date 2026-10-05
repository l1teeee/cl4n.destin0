import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

export const MINIMUM_PASSWORD_LENGTH = 12;
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$3$Y2w0bi1kdW1teS1zYWx0IQ==$VhquywuA3ggEtJlA0DP1R8sd96uNpFd3vCht3myVIQObCfmewDCLXK2gtV4xai2F4F7hZwfaoPTnJ0mkLgPRFw==";

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { ...parameters, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${MINIMUM_PASSWORD_LENGTH} caracteres`);
  }

  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue, extra] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !nValue ||
    !rValue ||
    !pValue ||
    !saltValue ||
    !hashValue ||
    extra !== undefined
  ) {
    return false;
  }

  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  try {
    const expected = Buffer.from(hashValue, "base64");
    if (expected.length !== KEY_BYTES) {
      return false;
    }
    const actual = await deriveKey(password, Buffer.from(saltValue, "base64"), { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
