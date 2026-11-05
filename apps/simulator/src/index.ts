// =====================================================================
// SIMULATEUR D'ACTIVITÉ : un "faux employé" qui fait vivre l'ERP.
//
// Toutes les quelques secondes, il fait une action réaliste :
//   🚚 livraison fournisseur quand une matière passe sous son seuil
//   🏭 planifier / démarrer / terminer des fournées de cookies
//   📦 envoyer des cookies de l'atelier vers les boutiques
//   🛍️ vendre des cookies en boutique
//
// Il passe par l'API, exactement comme l'interface : toutes les règles
// (validation, stock insuffisant...) s'appliquent aussi à lui.
// =====================================================================

const API = process.env.SIM_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}/api`;
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 4000);

// ---------- Petits outils ----------
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const today = () => new Date().toISOString().slice(0, 10);
const time = () => new Date().toLocaleTimeString("fr-FR");
const log = (icon: string, message: string) => console.log(`${time()}  ${icon}  ${message}`);

// ---------- Connexion : le simulateur a son propre compte, comme un employé ----------
let sessionCookie = "";

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.SIM_EMAIL, password: process.env.DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`connexion refusée (${res.status}) : lance "npm run db:seed" et vérifie .env`);
  // Le serveur renvoie le badge dans l'en-tête Set-Cookie : on le garde pour les requêtes suivantes
  sessionCookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  log("🔑", "Simulateur connecté");
}

/** Toute requête part avec le badge. Si le badge a expiré (401), on se reconnecte et on réessaie une fois. */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(`${API}${path}`, { ...init, headers: { ...init.headers, Cookie: sessionCookie } });
  let res = await send();
  if (res.status === 401) {
    await login();
    res = await send();
  }
  return res;
}

async function get<T>(path: string): Promise<T> {
  const res = await request(path);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/** Envoie une action à l'API. Renvoie null si l'API refuse (ex. stock insuffisant) : c'est normal, on réessaiera. */
async function post<T>(path: string, body: unknown = {}): Promise<T | null> {
  const res = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    log("⛔", `Refusé par l'API : ${data?.error ?? res.status}`);
    return null;
  }
  return data as T;
}

// ---------- Ce que le simulateur lit dans l'ERP ----------
type Location = { id: number; name: string; type: string };
type Item = { id: number; sku: string; name: string; type: string; unit: string; min_stock: number };
type Supplier = { id: number; name: string };
type Recipe = { id: number; name: string; yield_quantity: number };
type StockRow = { location_id: number; item_id: number; quantity: number; type: string };
type Order = { id: number; number: string; status: string; location: string; planned_quantity: number };

// Quel fournisseur livre quel article (d'après la référence SKU)
const supplierFor: Record<string, string> = {
  FARINE: "Minoterie du Poitou",
  BEURRE: "Laiterie Normande",
  OEUF: "Laiterie Normande",
  SUCRE: "Cacao & Co",
  CHOCO: "Cacao & Co",
  NOIX: "Cacao & Co",
  CARAMEL: "Cacao & Co",
  CITRON: "Minoterie du Poitou",
  MIEL: "Minoterie du Poitou",
  LEVURE: "Minoterie du Poitou",
  SACHET: "Emballages Verts",
  BOITE: "Emballages Verts",
};

let ref: { locations: Location[]; items: Item[]; suppliers: Supplier[]; recipes: Recipe[] };

async function loadReferenceData() {
  const [locations, items, suppliers, recipes] = await Promise.all([
    get<Location[]>("/locations"),
    get<Item[]>("/items"),
    get<Supplier[]>("/suppliers"),
    get<Recipe[]>("/recipes"),
  ]);
  ref = { locations, items, suppliers, recipes };
}

const stockOf = (stock: StockRow[], itemId: number, locationId: number) =>
  stock.filter((s) => s.item_id === itemId && s.location_id === locationId).reduce((sum, s) => sum + s.quantity, 0);

// ---------- Les actions ----------

/** 🚚 Le responsable achats commande ce qui manque ; le camion arrive. */
async function restock(stock: StockRow[]) {
  const sites = ref.locations.filter((l) => l.type === "production");
  const materials = ref.items.filter((i) => i.type !== "produit_fini");

  // On cherche une matière sous son seuil sur un site de production
  const missing = sites.flatMap((site) =>
    materials
      .filter((item) => stockOf(stock, item.id, site.id) < item.min_stock)
      .map((item) => ({ site, item })),
  );
  if (missing.length === 0) return false;

  const { site, item } = pick(missing);
  const key = Object.keys(supplierFor).find((k) => item.sku.includes(k));
  const supplier = ref.suppliers.find((s) => s.name === (key ? supplierFor[key] : ""));
  if (!supplier) return false;

  const quantity = item.min_stock * random(2, 4); // on commande 2 à 4 fois le seuil
  const lotNumber = `${key!.slice(0, 3)}-${today().replaceAll("-", "")}-${random(1000, 9999)}`;
  const ok = await post("/receptions", { itemId: item.id, supplierId: supplier.id, locationId: site.id, lotNumber, quantity });
  if (ok) log("🚚", `Livraison ${supplier.name} : ${quantity} ${item.unit} de ${item.name} → ${site.name} (lot ${lotNumber})`);
  return Boolean(ok);
}

/** 🏭 Le chef d'atelier fait avancer la production. */
async function produce() {
  const orders = await get<Order[]>("/production-orders");
  const running = orders.find((o) => o.status === "en_cours");
  const planned = orders.find((o) => o.status === "planifie");

  // 1. Une fournée est au four ? On la termine (avec un peu de casse : 95 à 100 %)
  if (running && Math.random() < 0.6) {
    const produced = Math.round(running.planned_quantity * (random(95, 100) / 100));
    const ok = await post(`/production-orders/${running.id}/complete`, { producedQuantity: produced });
    if (ok) log("🍪", `${running.number} terminé : ${produced} cookies sortis du four à ${running.location}`);
    return;
  }
  // 2. Une fournée est planifiée ? On la démarre
  if (planned && !running) {
    const ok = await post(`/production-orders/${planned.id}/start`);
    if (ok) log("▶️ ", `${planned.number} démarré à ${planned.location}`);
    return;
  }
  // 3. Rien de prévu ? On planifie une nouvelle fournée
  if (!planned) {
    const site = pick(ref.locations.filter((l) => l.type === "production"));
    const recipe = pick(ref.recipes);
    const quantity = recipe.yield_quantity * random(1, 2);
    const created = await post<{ number: string }>("/production-orders", {
      recipeId: recipe.id,
      locationId: site.id,
      plannedQuantity: quantity,
      plannedFor: today(),
    });
    if (created) log("📝", `${created.number} planifié : ${quantity} × ${recipe.name} à ${site.name}`);
  }
}

/** 📦 Le logisticien réapprovisionne une boutique en cookies. */
async function shipToShop(stock: StockRow[]) {
  const shops = ref.locations.filter((l) => l.type === "boutique");
  const sources = stock.filter(
    (s) => s.type === "produit_fini" && s.quantity >= 100 && ref.locations.find((l) => l.id === s.location_id)?.type === "production",
  );
  if (sources.length === 0) return;
  const from = pick(sources);
  const to = pick(shops);
  const quantity = Math.min(from.quantity, random(10, 30) * 10);
  const ok = await post("/transfers", { itemId: from.item_id, fromLocationId: from.location_id, toLocationId: to.id, quantity });
  const item = ref.items.find((i) => i.id === from.item_id);
  if (ok) log("📦", `${quantity} × ${item?.name} envoyés vers ${to.name}`);
}

/** 🛍️ Un client achète des cookies en boutique. */
async function sell(stock: StockRow[]) {
  const available = stock.filter(
    (s) => s.type === "produit_fini" && s.quantity > 0 && ref.locations.find((l) => l.id === s.location_id)?.type === "boutique",
  );
  if (available.length === 0) return;
  const row = pick(available);
  const quantity = Math.min(row.quantity, pick([1, 1, 2, 2, 3, 4, 6, 12]));
  const ok = await post("/sales", { itemId: row.item_id, locationId: row.location_id, quantity });
  const shop = ref.locations.find((l) => l.id === row.location_id);
  if (ok) log("🛍️", `Vente : ${quantity} cookie${quantity > 1 ? "s" : ""} à ${shop?.name}`);
}

// ---------- La boucle principale ----------
async function tick() {
  const stock = await get<StockRow[]>("/stock");
  // Priorité aux matières manquantes, sinon une action au hasard (les ventes sont les plus fréquentes)
  if (Math.random() < 0.5 && (await restock(stock))) return;
  const action = pick([produce, produce, shipToShop, sell, sell, sell]);
  await action(stock);
}

async function main() {
  console.log(`🍪 Simulateur démarré : une action toutes les ${INTERVAL_MS / 1000} s sur ${API}`);
  console.log("   (Ctrl+C pour arrêter)\n");
  await login();
  await loadReferenceData();
  for (;;) {
    try {
      await tick();
    } catch (error) {
      log("⚠️ ", `API injoignable (${(error as Error).message}). Nouvel essai au prochain tour.`);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main();
