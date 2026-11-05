// =====================================================================
// Réglages communs des graphiques (Recharts).
// Règles suivies : traits fins (2 px), quadrillage discret, une seule échelle par graphique,
// infobulle au survol, couleurs de la palette validée dans un ordre fixe.
// =====================================================================
import type { ReactNode } from "react";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
export const GRID = "#ecebe6";
export const AXIS = "#898781";
export const INK = "#0b0b0b";

export const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "#d6d4cc" },
} as const;

export const gridProps = { stroke: GRID, strokeDasharray: "0", vertical: false } as const;

/** Infobulle sobre : titre + une ligne par série (pastille de couleur + libellé + valeur) */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | number[]; color?: string; dataKey?: string }[];
  label?: string | number;
  labelFormatter?: (label: string) => string;
  valueFormatter: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined && p.value !== null && !Array.isArray(p.value));
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {rows.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular font-medium text-ink">{valueFormatter(p.value as number)}</span>
        </p>
      ))}
    </div>
  );
}

/** Légende : toujours présente dès 2 séries (l'identité n'est jamais portée par la couleur seule) */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; band?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.band ? (
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: i.color, opacity: 0.18 }} />
          ) : (
            <span
              className="inline-block w-4"
              style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }}
            />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({ height = 260, children }: { height?: number; children: ReactNode }) {
  return <div style={{ height }}>{children}</div>;
}
