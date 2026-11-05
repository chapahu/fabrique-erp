import { useState } from "react";
import { Link } from "react-router";
import { useLocations, useStock, useStockLots } from "../api";
import { Badge, Card, fmtDate, fmtQty, selectClass, itemTypeLabels, Loading, PageTitle, Table, td } from "../ui";

export function StockPage() {
  const locations = useLocations();
  // useState : une donnée qui appartient à l'écran (ici, le site choisi). La changer redessine la page.
  const [locationId, setLocationId] = useState<number | undefined>(undefined);
  const stock = useStock(locationId);
  const lots = useStockLots(locationId);

  // Une DLC dans moins de 7 jours mérite un coup d'œil
  const soon = (d: string | null) => d !== null && new Date(d).getTime() - Date.now() < 7 * 86_400_000;

  return (
    <>
      <PageTitle
        title="Stock"
        subtitle="Calculé en temps réel à partir des mouvements (réceptions, consommations, productions)"
        actions={
          <select
            className={`${selectClass} w-64`}
            value={locationId ?? ""}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">Tous les emplacements</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        }
      />

      <div className="space-y-6">
        <Card title="Par article">
          {stock.isPending ? <Loading /> : (
            <Table head={["Article", "Type", "Emplacement", "Quantité", "Seuil mini", "Prochaine DLC", ""]}>
              {stock.data?.map((s) => (
                <tr key={`${s.location_id}-${s.item_id}`} className={s.below_min ? "bg-red-50/50" : ""}>
                  <td className={td}>
                    <span className="font-medium">{s.item}</span>
                    <span className="ml-2 font-mono text-xs text-stone-400">{s.sku}</span>
                  </td>
                  <td className={td}>{itemTypeLabels[s.type]}</td>
                  <td className={td}>{s.location}</td>
                  <td className={`${td} font-medium`}>{fmtQty(s.quantity, s.unit)}</td>
                  <td className={`${td} text-stone-500`}>{fmtQty(s.min_stock, s.unit)}</td>
                  <td className={td}>{fmtDate(s.next_expiry)}</td>
                  <td className={td}>{s.below_min ? <Badge color="red">Sous le seuil</Badge> : <Badge color="green">OK</Badge>}</td>
                </tr>
              ))}
            </Table>
          )}
          {stock.data?.length === 0 && <p className="text-sm text-stone-500">Aucun stock à cet emplacement.</p>}
        </Card>

        <Card title="Détail par lot (ordre FEFO : premier périmé, premier sorti)">
          {lots.isPending ? <Loading /> : (
            <Table head={["Lot", "Article", "Lieu", "Quantité", "DLC / DDM", ""]}>
              {lots.data?.map((l) => (
                // Un même lot peut être à plusieurs endroits (transferts) : la ligne = lot + lieu
                <tr key={`${l.lot_id}-${l.location}`}>
                  <td className={`${td} font-mono text-xs`}>{l.lot_number}</td>
                  <td className={td}>{l.item}</td>
                  <td className={`${td} text-ink-2`}>{l.location}</td>
                  <td className={td}>{fmtQty(l.quantity, l.unit)}</td>
                  <td className={td}>
                    {fmtDate(l.expires_on)} {soon(l.expires_on) && <Badge color="amber">Bientôt</Badge>}
                  </td>
                  <td className={`${td} text-right`}>
                    <Link to={`/tracabilite?lot=${l.lot_id}`} className="text-sm text-brand hover:underline">
                      Tracer →
                    </Link>
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
