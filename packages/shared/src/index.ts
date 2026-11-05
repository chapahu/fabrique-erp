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

// Transfert de stock entre deux emplacements (ex. atelier -> boutique)
export const transferInput = z
  .object({
    itemId: id("Article"),
    fromLocationId: id("Emplacement de départ"),
    toLocationId: id("Emplacement d'arrivée"),
    quantity: z.number("Quantité requise").positive("La quantité doit être supérieure à 0"),
  })
  .refine((t) => t.fromLocationId !== t.toLocationId, {
    message: "Le départ et l'arrivée doivent être différents",
    path: ["toLocationId"],
  });
export type TransferInput = z.infer<typeof transferInput>;

// Vente en boutique
export const saleInput = z.object({
  itemId: id("Article"),
  locationId: id("Boutique"),
  quantity: z.number("Quantité requise").positive("La quantité doit être supérieure à 0"),
});
export type SaleInput = z.infer<typeof saleInput>;

// ---------------------------------------------------------------------
// Rôles et permissions : QUI a le droit de faire QUOI.
// Partagé : l'API s'en sert pour REFUSER (sécurité), l'interface pour CACHER les boutons (confort).
// ---------------------------------------------------------------------
export const roles = ["admin", "production", "achats", "boutique"] as const;
export type Role = (typeof roles)[number];

export const roleLabels: Record<Role, string> = {
  admin: "Direction",
  production: "Atelier",
  achats: "Achats",
  boutique: "Boutique",
};

export const permissions = {
  reception: ["admin", "achats", "production"],
  production: ["admin", "production"],
  transfer: ["admin", "production"],
  sale: ["admin", "boutique"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof permissions;

export const can = (role: Role | undefined, permission: Permission) =>
  role !== undefined && (permissions[permission] as readonly Role[]).includes(role);

export const loginInput = z.object({
  email: z.email("E-mail invalide"),
  password: z.string("Mot de passe requis").min(1, "Mot de passe requis"),
});

export const productionStatuses = ["planifie", "en_cours", "termine", "annule"] as const;
export type ProductionStatus = (typeof productionStatuses)[number];
