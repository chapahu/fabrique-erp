import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/** Erreur "prévue" avec un code HTTP : 404 introuvable, 409 conflit métier, etc. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Gestionnaire d'erreurs central : toutes les erreurs des routes arrivent ici.
 * - données invalides (Zod)      -> 400 avec la liste des champs fautifs
 * - erreur métier (HttpError)    -> son code et son message
 * - tout le reste (bug)          -> 500, détail dans les logs, message neutre au client
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Données invalides",
      details: error.issues.map((i) => ({ champ: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }
  // Violation d'unicité PostgreSQL (ex. numéro de lot déjà utilisé)
  if (error?.code === "23505") {
    res.status(409).json({ error: "Cet élément existe déjà", details: error.detail });
    return;
  }
  // Clé étrangère invalide (ex. itemId qui n'existe pas)
  if (error?.code === "23503") {
    res.status(400).json({ error: "Référence inconnue", details: error.detail });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Erreur interne du serveur" });
};
