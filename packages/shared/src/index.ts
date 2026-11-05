// Schémas de validation PARTAGÉS entre l'API et l'interface web.
// Une seule source de vérité : le formulaire et le serveur appliquent exactement les mêmes règles.
// - côté web : on affiche l'erreur tout de suite, sans aller-retour serveur (confort)
// - côté API : on revérifie toujours, car on ne fait jamais confiance au client (sécurité)
import { z } from "zod";

const id = (label: string) => z.number(`${label} requis`).int().positive(`${label} requis`);

export const receptionInput = z.object({
  itemId: id("Article"),
  supplierId: id("Fournisseur"),
  locationId: id("Emplacement"),
  lotNumber: z.string("Numéro de lot requis").trim().min(1, "Numéro de lot requis").max(50, "50 caractères maximum"),
  quantity: z.number("Quantité requise").positive("La quantité doit être supérieure à 0"),
  expiresOn: z.iso.date("Date invalide").optional(),
});
export type ReceptionInput = z.infer<typeof receptionInput>;

export const productionOrderInput = z.object({
  recipeId: id("Recette"),
  locationId: id("Site"),
  plannedQuantity: z.number("Quantité requise").positive("La quantité doit être supérieure à 0"),
  plannedFor: z.iso.date("Date requise"),
});
export type ProductionOrderInput = z.infer<typeof productionOrderInput>;

export const completeProductionInput = z.object({
  producedQuantity: z.number().positive("La quantité produite doit être supérieure à 0").optional(),
});

export const productionStatuses = ["planifie", "en_cours", "termine", "annule"] as const;
export type ProductionStatus = (typeof productionStatuses)[number];
