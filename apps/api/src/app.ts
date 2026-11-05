import express from "express";
import { authRouter, requireAuth } from "./auth";
import { pool } from "./db";
import { errorHandler } from "./errors";
import { analyticsRouter } from "./routes/analytics";
import { commerceRouter } from "./routes/commerce";
import { copilotRouter } from "./routes/copilot";
import { dataRouter } from "./routes/data";
import { decisionsRouter } from "./routes/decisions";
import { productionRouter } from "./routes/production";
import { referentielRouter } from "./routes/referentiel";
import { stockRouter } from "./routes/stock";

export const app = express();

// Middleware : transforme le corps JSON des requêtes en objet JavaScript (req.body)
app.use(express.json());

// Health check : permet de vérifier que l'API ET la base répondent (utile en production)
app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});

// Connexion / déconnexion : accessibles sans badge (évidemment)
app.use("/api", authRouter);

// À partir d'ici, TOUTES les routes exigent d'être connecté
app.use("/api", requireAuth);

app.use("/api", referentielRouter);
app.use("/api", stockRouter);
app.use("/api", productionRouter);
app.use("/api", commerceRouter);
app.use("/api", analyticsRouter);
app.use("/api", dataRouter);
app.use("/api", copilotRouter);
app.use("/api", decisionsRouter);

// Route inconnue -> 404 en JSON
app.use((_req, res) => {
  res.status(404).json({ error: "Route introuvable" });
});

// En dernier : le gestionnaire d'erreurs (Express 5 y envoie aussi les erreurs des fonctions async)
app.use(errorHandler);
