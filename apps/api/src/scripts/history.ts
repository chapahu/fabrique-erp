// =====================================================================
// REPRISE D'HISTORIQUE (données fictives mais réalistes)
//
// Dans la vraie vie, quand on remplace un ERP, on IMPORTE l'historique de l'ancien logiciel
// pour ne pas perdre le passé. Ici, on le GÉNÈRE : 3 ans de ventes jour par jour,
// avec les mêmes "habitudes" qu'une vraie biscuiterie :
//   - tendance   : +9 % par an (l'entreprise grandit)
//   - semaine    : le samedi vend ~2x plus que le lundi
//   - année      : gros pic avant Noël, creux en août
//   - événements : fermeture le 25/12, le 1/01 et le 1/05 ; lancement du cookie caramel en 2024
//   - hasard     : chaque jour varie un peu (comme dans la réalité)
// Ces motifs sont exactement ce que l'algorithme Holt-Winters saura retrouver pour prévoir.
//
// Le générateur est "déterministe" (graine fixe) : relancer le script donne le même historique.
// Commande : npm run db:history  (remplace l'historique existant, ne touche pas aux ventes réelles)
// =====================================================================
import { pool } from "../db";

// ---------- Générateur de nombres aléatoires reproductible (graine fixe) ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);
/** Bruit "en cloche" autour de 0 (somme de 3 tirages uniformes) */
const noise = (spread: number) => ((rand() + rand() + rand()) / 3 - 0.5) * 2 * spread;

// ---------- Les habitudes de vente ----------
// Lundi..Dimanche (getDay : 0 = dimanche)
const weekday = [1.15, 0.75, 0.85, 0.95, 0.95, 1.1, 1.45];
// Janvier..Décembre
const month = [0.85, 0.97, 0.95, 1.0, 0.95, 0.9, 0.8, 0.65, 0.95, 1.0, 1.1, 1.45];
// Ventes de base d'un jour "moyen" en cookies chocolat, par boutique
const shopBase: Record<string, number> = {
  "BTQ-MARAIS": 120, "BTQ-STGERMAIN": 110, "BTQ-MONTMARTRE": 90, "BTQ-LYON": 85,
  "BTQ-BORDEAUX": 70, "BTQ-LILLE": 62, "BTQ-NIORT": 45,
};
// Poids de chaque produit par rapport au cookie chocolat
const productMix: Record<string, number> = {
  "PF-COOKIE-CHOCO": 1.0, "PF-COOKIE-PECAN": 0.45, "PF-COOKIE-CARAMEL": 0.6,
  "PF-COOKIE-DOUBLE": 0.5, "PF-MADELEINE": 0.9, "PF-CAKE-CITRON": 0.07,
};
const CARAMEL_LAUNCH = new Date("2024-09-01");

const YEARS = 3;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const shops = (await pool.query("SELECT id, code, opened_on FROM locations WHERE type = 'boutique'")).rows;
  const products = (await pool.query("SELECT id, sku, sale_price, b2b_price FROM items WHERE type = 'produit_fini'")).rows;
  const customers = (await pool.query("SELECT id, name, city FROM customers ORDER BY id")).rows;
  const sites = Object.fromEntries(
    (await pool.query("SELECT id, code FROM locations WHERE type = 'production'")).rows.map((r) => [r.code, r.id]),
  );
  if (products.length < 6 || customers.length === 0) {
    throw new Error("Catalogue incomplet : lance d'abord npm run db:seed");
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - YEARS);

  // Colonnes à insérer, préparées en tableaux (insertion groupée = beaucoup plus rapide)
  const cols = { sold_at: [] as string[], channel: [] as string[], location: [] as number[], customer: [] as (number | null)[],
    item: [] as number[], qty: [] as number[], price: [] as number[] };
  const push = (day: Date, hour: number, channel: string, location: number, customer: number | null, item: number, qty: number, price: number) => {
    if (qty <= 0) return;
    cols.sold_at.push(`${iso(day)}T${String(hour).padStart(2, "0")}:00:00+01:00`);
    cols.channel.push(channel); cols.location.push(location); cols.customer.push(customer);
    cols.item.push(item); cols.qty.push(qty); cols.price.push(price);
  };

  for (let day = new Date(start); day < today; day.setUTCDate(day.getUTCDate() + 1)) {
    const m = day.getUTCMonth(), d = day.getUTCDate(), w = day.getUTCDay();
    if ((m === 11 && d === 25) || (m === 0 && d === 1) || (m === 4 && d === 1)) continue; // jours fériés : fermé
    const yearsFromStart = (day.getTime() - start.getTime()) / (365.25 * 86400000);
    const trend = Math.pow(1.09, yearsFromStart);
    const christmasRush = m === 11 && d >= 14 && d <= 24 ? 1.3 : 1;
    const priceIndex = Math.pow(0.96, YEARS - yearsFromStart); // les prix ont augmenté de ~4 %/an

    // --- Ventes en boutique ---
    for (const shop of shops) {
      if (shop.opened_on && day < new Date(shop.opened_on)) continue;
      // une boutique qui vient d'ouvrir monte en puissance sur 6 mois
      const ageMonths = shop.opened_on ? (day.getTime() - new Date(shop.opened_on).getTime()) / (30.4 * 86400000) : 99;
      const rampUp = Math.min(1, 0.55 + ageMonths * 0.075);
      for (const p of products) {
        let mix = productMix[p.sku] ?? 0;
        if (p.sku === "PF-COOKIE-CARAMEL") {
          if (day < CARAMEL_LAUNCH) continue;
          const monthsSinceLaunch = (day.getTime() - CARAMEL_LAUNCH.getTime()) / (30.4 * 86400000);
          mix *= Math.min(1, 0.4 + monthsSinceLaunch * 0.1); // succès progressif après le lancement
        }
        const expected = (shopBase[shop.code] ?? 50) * mix * trend * weekday[w] * month[m] * christmasRush * rampUp;
        const qty = Math.round(expected * (1 + noise(0.18)));
        push(day, 13, "boutique", shop.id, null, p.id, qty, Number((Number(p.sale_price) * priceIndex).toFixed(2)));
      }
    }

    // --- Commandes B2B : chaque client commande 1 à 2 fois par semaine, toujours le même jour ---
    customers.forEach((c, index) => {
      const orderDays = [(index % 5) + 1, ((index + 2) % 5) + 1]; // jours ouvrés
      const ordersTwice = index % 3 === 0;
      if (!(w === orderDays[0] || (ordersTwice && w === orderDays[1]))) return;
      if (m === 7 && c.name.includes("Restauration municipale")) return; // cantine fermée en août
      const west = ["Niort", "La Rochelle", "Bordeaux"].includes(c.city);
      if (west && day < new Date("2023-11-01")) return; // clients de l'ouest arrivés avec le rachat d'Ardin
      const site = west ? sites.ARD : sites.GEN;
      const size = (0.6 + (index % 4) * 0.35) * trend * (m === 7 ? 0.6 : 1);
      const lines: [string, number][] = [["PF-COOKIE-CHOCO", 180], ["PF-MADELEINE", 240], ["PF-CAKE-CITRON", 12]];
      if (index % 2 === 0) lines.push(["PF-COOKIE-PECAN", 80]);
      for (const [sku, base] of lines) {
        const p = products.find((x) => x.sku === sku)!;
        const qty = Math.round(base * size * (1 + noise(0.25)));
        push(day, 9, "b2b", site, c.id, p.id, qty, Number((Number(p.b2b_price) * priceIndex).toFixed(2)));
      }
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query("DELETE FROM sales WHERE source = 'historique'");
    const BATCH = 5000;
    for (let i = 0; i < cols.item.length; i += BATCH) {
      const s = (arr: unknown[]) => arr.slice(i, i + BATCH);
      // unnest : transforme des tableaux en lignes -> une seule requête pour 5 000 ventes
      await client.query(
        `INSERT INTO sales (sold_at, channel, location_id, customer_id, item_id, quantity, unit_price, source)
         SELECT *, 'historique' FROM unnest($1::timestamptz[], $2::text[], $3::int[], $4::int[], $5::int[], $6::numeric[], $7::numeric[])`,
        [s(cols.sold_at), s(cols.channel), s(cols.location), s(cols.customer), s(cols.item), s(cols.qty), s(cols.price)],
      );
    }
    await client.query("COMMIT");
    console.log(`🗑️  ${removed.rowCount} anciennes lignes d'historique remplacées`);
    console.log(`✅ ${cols.item.length.toLocaleString("fr-FR")} lignes de ventes générées du ${iso(start)} au ${iso(new Date(today.getTime() - 86400000))}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
