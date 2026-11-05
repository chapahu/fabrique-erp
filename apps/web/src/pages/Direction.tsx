// =====================================================================
// VUE DIRECTION : les chiffres pour prendre des décisions
// Chaque indicateur est comparé à la période précédente de même durée.
// =====================================================================
import { Boxes, Euro, Factory, Handshake, Package, Percent } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useOverview } from "../api";
import { axisProps, ChartFrame, ChartTooltip, gridProps, Legend, SERIES } from "../charts";
import {
  Badge,
  Card,
  Delta,
  fmtDayShort,
  fmtEur,
  fmtEurCompact,
  fmtInt,
  fmtMonth,
  fmtPct,
  KpiCard,
  Loading,
  PageTitle,
  Segmented,
  Table,
  td,
  tdRight,
} from "../ui";

const PREV_YEAR = "#a8a69f"; // l'année précédente : une référence discrète, pas une série concurrente

const segmentLabels: Record<string, string> = {
  restaurant: "Restaurant", hotel: "Hôtel", epicerie: "Épicerie fine", entreprise: "Entreprise", collectivite: "Collectivité",
};

export function DirectionPage() {
  const [days, setDays] = useState(30);
  const overview = useOverview(days);

  const header = (
    <PageTitle
      title="Vue direction"
      subtitle={`Performance des ${days} derniers jours, comparée aux ${days} jours précédents`}
      actions={
        <Segmented
          label="Période"
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: "7 j" },
            { value: 30, label: "30 j" },
            { value: 90, label: "90 j" },
            { value: 365, label: "12 mois" },
          ]}
        />
      }
    />
  );
  if (overview.isPending) return <>{header}<Loading /></>;
  if (overview.isError) return <>{header}<p className="text-critical">{overview.error.message}</p></>;
  const { kpis, daily, byShop, byProduct, monthly, topCustomers } = overview.data;

  // Comparaison mois par mois : les 12 derniers mois complets vs les mêmes mois un an plus tôt
  const byMonth = new Map(monthly.map((m) => [m.month, m.revenue]));
  const yoy = monthly.slice(-12).map((m) => {
    const [y, mm] = m.month.split("-");
    return { month: m.month, current: m.revenue, previous: byMonth.get(`${Number(y) - 1}-${mm}`) ?? null };
  });
  const last12 = yoy.reduce((s, m) => s + m.current, 0);
  const prev12 = yoy.reduce((s, m) => s + (m.previous ?? 0), 0);

  const maxShop = Math.max(...byShop.map((s) => s.revenue), 1);
  const totalProducts = byProduct.reduce((s, p) => s + p.revenue, 0) || 1;
  const maxCustomer = Math.max(...topCustomers.map((c) => c.revenue), 1);

  return (
    <>
      {header}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Chiffre d'affaires" value={fmtEurCompact(kpis.revenue)} delta={<Delta current={kpis.revenue} previous={kpis.revenuePrev} />} icon={<Euro size={16} />} />
        <KpiCard
          label="Marge brute matière"
          value={fmtEurCompact(kpis.margin)}
          delta={<Delta current={kpis.margin} previous={kpis.marginPrev} />}
          hint={kpis.revenue ? `${fmtPct(kpis.margin / kpis.revenue)} du CA` : undefined}
          icon={<Percent size={16} />}
        />
        <KpiCard label="Produits vendus" value={fmtInt(kpis.units)} delta={<Delta current={kpis.units} previous={kpis.unitsPrev} />} icon={<Package size={16} />} />
        <KpiCard label="Part du B2B" value={fmtPct(kpis.b2bShare)} hint="du chiffre d'affaires" icon={<Handshake size={16} />} />
        <KpiCard label="Valeur du stock" value={fmtEurCompact(kpis.stockValue)} hint={`${kpis.stockAlerts} alerte${kpis.stockAlerts > 1 ? "s" : ""}`} icon={<Boxes size={16} />} />
        <KpiCard
          label="Rendement production"
          value={kpis.productionYield === null ? "—" : fmtPct(kpis.productionYield, 1)}
          hint={`${kpis.productionOrders} fournées`}
          icon={<Factory size={16} />}
        />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Chiffre d'affaires quotidien"
          subtitle="90 derniers jours, par canal de vente"
          actions={<Legend items={[{ label: "Boutiques", color: SERIES[0] }, { label: "B2B", color: SERIES[1] }]} />}
        >
          <ChartFrame>
            <ResponsiveContainer>
              <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" {...axisProps} tickFormatter={fmtDayShort} minTickGap={40} />
                <YAxis {...axisProps} width={56} tickFormatter={(v) => fmtEurCompact(v)} />
                <Tooltip content={<ChartTooltip labelFormatter={fmtDayShort} valueFormatter={fmtEur} />} />
                <Line type="monotone" dataKey="boutique" name="Boutiques" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                <Line type="monotone" dataKey="b2b" name="B2B" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>

        <Card
          title="Chiffre d'affaires mensuel"
          subtitle={`12 derniers mois : ${fmtEurCompact(last12)} (${prev12 ? `${last12 >= prev12 ? "+" : ""}${fmtPct((last12 - prev12) / prev12, 1)} sur un an` : "—"})`}
          actions={<Legend items={[{ label: "12 derniers mois", color: SERIES[0] }, { label: "Un an plus tôt", color: PREV_YEAR, dashed: true }]} />}
        >
          <ChartFrame>
            <ResponsiveContainer>
              <LineChart data={yoy} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={fmtMonth} />
                <YAxis {...axisProps} width={56} tickFormatter={(v) => fmtEurCompact(v)} />
                <Tooltip content={<ChartTooltip labelFormatter={fmtMonth} valueFormatter={fmtEur} />} />
                <Line type="monotone" dataKey="previous" name="Un an plus tôt" stroke={PREV_YEAR} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="current" name="12 derniers mois" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: SERIES[0] }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 2xl:grid-cols-[1fr_1.5fr]">
        <Card title="Classement des boutiques" subtitle={`Chiffre d'affaires sur ${days} jours et évolution`}>
          <ul className="space-y-3">
            {byShop.map((s) => (
              <li key={s.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 truncate">
                    {s.name}
                    {s.is_franchise && <Badge>Franchise</Badge>}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular font-medium">{fmtEur(s.revenue)}</span>
                    <span className="w-16 text-right"><Delta current={s.revenue} previous={s.prev_revenue} /></span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-page">
                  <div className="h-2 rounded-full" style={{ width: `${(s.revenue / maxShop) * 100}%`, background: SERIES[0] }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Rentabilité par produit" subtitle="Coût matière calculé depuis les recettes" padded={false}>
          <div className="px-2 pb-2">
            <Table
              head={["Produit", "Vendus", "Chiffre d'affaires", "Part", "Coût / u", "Prix / u", "Marge"]}
              align={["left", "right", "right", "left", "right", "right", "right"]}
            >
              {byProduct.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} whitespace-nowrap font-medium`}>{p.name}</td>
                  <td className={tdRight}>{fmtInt(p.units)}</td>
                  <td className={tdRight}>{fmtEur(p.revenue)}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-page">
                        <div className="h-1.5 rounded-full" style={{ width: `${(p.revenue / totalProducts) * 100}%`, background: SERIES[0] }} />
                      </div>
                      <span className="tabular text-xs text-ink-2">{fmtPct(p.revenue / totalProducts)}</span>
                    </div>
                  </td>
                  <td className={`${tdRight} text-ink-2`}>{p.unit_cost?.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
                  <td className={`${tdRight} text-ink-2`}>{p.sale_price?.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
                  <td className={`${tdRight} font-medium text-good-text`}>{p.revenue ? fmtPct(p.margin / p.revenue) : "—"}</td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>

      <Card title="Meilleurs clients professionnels" subtitle={`Chiffre d'affaires B2B sur ${days} jours`}>
        <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {topCustomers.map((c, i) => (
            <li key={c.name} className="flex items-center gap-3">
              <span className="tabular w-5 text-sm text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="tabular shrink-0">{fmtEur(c.revenue)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-page">
                    <div className="h-1.5 rounded-full" style={{ width: `${(c.revenue / maxCustomer) * 100}%`, background: SERIES[1] }} />
                  </div>
                  <span className="text-xs text-muted">{segmentLabels[c.segment] ?? c.segment} · {c.city}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
