// Petits composants réutilisés sur toutes les pages (cohérence visuelle, moins de répétition).
import type { ReactNode } from "react";
import { ApiError } from "./api";

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
export const fmtQty = (n: number, unit?: string) => `${numberFormat.format(n)}${unit ? ` ${unit}` : ""}`;

export const fmtDate = (value: string | null) => {
  if (!value) return "—";
  // "2026-11-06" (date) ou "2026-11-06T10:58:36Z" (instant)
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtDateTime = (value: string) =>
  new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {title && <h2 className="border-b border-stone-100 px-5 py-3 text-sm font-semibold text-stone-700">{title}</h2>}
      <div className="p-5">{children}</div>
    </section>
  );
}

const badgeColors = {
  gray: "bg-stone-100 text-stone-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-800",
} as const;

export function Badge({ color = "gray", children }: { color?: keyof typeof badgeColors; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeColors[color]}`}>
      {children}
    </span>
  );
}

const statusLabels = {
  planifie: { label: "Planifié", color: "blue" },
  en_cours: { label: "En cours", color: "amber" },
  termine: { label: "Terminé", color: "green" },
  annule: { label: "Annulé", color: "gray" },
} as const;

export function StatusBadge({ status }: { status: keyof typeof statusLabels }) {
  const s = statusLabels[status];
  return <Badge color={s.color}>{s.label}</Badge>;
}

export const itemTypeLabels = {
  matiere_premiere: "Matière première",
  emballage: "Emballage",
  produit_fini: "Produit fini",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const styles =
    variant === "primary"
      ? "bg-amber-700 text-white hover:bg-amber-800"
      : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50";
  return (
    <button
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 focus:outline-none";

/** Affiche une erreur de l'API, y compris la liste des matières manquantes pour un OF. */
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Erreur inattendue";
  const details = error instanceof ApiError ? (error.details as { manquants?: { item: string; needed: number; available: number; unit: string }[] }) : undefined;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="font-medium">{message}</p>
      {details?.manquants && (
        <ul className="mt-2 list-inside list-disc">
          {details.manquants.map((m) => (
            <li key={m.item}>
              {m.item} : besoin {fmtQty(m.needed, m.unit)}, disponible {fmtQty(m.available, m.unit)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Loading() {
  return <p className="text-sm text-stone-400">Chargement…</p>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2";

/** Transforme les erreurs Zod en { champ: message } pour les afficher sous chaque champ. */
export function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}
