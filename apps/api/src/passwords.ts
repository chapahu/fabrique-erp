// Mots de passe : on ne les stocke JAMAIS en clair.
// On stocke une "empreinte" (hash) calculée avec scrypt, un algorithme volontairement LENT :
// pour quelqu'un qui volerait la base, tester des milliards de mots de passe devient impossible.
// Le "sel" (salt) est une valeur aléatoire propre à chaque utilisateur : deux personnes avec
// le même mot de passe n'ont pas la même empreinte.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  // Comparaison en temps constant : ne révèle pas "combien de caractères étaient bons"
  return timingSafeEqual(actual, expected);
}
