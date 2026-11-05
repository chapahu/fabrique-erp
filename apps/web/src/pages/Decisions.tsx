// =====================================================================
// DÉCISIONS : quoi acheter, quand, quoi produire, quelle stratégie adopter.
// Recommandations calculées par des RÈGLES MÉTIER à partir des données de l'ERP (pas d'IA).
// =====================================================================
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Compass,
  Factory,
  Handshake,
  Info,
  type LucideIcon,
  Recycle,
  ShoppingCart,
  Store,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { type Decision, type DecisionCategory, useDecisions } from "../api";
import { Card, Explainer, fmtEur, fmtInt, KpiCard, Loading, PageTitle, Segmented, Table, td, tdRight } from "../ui";

const categories: Record<DecisionCategory, { label: string; icon: LucideIcon }> = {
  achats: { label: "Achats", icon: ShoppingCart },
  production: { label: "Production", icon: Factory },
  gaspillage: { label: "Anti-gaspillage", icon: Recycle },
  boutiques: { label: "Boutiques", icon: Store },
  commercial: { label: "Commercial", icon: Handshake },
  strategie: { label: "Stratégie", icon: Compass },
};

// L'urgence n'est jamais portée par la couleur seule : icône + libellé
const priorities = {
  urgent: { label: "À faire aujourd'hui", icon: AlertOctagon, badge: "bg-red-50 text-red-800 ring-red-200", ring: "border-red-200" },
  important: { label: "Cette semaine", icon: AlertTriangle, badge: "bg-amber-50 text-amber-800 ring-amber-200", ring: "border-amber-200" },
  info: { label: "À surveiller", icon: Info, badge: "bg-sky-50 text-sky-800 ring-sky-200", ring: "border-line" },
} as const;

function DecisionCard({ d }: { d: Decision }) {
  const p = priorities[d.priority];
  const c = categories[d.category];
  return (
    <article className={`rounded-xl border bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${p.ring}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ${p.badge}`}>
          <p.icon size={12} aria-hidden /> {p.label}
        </span>
        <span className="inline-flex items-center gap-1 text-ink-2">
          <c.icon size={13} aria-hidden /> {c.label}
        </span>
      </div>
      <h3 className="text-[15px] font-semibold leading-snug text-ink">{d.title}</h3>
      <p className="mt-1 text-sm text-ink-2">{d.detail}</p>
      {d.facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-page/70 p-3 text-xs sm:grid-cols-4">
          {d.facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="truncate text-muted">{f.label}</dt>
              <dd className="tabular truncate font-medium text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.action && (
        <Link to={d.action.to} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          {d.action.label} <ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </article>
  );
}

export function DecisionsPage() {
  const decisions = useDecisions();
  const [filter, setFilter] = useState<DecisionCategory | "all">("all");

  const header = (
    <PageTitle
      title="Décisions"
      subtitle="Quoi acheter, quand, quoi produire, quelle stratégie : calculé à partir des données de l'ERP, sans IA"
    />
  );
  if (decisions.isPending) return <>{header}<Loading label="Analyse des données…" /></>;
  if (decisions.isError) return <>{header}<p className="text-critical">{decisions.error.message}</p></>;
  const { summary, purchasePlan } = decisions.data;
  const list = decisions.data.decisions;

  const present = (Object.keys(categories) as DecisionCategory[]).filter((c) => list.some((d) => d.category === c));
  const shown = filter === "all" ? list : list.filter((d) => d.category === filter);

  return (
    <>
      {header}

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard label="À faire aujourd'hui" value={String(summary.urgent)} hint="décisions urgentes" icon={<AlertOctagon size={16} />} />
        <KpiCard label="Cette semaine" value={String(summary.important)} hint="décisions importantes" icon={<AlertTriangle size={16} />} />
        <KpiCard label="À surveiller" value={String(summary.info)} hint="signaux et opportunités" icon={<Info size={16} />} />
        <KpiCard label="Achats à engager sous 7 jours" value={fmtEur(summary.purchaseBudget7d)} hint="au coût d'achat actuel" icon={<Wallet size={16} />} />
      </div>

      <div className="mb-6">
        <Explainer>
          <p>
            <b>Comment c'est calculé ?</b> Pas d'intelligence artificielle ici : des <b>règles de gestion</b> appliquées aux données de l'ERP.
            Par exemple, pour les achats : consommation prévue (ventes prévues × recettes), couverture du stock en jours, et délai de
            livraison de chaque fournisseur. Chaque carte affiche les chiffres utilisés, pour que la décision reste vérifiable.
          </p>
        </Explainer>
      </div>

      <div className="mb-4">
        <Segmented
          label="Catégorie"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `Toutes (${list.length})` },
            ...present.map((c) => ({ value: c, label: `${categories[c].label} (${list.filter((d) => d.category === c).length})` })),
          ]}
        />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {shown.map((d) => <DecisionCard key={d.id} d={d} />)}
        {shown.length === 0 && <p className="text-sm text-ink-2">Rien à signaler dans cette catégorie.</p>}
      </div>

      <Card
        title="Calendrier des achats"
        subtitle="Pour chaque matière : jusqu'à quand le stock tient, et la date limite pour commander compte tenu du délai fournisseur"
        actions={<CalendarClock size={18} className="text-muted" aria-hidden />}
        padded={false}
      >
        <div className="px-2 pb-2">
          <Table
            head={["Matière", "Stock ateliers", "Conso. prévue / jour", "Tient encore", "Délai fournisseur", "Commander", "Quantité conseillée", "Fournisseur", "Budget"]}
            align={["left", "right", "right", "right", "right", "left", "right", "left", "right"]}
          >
            {purchasePlan.map((p) => {
              const when =
                p.orderInDays <= 0 ? { text: "Aujourd'hui", cls: "text-critical font-medium", icon: AlertOctagon }
                : p.orderInDays <= 3 ? { text: p.orderInDays === 1 ? "Demain" : `Dans ${p.orderInDays} jours`, cls: "text-amber-800 font-medium", icon: AlertTriangle }
                : { text: new Date(`${p.orderBy}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), cls: "text-ink-2", icon: null };
              return (
                <tr key={p.itemId}>
                  <td className={`${td} font-medium`}>{p.item}</td>
                  <td className={tdRight}>{fmtInt(p.stock)} {p.unit}</td>
                  <td className={tdRight}>{p.dailyUsage.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} {p.unit}</td>
                  <td className={tdRight}>{p.coverDays.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j</td>
                  <td className={`${tdRight} text-ink-2`}>{p.leadTime} j</td>
                  <td className={td}>
                    <span className={`inline-flex items-center gap-1 ${when.cls}`}>
                      {when.icon && <when.icon size={13} aria-hidden />} {when.text}
                    </span>
                  </td>
                  <td className={tdRight}>{p.quantity ? `${fmtInt(p.quantity)} ${p.unit}` : "—"}</td>
                  <td className={`${td} text-ink-2`}>{p.supplier}</td>
                  <td className={tdRight}>{p.cost ? fmtEur(p.cost) : "—"}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      </Card>
    </>
  );
}
