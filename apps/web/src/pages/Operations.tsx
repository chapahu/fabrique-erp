import {
  AlertTriangle,
  ArrowRightLeft,
  Cookie,
  Factory,
  PackageCheck,
  ShoppingBag,
  Soup,
  Trash2,
  Truck,
  type LucideIcon,
  PencilLine,
} from "lucide-react";
import { Link } from "react-router";
import { type Activity, useActivity, useProductionOrders, useStock } from "../api";
import { Badge, Card, fmtDate, fmtInt, fmtQty, KpiCard, Loading, PageTitle, StatusBadge, Table, td, tdRight } from "../ui";

const activityStyle: Record<Activity["type"], { icon: LucideIcon; label: string }> = {
  reception: { icon: Truck, label: "Livraison" },
  consommation: { icon: Soup, label: "Utilisé en production" },
  production: { icon: Cookie, label: "Fabriqué" },
  vente: { icon: ShoppingBag, label: "Vendu" },
  transfert: { icon: ArrowRightLeft, label: "Transfert" },
  perte: { icon: Trash2, label: "Perte" },
  ajustement: { icon: PencilLine, label: "Ajustement" },
};

function ActivityFeed() {
  const activity = useActivity();
  if (activity.isPending) return <Loading />;
  return (
    <ul className="divide-y divide-line">
      {activity.data?.map((a) => {
        const { icon: Icon, label } = activityStyle[a.type];
        return (
          <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-page text-ink-2">
              <Icon size={16} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate">
                <span className="font-medium">{label}</span> · {a.item}
              </p>
              <p className="truncate text-xs text-muted">
                {a.location} · lot {a.lot_number}
                {a.user_name && <> · par {a.user_name}</>}
              </p>
            </div>
            <span className={`tabular font-medium ${a.quantity < 0 ? "text-critical" : "text-good-text"}`}>
              {a.quantity > 0 ? "+" : ""}
              {fmtQty(a.quantity, a.unit)}
            </span>
            <span className="tabular w-12 text-right text-xs text-muted">
              {new Date(a.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function OperationsPage() {
  const stock = useStock();
  const orders = useProductionOrders();

  if (stock.isPending || orders.isPending) return <Loading />;
  if (stock.isError || orders.isError) return <p className="text-critical">Impossible de joindre l'API. Est-elle démarrée ?</p>;

  const alerts = stock.data.filter((s) => s.below_min && s.type !== "produit_fini");
  const finished = stock.data.filter((s) => s.type === "produit_fini").reduce((sum, s) => sum + s.quantity, 0);
  const inProgress = orders.data.filter((o) => o.status === "en_cours").length;
  const planned = orders.data.filter((o) => o.status === "planifie").length;

  return (
    <>
      <PageTitle
        title="Activité"
        subtitle="Les opérations en temps réel : production, stocks et mouvements (mis à jour toutes les 5 secondes)"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Produits finis en stock" value={fmtInt(finished)} hint="tous sites" icon={<PackageCheck size={16} />} />
        <KpiCard label="Fournées en cours" value={String(inProgress)} icon={<Factory size={16} />} />
        <KpiCard label="Fournées planifiées" value={String(planned)} icon={<Factory size={16} />} />
        <KpiCard
          label="Alertes de stock"
          value={String(alerts.length)}
          hint="matières sous le seuil"
          icon={<AlertTriangle size={16} />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card title="Activité en direct" subtitle="Derniers mouvements de stock, toutes les 2 secondes" className="xl:row-span-2">
          <ActivityFeed />
        </Card>

        <Card title="À réapprovisionner" subtitle="Matières sous leur seuil minimum">
          {alerts.length === 0 ? (
            <p className="text-sm text-ink-2">Aucune alerte : tous les stocks sont au-dessus du seuil.</p>
          ) : (
            <Table head={["Article", "Site", "Stock", "Seuil"]} align={["left", "left", "right", "right"]}>
              {alerts.map((a) => (
                <tr key={`${a.location_id}-${a.item_id}`}>
                  <td className={td}>
                    <span className="inline-flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-critical" aria-label="Sous le seuil" />
                      {a.item}
                    </span>
                  </td>
                  <td className={td}>{a.location}</td>
                  <td className={`${tdRight} font-medium text-critical`}>{fmtQty(a.quantity, a.unit)}</td>
                  <td className={`${tdRight} text-muted`}>{fmtQty(a.min_stock, a.unit)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Derniers ordres de fabrication">
          {orders.data.length === 0 ? (
            <Badge>Aucun ordre de fabrication</Badge>
          ) : (
            <Table head={["N°", "Produit", "Prévu le", "Quantité", "Statut"]} align={["left", "left", "left", "right", "left"]}>
              {orders.data.slice(0, 6).map((o) => (
                <tr key={o.id}>
                  <td className={`${td} font-mono text-xs`}>
                    <Link to="/production" className="text-brand hover:underline">
                      {o.number}
                    </Link>
                  </td>
                  <td className={td}>{o.product}</td>
                  <td className={td}>{fmtDate(o.planned_for)}</td>
                  <td className={tdRight}>{fmtQty(o.produced_quantity ?? o.planned_quantity, o.unit)}</td>
                  <td className={td}>
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
