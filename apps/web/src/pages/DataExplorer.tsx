// =====================================================================
// EXPLORATEUR DE DONNÉES : toutes les tables de l'ERP, par catégorie, avec filtres, tri, pages et export
// =====================================================================
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, FilterX, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { type ColumnType, type DatasetMeta, useDataPage, useDatasets } from "../api";
import { Badge, Button, Card, fmtInt, Loading, PageTitle, selectClass } from "../ui";

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/** Affiche une valeur selon le type de sa colonne */
function formatCell(value: unknown, type: ColumnType, labels?: Record<string, string>) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
  switch (type) {
    case "money": return eur.format(Number(value));
    case "number": return num.format(Number(value));
    case "percent": return `${(Number(value) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
    case "date": return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR");
    case "datetime": return new Date(String(value)).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    case "bool": return value ? <Badge color="green">Oui</Badge> : <Badge>Non</Badge>;
    case "enum": return <Badge>{labels?.[String(value)] ?? String(value)}</Badge>;
    default: return String(value);
  }
}
const isNumeric = (t: ColumnType) => t === "money" || t === "number" || t === "percent";

type State = { q: string; filters: Record<string, string>; from: string; to: string; sort?: string; dir: "asc" | "desc"; page: number };
const emptyState: State = { q: "", filters: {}, from: "", to: "", dir: "asc", page: 1 };

function Explorer({ meta }: { meta: DatasetMeta }) {
  const [state, setState] = useState<State>(emptyState);
  const [search, setSearch] = useState("");

  // La recherche part 300 ms après la dernière frappe (pas une requête par lettre tapée)
  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.q === search ? s : { ...s, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(state.page), pageSize: "50" });
    if (state.q) p.set("q", state.q);
    for (const [k, v] of Object.entries(state.filters)) if (v) p.set(`f_${k}`, v);
    if (state.from) p.set("from", state.from);
    if (state.to) p.set("to", state.to);
    if (state.sort) { p.set("sort", state.sort); p.set("dir", state.dir); }
    return p.toString();
  }, [state]);
  const data = useDataPage(meta.key, query);

  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const activeSort = state.sort ?? meta.sort.key;
  const activeDir = state.sort ? state.dir : meta.sort.dir;
  const toggleSort = (key: string) =>
    update({ sort: key, dir: activeSort === key && activeDir === "asc" ? "desc" : "asc" });
  const hasFilters = state.q || state.from || state.to || Object.values(state.filters).some(Boolean);

  const total = data.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const first = total ? (state.page - 1) * 50 + 1 : 0;
  const last = Math.min(state.page * 50, total);
  const exportQuery = query.replace(/(^|&)(page|pageSize)=\d+/g, "");

  return (
    <Card padded={false}>
      {/* Barre de filtres : tout sur une ligne, au-dessus du tableau */}
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <label className="relative">
          <span className="sr-only">Rechercher</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            className={`${selectClass} w-60 pl-8`}
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {meta.filters.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted">{f.label}</span>
            <select
              className={`${selectClass} max-w-52 py-1.5`}
              value={state.filters[f.key] ?? ""}
              onChange={(e) => update({ filters: { ...state.filters, [f.key]: e.target.value } })}
            >
              <option value="">Tous</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {meta.date && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted">{meta.date}</span>
            <div className="flex items-center gap-1.5">
              <input type="date" aria-label="Du" className={`${selectClass} py-1.5`} value={state.from} onChange={(e) => update({ from: e.target.value })} />
              <span className="text-xs text-muted">au</span>
              <input type="date" aria-label="Au" className={`${selectClass} py-1.5`} value={state.to} onChange={(e) => update({ to: e.target.value })} />
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasFilters && (
            <Button variant="secondary" className="py-1.5 text-xs" onClick={() => { setSearch(""); setState(emptyState); }}>
              <FilterX size={14} aria-hidden /> Effacer les filtres
            </Button>
          )}
          <a
            href={`/api/data/${meta.key}/export.csv?${exportQuery}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-page"
          >
            <Download size={14} aria-hidden /> Exporter en CSV
          </a>
        </div>
      </div>

      {/* Tableau */}
      <div className={`overflow-x-auto transition-opacity ${data.isPlaceholderData ? "opacity-60" : ""}`}>
        <table className="tabular w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-xs text-muted">
              {meta.columns.map((c) => {
                const active = activeSort === c.key;
                const Icon = !active ? ArrowUpDown : activeDir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={c.key} className={`px-3 py-2 font-medium whitespace-nowrap ${isNumeric(c.type) ? "text-right" : ""}`}>
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
                      aria-label={`Trier par ${c.label}`}
                    >
                      {c.label}
                      <Icon size={12} className={active ? "" : "opacity-40"} aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.data?.rows.map((row, i) => (
              <tr key={i} className="hover:bg-page/70">
                {meta.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${isNumeric(c.type) ? "text-right" : ""} ${c.key === "ingredients" ? "min-w-96 text-xs text-ink-2" : "whitespace-nowrap"}`}
                  >
                    {formatCell(row[c.key], c.type, c.labels)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.isPending && <div className="p-4"><Loading /></div>}
        {data.data && total === 0 && <p className="p-6 text-center text-sm text-ink-2">Aucun résultat avec ces filtres.</p>}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-2">
        <span className="tabular">
          {total ? `${fmtInt(first)}–${fmtInt(last)} sur ${fmtInt(total)} ligne${total > 1 ? "s" : ""}` : "0 ligne"}
        </span>
        <div className="flex items-center gap-2">
          <span className="tabular">Page {state.page} / {fmtInt(pages)}</span>
          <Button variant="secondary" className="px-2 py-1" disabled={state.page <= 1} onClick={() => update({ page: state.page - 1 })} aria-label="Page précédente">
            <ChevronLeft size={14} />
          </Button>
          <Button variant="secondary" className="px-2 py-1" disabled={state.page >= pages} onClick={() => update({ page: state.page + 1 })} aria-label="Page suivante">
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function DataExplorerPage() {
  const datasets = useDatasets();
  const [params, setParams] = useSearchParams();

  if (datasets.isPending) return <Loading />;
  if (datasets.isError) return <p className="text-critical">{datasets.error.message}</p>;
  const list = datasets.data;
  const current = list.find((d) => d.key === params.get("table")) ?? list[0];
  const groups = [...new Set(list.map((d) => d.group))];

  return (
    <>
      <PageTitle title="Explorateur de données" subtitle="Toutes les données de l'ERP, par catégorie : recherche, filtres, tri et export Excel" />
      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="Catégories" className="space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted">{g}</p>
              {list.filter((d) => d.group === g).map((d) => (
                <button
                  key={d.key}
                  onClick={() => setParams({ table: d.key })}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition ${
                    d.key === current.key ? "bg-surface font-medium text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:bg-surface/70"
                  }`}
                >
                  {d.label}
                  <span className="tabular text-xs text-muted">{fmtInt(d.count)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="mb-3">
            <h2 className="text-base font-semibold">{current.label}</h2>
            <p className="text-sm text-ink-2">{current.description}</p>
          </div>
          {/* key = la catégorie : changer de catégorie repart de filtres vides */}
          <Explorer key={current.key} meta={current} />
        </div>
      </div>
    </>
  );
}
