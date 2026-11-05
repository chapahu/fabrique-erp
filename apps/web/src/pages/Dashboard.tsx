import { Link } from "react-router";
import { type Activity, useActivity, useProductionOrders, useStock } from "../api";
import { Badge, Card, fmtDate, fmtQty, Loading, PageTitle, StatusBadge, Table, td } from "../ui";

const activityStyle: Record<Activity["type"], { icon: string; label: string }> = {
  reception: { icon: "🚚", label: "Livraison" },
  consommation: { icon: "🥣", label: "Utilisé en production" },
  production: { icon: "🍪", label: "Fabriqué" },
  vente: { icon: "🛍️", label: "Vendu" },
  transfert: { icon: "📦", label: "Transfert" },
  perte: { icon: "🗑️", label: "Perte" },
  ajustement: { icon: "✏️", label: "Ajustement" },
};

function ActivityFeed() {
  const activity = useActivity();
  if (activity.isPending) return <Loading />;
  return (
    <ul className="divide-y divide-stone-100">
      {activity.data?.map((a) => {
        const s = activityStyle[a.type];
        return (
          <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="text-lg">{s.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate">
                <span className="font-medium">{s.label}</span> · {a.item}
              </p>
              <p className="truncate text-xs text-stone-500">
                {a.location} · lot {a.lot_number}
                {a.user_name && <> · par {a.user_name}</>}
              </p>
            </div>
            <span className={`font-medium ${a.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {a.quantity > 0 ? "+" : ""}
              {fmtQty(a.quantity, a.unit)}
            </span>
            <span className="w-12 text-right text-xs text-stone-400">
              {new Date(a.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Kpi({ label, value, hint, tone = "stone" }: { label: string; value: string | number; hint?: string; tone?: "stone" | "red" | "amber" }) {
  const color = { stone: "text-stone-900", red: "text-red-700", amber: "text-amber-700" }[tone];
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-stone-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const stock = useStock();
  const orders = useProductionOrders();

  if (stock.isPending || orders.isPending) return <Loading />;
  if (stock.isError || orders.isError) return <p className="text-red-700">Impossible de joindre l'API. Est-elle démarrée ?</p>;

  const alerts = stock.data.filter((s) => s.below_min);
  const cookies = stock.data.filter((s) => s.type === "produit_fini").reduce((sum, s) => sum + s.quantity, 0);
  const inProgress = orders.data.filter((o) => o.status === "en_cours").length;
  const planned = orders.data.filter((o) => o.status === "planifie").length;

  return (
    <>
      <PageTitle title="Tableau de bord" subtitle="Vue d'ensemble, mise à jour automatiquement toutes les 5 secondes" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Produits finis en stock" value={fmtQty(cookies)} hint="tous sites confondus" />
        <Kpi label="OF en cours" value={inProgress} tone="amber" />
        <Kpi label="OF planifiés" value={planned} />
        <Kpi label="Alertes de stock" value={alerts.length} tone={alerts.length ? "red" : "stone"} hint="articles sous le seuil mini" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="⚡ Activité en direct" className="xl:row-span-2">
          <ActivityFeed />
        </Card>

        <Card title="⚠️ À réapprovisionner">
          {alerts.length === 0 ? (
            <p className="text-sm text-stone-500">Aucune alerte : tous les stocks sont au-dessus du seuil.</p>
          ) : (
            <Table head={["Article", "Site", "Stock", "Seuil"]}>
              {alerts.map((a) => (
                <tr key={`${a.location_id}-${a.item_id}`}>
                  <td className={td}>{a.item}</td>
                  <td className={td}>{a.location}</td>
                  <td className={`${td} font-medium text-red-700`}>{fmtQty(a.quantity, a.unit)}</td>
                  <td className={`${td} text-stone-500`}>{fmtQty(a.min_stock, a.unit)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="🏭 Derniers ordres de fabrication">
          <Table head={["N°", "Produit", "Prévu le", "Quantité", "Statut"]}>
            {orders.data.slice(0, 6).map((o) => (
              <tr key={o.id}>
                <td className={`${td} font-mono text-xs`}>
                  <Link to="/production" className="text-amber-800 hover:underline">{o.number}</Link>
                </td>
                <td className={td}>{o.product}</td>
                <td className={td}>{fmtDate(o.planned_for)}</td>
                <td className={td}>{fmtQty(o.produced_quantity ?? o.planned_quantity, o.unit)}</td>
                <td className={td}><StatusBadge status={o.status} /></td>
              </tr>
            ))}
          </Table>
          {orders.data.length === 0 && <Badge>Aucun OF</Badge>}
        </Card>
      </div>
    </>
  );
}
