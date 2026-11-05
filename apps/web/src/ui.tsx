// =====================================================================
// BRIQUES D'INTERFACE réutilisées sur toutes les pages (cohérence visuelle).
// =====================================================================
import { ArrowDownRight, ArrowUpRight, Info, LoaderCircle, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "./api";

// ---------- Formats (à la française) ----------
const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const intFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const eurFormat = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eurCompact = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });

export const fmtQty = (n: number, unit?: string) => `${numberFormat.format(n)}${unit ? ` ${unit}` : ""}`;
export const fmtInt = (n: number) => intFormat.format(n);
export const fmtEur = (n: number) => eurFormat.format(n);
export const fmtEurCompact = (n: number) => eurCompact.format(n);
export const fmtPct = (ratio: number, digits = 0) =>
  `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;

export const fmtDate = (value: string | null) => {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
};
export const fmtDayShort = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const fmtMonth = (value: string) =>
  new Date(`${value}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
export const fmtDateTime = (value: string) =>
  new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------- Mise en page ----------
export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? "p-5" : "pt-3"}>{children}</div>
    </section>
  );
}

// ---------- Indicateurs ----------
/** Variation vs période précédente, avec flèche + texte (jamais la couleur seule) */
export function Delta({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  if (!previous) return <span className="text-xs text-muted">—</span>;
  const change = (current - previous) / Math.abs(previous);
  const flat = Math.abs(change) < 0.005;
  const good = inverse ? change < 0 : change > 0;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "text-muted" : good ? "text-good-text" : "text-critical";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon size={14} aria-hidden />
      {change > 0 ? "+" : ""}
      {fmtPct(change, 1)}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  hint,
  icon,
}: {
  label: string;
  value: string;
  delta?: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between text-xs font-medium text-ink-2">
        <span>{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {delta}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    </div>
  );
}

/** Choix exclusif compact (ex. 7 j / 30 j / 90 j) */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            o.value === value ? "bg-cocoa text-white" : "text-ink-2 hover:bg-page"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const badgeColors = {
  gray: "bg-stone-100 text-stone-700",
  green: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-1 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
} as const;

export function Badge({ color = "gray", children }: { color?: keyof typeof badgeColors; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeColors[color]}`}>
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

// ---------- Formulaires ----------
export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const styles =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark"
      : "border border-line bg-surface text-ink hover:bg-page";
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-critical">{error}</span>}
    </label>
  );
}

const fieldBase =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
/** Champ de formulaire pleine largeur */
export const inputClass = `w-full ${fieldBase}`;
/** Liste déroulante compacte (filtres) : la largeur est donnée à côté, ex. `${selectClass} w-64` */
export const selectClass = fieldBase;

/** Affiche une erreur de l'API, y compris la liste des matières manquantes pour un OF. */
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Erreur inattendue";
  const details =
    error instanceof ApiError
      ? (error.details as { manquants?: { item: string; needed: number; available: number; unit: string }[] })
      : undefined;
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

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircle size={16} className="animate-spin" aria-hidden /> {label}
    </p>
  );
}

/** Encadré d'explication en langage simple (pédagogie pour les équipes non techniques) */
export function Explainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-brand/20 bg-brand-soft p-4 text-sm text-ink-2">
      <Info size={18} className="mt-0.5 shrink-0 text-brand" aria-hidden />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

// ---------- Tableaux ----------
export function Table({ head, children, align }: { head: ReactNode[]; children: ReactNode; align?: ("left" | "right")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-medium ${align?.[i] === "right" ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5";
export const tdRight = "px-3 py-2.5 text-right";

/** Transforme les erreurs Zod en { champ: message } pour les afficher sous chaque champ. */
export function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}
