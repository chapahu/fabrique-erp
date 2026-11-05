// Tout ce qui parle à l'API est ici : les types des réponses et les "hooks" TanStack Query.
// Les pages n'appellent jamais fetch directement : un seul endroit à modifier si l'API change.
import type { ProductionOrderInput, ProductionStatus, ReceptionInput } from "@fabrique/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------- Types des données renvoyées par l'API ----------
export type Location = { id: number; code: string; name: string; type: "production" | "boutique" | "entrepot" };
export type Supplier = { id: number; name: string };
export type Item = {
  id: number;
  sku: string;
  name: string;
  type: "matiere_premiere" | "emballage" | "produit_fini";
  unit: string;
};
export type Recipe = { id: number; name: string; product: string; yield_quantity: number };
export type StockRow = {
  location_id: number;
  location: string;
  item_id: number;
  sku: string;
  item: string;
  type: Item["type"];
  unit: string;
  quantity: number;
  min_stock: number;
  below_min: boolean;
  next_expiry: string | null;
};
export type StockLot = {
  lot_id: number;
  lot_number: string;
  expires_on: string | null;
  quantity: number;
  item: string;
  unit: string;
};
export type ProductionOrder = {
  id: number;
  number: string;
  status: ProductionStatus;
  planned_for: string;
  planned_quantity: number;
  produced_quantity: number | null;
  finished_at: string | null;
  product: string;
  unit: string;
  location: string;
};
export type ProductionOrderDetail = ProductionOrder & {
  needs: { item_id: number; item: string; unit: string; needed: number; available: number }[];
};
export type LotSearchRow = {
  id: number;
  lot_number: string;
  expires_on: string | null;
  item: string;
  quantity: number;
  unit: string;
};
export type LotTrace = {
  lot: {
    id: number;
    lot_number: string;
    expires_on: string | null;
    item: string;
    unit: string;
    supplier: string | null;
    production_order: string | null;
  };
  upstream: { lot_id: number; lot_number: string; item: string; quantity_used: number; unit: string }[];
  downstream: { production_order: string; lot_id: number; lot_number: string; item: string; quantity_used: number }[];
  history: { created_at: string; type: string; quantity: number; location: string; production_order: string | null }[];
};

export type Activity = {
  id: number;
  created_at: string;
  type: "reception" | "consommation" | "production" | "vente" | "transfert" | "perte" | "ajustement";
  quantity: number;
  item: string;
  unit: string;
  location: string;
  lot_number: string;
  production_order: string | null;
};

// ---------- Appel HTTP générique ----------
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`, data?.details);
  return data as T;
}

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

// ---------- Lectures (useQuery) ----------
// queryKey = l'identifiant de la donnée en cache. Même clé = même donnée partagée entre les pages.
export const useLocations = () => useQuery({ queryKey: ["locations"], queryFn: () => api<Location[]>("/locations") });
export const useSuppliers = () => useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/suppliers") });
export const useItems = () => useQuery({ queryKey: ["items"], queryFn: () => api<Item[]>("/items") });
export const useRecipes = () => useQuery({ queryKey: ["recipes"], queryFn: () => api<Recipe[]>("/recipes") });

export const useStock = (locationId?: number) =>
  useQuery({
    queryKey: ["stock", locationId ?? "all"],
    queryFn: () => api<StockRow[]>(`/stock${locationId ? `?locationId=${locationId}` : ""}`),
  });

export const useStockLots = (locationId?: number) =>
  useQuery({
    queryKey: ["stock-lots", locationId ?? "all"],
    queryFn: () => api<StockLot[]>(`/stock/lots${locationId ? `?locationId=${locationId}` : ""}`),
  });

export const useProductionOrders = () =>
  useQuery({ queryKey: ["production-orders"], queryFn: () => api<ProductionOrder[]>("/production-orders") });

export const useProductionOrder = (id: number | null) =>
  useQuery({
    queryKey: ["production-orders", id],
    queryFn: () => api<ProductionOrderDetail>(`/production-orders/${id}`),
    enabled: id !== null, // ne rien charger tant qu'aucun OF n'est sélectionné
  });

export const useActivity = () =>
  useQuery({ queryKey: ["activity"], queryFn: () => api<Activity[]>("/activity?limit=12"), refetchInterval: 2000 });

export const useLotSearch =(search: string) =>
  useQuery({
    queryKey: ["lots", search],
    queryFn: () => api<LotSearchRow[]>(`/lots?search=${encodeURIComponent(search)}`),
  });

export const useLotTrace = (id: number | null) =>
  useQuery({
    queryKey: ["lot-trace", id],
    queryFn: () => api<LotTrace>(`/lots/${id}/trace`),
    enabled: id !== null,
  });

// ---------- Écritures (useMutation) ----------
// Après une écriture, on "invalide" les données concernées : TanStack Query les recharge.
function useInvalidateStockAndProduction() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["stock"] });
    qc.invalidateQueries({ queryKey: ["stock-lots"] });
    qc.invalidateQueries({ queryKey: ["production-orders"] });
    qc.invalidateQueries({ queryKey: ["lots"] });
  };
}

export function useCreateReception() {
  const invalidate = useInvalidateStockAndProduction();
  return useMutation({
    mutationFn: (input: ReceptionInput) => post<{ lot: { lot_number: string } }>("/receptions", input),
    onSuccess: invalidate,
  });
}

export function useCreateProductionOrder() {
  const invalidate = useInvalidateStockAndProduction();
  return useMutation({
    mutationFn: (input: ProductionOrderInput) => post<{ id: number; number: string }>("/production-orders", input),
    onSuccess: invalidate,
  });
}

export function useStartProductionOrder() {
  const invalidate = useInvalidateStockAndProduction();
  return useMutation({
    mutationFn: (id: number) => post(`/production-orders/${id}/start`),
    onSuccess: invalidate,
  });
}

export function useCompleteProductionOrder() {
  const invalidate = useInvalidateStockAndProduction();
  return useMutation({
    mutationFn: ({ id, producedQuantity }: { id: number; producedQuantity?: number }) =>
      post<{ number: string; produced: number }>(`/production-orders/${id}/complete`, { producedQuantity }),
    onSuccess: invalidate,
  });
}
