// =====================================================================
// PLANIFICATION : combien produire, et quelles matières acheter (calcul des besoins)
// =====================================================================
import { AlertTriangle, CalendarPlus, CheckCircle2, Factory, ShoppingCart, Wheat } from "lucide-react";
import { useState } from "react";
import { useCan, useCreateProductionOrder, useLocations, usePlanning } from "../api";
import { Badge, Button, Card, ErrorBox, Explainer, fmtEur, fmtInt, fmtQty, KpiCard, Loading, PageTitle, Segmented, Table, td, tdRight } from "../ui";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function Coverage({ days, horizon }: { days: number | null; horizon: number }) {
  if (days === null) return <span className="text-muted">—</span>;
  const label = `${days.toLocaleString("fr-FR")} j`;
  if (days < 3) return <Badge color="red"><AlertTriangle size={12} aria-hidden /> {label}</Badge>;
  if (days < horizon) return <Badge color="amber">{label}</Badge>;
  return <Badge color="green"><CheckCircle2 size={12} aria-hidden /> {label}</Badge>;
}

export function PlanningPage() {
  const [days, setDays] = useState(14);
  const planning = usePlanning(days);
  const locations = useLocations();
  const create = useCreateProductionOrder();
  const canProduce = useCan("production");
  const [site, setSite] = useState<number | null>(null);
  const [created, setCreated] = useState<Record<number, string>>({});

  const sites = locations.data?.filter((l) => l.type === "production") ?? [];
  const siteId = site ?? sites[0]?.id;

  const header = (
    <PageTitle
      title="Planification de la production"
      subtitle="Ce qu'il faut fabriquer et acheter, d'après la prévision des ventes"
      actions={
        <Segmented
          label="Horizon"
          value={days}
          onChange={setDays}
          options={[7, 14, 21, 28].map((d) => ({ value: d, label: `${d} jours` }))}
        />
      }
    />
  );
  if (planning.isPending) return <>{header}<Loading label="Calcul du plan…" /></>;
  if (planning.isError) return <>{header}<p className="text-critical">{planning.error.message}</p></>;
  const { plan, materials } = planning.data;

  const batches = plan.reduce((s, p) => s + p.batches, 0);
  const toLaunch = plan.filter((p) => p.batches > 0).length;
  const missing = materials.filter((m) => m.missing > 0);
  const budget = missing.reduce((s, m) => s + m.purchaseCost, 0);

  function launch(p: (typeof plan)[number]) {
    if (!siteId) return;
    create.mutate(
      { recipeId: p.recipeId, locationId: siteId, plannedQuantity: p.suggested, plannedFor: tomorrow() },
      {
        onSuccess: (of) => {
          setCreated((c) => ({ ...c, [p.itemId]: of.number }));
          planning.refetch();
        },
      },
    );
  }

  return (
    <>
      {header}

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard label="Fournées suggérées" value={fmtInt(batches)} hint={`sur ${days} jours`} icon={<Factory size={16} />} />
        <KpiCard label="Produits à lancer" value={`${toLaunch} / ${plan.length}`} icon={<CalendarPlus size={16} />} />
        <KpiCard label="Matières à acheter" value={String(missing.length)} hint="stock atelier insuffisant" icon={<Wheat size={16} />} />
        <KpiCard label="Budget d'achat estimé" value={fmtEur(budget)} hint="au coût d'achat actuel" icon={<ShoppingCart size={16} />} />
      </div>

      <div className="mb-6">
        <Explainer>
          <p>
            <b>Le calcul, ligne par ligne :</b> besoin = ventes prévues sur {days} jours + stock de sécurité − stock actuel − fournées
            déjà lancées. On arrondit ensuite au nombre de <b>fournées entières</b> (une recette produit par exemple 500 cookies d'un coup).
            La <b>couverture</b> indique combien de jours le stock actuel tiendra au rythme prévu.
          </p>
        </Explainer>
      </div>

      <Card
        className="mb-6"
        title="Plan de production suggéré"
        subtitle="Basé sur la prévision Holt-Winters de chaque produit"
        actions={
          canProduce && sites.length > 0 ? (
            <label className="flex items-center gap-2 text-xs text-ink-2">
              Lancer à
              <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs" value={siteId} onChange={(e) => setSite(Number(e.target.value))}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ) : undefined
        }
        padded={false}
      >
        <div className="px-2 pb-2">
          <Table
            head={["Produit", "Ventes prévues", "Stock", "Déjà lancé", "Sécurité", "À produire", "Fournées", "Couverture", ""]}
            align={["left", "right", "right", "right", "right", "right", "right", "left", "right"]}
          >
            {plan.map((p) => (
              <tr key={p.itemId}>
                <td className={`${td} font-medium`}>{p.product}</td>
                <td className={tdRight}>{fmtInt(p.demand)}</td>
                <td className={tdRight}>{fmtInt(p.stock)}</td>
                <td className={`${tdRight} text-ink-2`}>{fmtInt(p.inProgress)}</td>
                <td className={`${tdRight} text-ink-2`}>{fmtInt(p.safetyStock)}</td>
                <td className={`${tdRight} font-medium`}>{p.need ? fmtInt(p.need) : "—"}</td>
                <td className={tdRight}>
                  {p.batches ? <span>{p.batches} <span className="text-xs text-muted">× {fmtInt(p.batchSize)}</span></span> : "—"}
                </td>
                <td className={td}><Coverage days={p.coverageDays} horizon={days} /></td>
                <td className={tdRight}>
                  {created[p.itemId] ? (
                    <Badge color="green"><CheckCircle2 size={12} aria-hidden /> {created[p.itemId]}</Badge>
                  ) : p.batches > 0 && canProduce ? (
                    <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={create.isPending} onClick={() => launch(p)}>
                      <CalendarPlus size={14} aria-hidden /> Planifier {fmtInt(p.suggested)}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          <div className="px-3 pt-2"><ErrorBox error={create.error} /></div>
        </div>
      </Card>

      <Card title="Besoins en matières" subtitle="Pour réaliser toutes les fournées suggérées, comparés au stock des ateliers" padded={false}>
        <div className="px-2 pb-2">
          <Table head={["Matière", "Besoin", "Stock ateliers", "Manque", "Coût d'achat estimé"]} align={["left", "right", "right", "right", "right"]}>
            {materials.map((m) => (
              <tr key={m.id}>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5">
                    {m.missing > 0 ? <AlertTriangle size={14} className="text-critical" aria-label="À acheter" /> : <CheckCircle2 size={14} className="text-good" aria-label="En stock" />}
                    {m.name}
                  </span>
                </td>
                <td className={tdRight}>{fmtQty(Math.round(m.needed * 10) / 10, m.unit)}</td>
                <td className={tdRight}>{fmtQty(Math.round(m.stock * 10) / 10, m.unit)}</td>
                <td className={`${tdRight} ${m.missing > 0 ? "font-medium text-critical" : "text-muted"}`}>
                  {m.missing > 0 ? fmtQty(Math.round(m.missing * 10) / 10, m.unit) : "—"}
                </td>
                <td className={tdRight}>{m.purchaseCost > 0 ? fmtEur(m.purchaseCost) : "—"}</td>
              </tr>
            ))}
            <tr className="bg-page/60">
              <td className={`${td} font-medium`} colSpan={4}>Total à acheter</td>
              <td className={`${tdRight} font-semibold`}>{fmtEur(budget)}</td>
            </tr>
          </Table>
        </div>
      </Card>
    </>
  );
}
