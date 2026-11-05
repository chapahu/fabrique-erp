// =====================================================================
// AUTHENTIFICATION ("qui es-tu ?") et AUTORISATION ("as-tu le droit ?")
//
// 1. POST /api/auth/login : e-mail + mot de passe vérifiés -> on remet un "badge"
//    (un jeton aléatoire) dans un cookie que le navigateur renverra à chaque requête.
// 2. requireAuth : à chaque requête, on lit le badge et on retrouve l'utilisateur.
// 3. requirePermission : on vérifie que son rôle autorise l'action demandée.
// =====================================================================
import { can, loginInput, type Permission, type Role } from "@fabrique/shared";
import { createHash, randomBytes } from "node:crypto";
import { type RequestHandler, type Response, Router } from "express";
import { z } from "zod";
import { pool } from "./db";
import { HttpError } from "./errors";
import { verifyPassword } from "./passwords";

export type AuthUser = { id: number; email: string; name: string; role: Role; location_id: number | null };

// On "ajoute" une propriété user à toutes les requêtes Express (pour TypeScript)
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE = "session";
const SESSION_HOURS = 8; // une journée de travail
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Lit un cookie dans l'en-tête "Cookie: a=1; session=xyz" envoyé par le navigateur. */
function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export const authRouter = Router();

/** Crée un badge pour cet utilisateur et le dépose dans un cookie. */
async function openSession(res: Response, userId: number) {
  // Le badge : 32 octets aléatoires, impossibles à deviner. On ne garde en base que son empreinte.
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [sha256(token), userId, SESSION_HOURS],
  );
  // Cookie httpOnly : le JavaScript de la page ne peut pas le lire (protège contre le vol par script)
  // sameSite=lax : le navigateur ne l'envoie pas depuis un autre site (protège contre les requêtes forgées)
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // en ligne : uniquement en HTTPS
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: "/",
  });
}

// ---------------------------------------------------------------------
// MODE DÉMO : choisir un rôle en un clic, sans mot de passe.
// Interrupteur DEMO_MODE=true dans .env. Éteint (par défaut), ces routes répondent 404 :
// la porte n'existe tout simplement pas. À n'utiliser qu'avec des données fictives.
// ---------------------------------------------------------------------
const demoMode = () => process.env.DEMO_MODE === "true";

authRouter.get("/auth/demo-accounts", async (_req, res) => {
  if (!demoMode()) throw new HttpError(404, "Mode démo désactivé");
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.role, l.name AS location
     FROM users u LEFT JOIN locations l ON l.id = u.location_id
     WHERE u.active AND u.email <> 'simulateur@fabrique.test'
     ORDER BY CASE u.role WHEN 'admin' THEN 1 WHEN 'production' THEN 2 WHEN 'achats' THEN 3 ELSE 4 END, u.name`,
  );
  res.json(rows);
});

authRouter.post("/auth/demo-login", async (req, res) => {
  if (!demoMode()) throw new HttpError(404, "Mode démo désactivé");
  const { userId } = z.object({ userId: z.number().int().positive() }).parse(req.body);
  const { rows } = await pool.query(
    "SELECT id, email, name, role, location_id FROM users WHERE id = $1 AND active",
    [userId],
  );
  if (rows.length === 0) throw new HttpError(404, "Compte introuvable");
  await openSession(res, rows[0].id);
  res.json(rows[0]);
});

// ---------------------------------------------------------------------
// Connexion classique : e-mail + mot de passe
// ---------------------------------------------------------------------
authRouter.post("/auth/login", async (req, res) => {
  const { email, password } = loginInput.parse(req.body);
  const { rows } = await pool.query(
    "SELECT id, email, name, role, location_id, password_hash FROM users WHERE email = lower($1) AND active",
    [email],
  );
  const user = rows[0];
  // Même message que l'e-mail existe ou non : on ne donne pas d'indice à un attaquant
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "E-mail ou mot de passe incorrect");
  }

  await openSession(res, user.id);
  const { password_hash: _, ...publicUser } = user;
  res.json(publicUser);
});

authRouter.post("/auth/logout", async (req, res) => {
  const token = readCookie(req.headers.cookie, COOKIE);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  res.clearCookie(COOKIE, { path: "/" });
  res.status(204).end();
});

/** Middleware : toute requête doit présenter un badge valide, sinon 401. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readCookie(req.headers.cookie, COOKIE);
  if (!token) throw new HttpError(401, "Connexion requise");
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.location_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  if (rows.length === 0) throw new HttpError(401, "Session expirée, reconnecte-toi");
  req.user = rows[0];
  next();
};

/** Middleware : le rôle de l'utilisateur doit autoriser cette action, sinon 403. */
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!can(req.user?.role, permission)) {
      throw new HttpError(403, "Ton rôle ne permet pas cette action");
    }
    next();
  };

// GET /api/auth/me : "qui suis-je ?" (l'interface s'en sert pour savoir si on est connecté)
authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});
