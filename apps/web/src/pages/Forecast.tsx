// =====================================================================
// PRÉVISIONS : ce que l'algorithme Holt-Winters prévoit, et pourquoi on peut (ou non) s'y fier
// =====================================================================
import { Gauge, SlidersHorizontal, Sigma } from "lucide-react";
import { useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type ForecastParams, useForecast, useItems, useLocations } from "../api";
import { axisProps, ChartFrame, ChartTooltip, gridProps, Legend, SERIES } from "../charts";
import { Card, Explainer, fmtDayShort, fmtEur, fmtEurCompact, fmtInt, fmtMonth, KpiCard, selectClass, Loading, PageTitle, Segmented } from "../ui";

const FITTED = "#a8a69f";

export function ForecastPage() {
  const items = useItems();
  const locations = useLocations();
  const [params, setParams] = useState<ForecastParams>({ granularity: "day", metric: "units" });
  const forecast = useForecast(params);
  const set = (patch: Partial<ForecastParams>) => setParams((p) => ({ ...p, ...patch }));

  const isDay = params.granularity === "day";
  const fmtPeriod = isDay ? fmtDayShort : fmtMonth;
  const fmtValue = params.metric === "revenue" ? fmtEur : (v: number) => `${fmtInt(v)} u`;
  const fmtAxis = params.metric === "revenue" ? fmtEurCompact : (v: number) => fmtInt(v);

  const controls = (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <Segmented
        label="Horizon"
        value={params.granularity}
        onChange={(granularity) => set({ granularity })}
        options={[{ value: "day", label: "4 prochaines semaines" }, { value: "month", label: "12 prochains mois" }]}
      />
      <Segmented
        label="Mesure"
        value={params.metric}
        onChange={(metric) => set({ metric })}
        options={[{ value: "units", label: "Quantités" }, { value: "revenue", label: "Chiffre d'affaires" }]}
      />
      <select className={`${selectClass} w-64`} value={params.itemId ?? ""} onChange={(e) => set({ itemId: e.target.value ? Number(e.target.value) : undefined })} aria-label="Produit">
        <option value="">Tous les produits</option>
        {items.data?.filter((i) => i.type === "produit_fini").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <select className={`${selectClass} w-56`} value={params.locationId ?? ""} onChange={(e) => set({ locationId: e.target.value ? Number(e.target.value) : undefined })} aria-label="Lieu">
        <option value="">Tous les lieux de vente</option>
        {locations.data?.filter((l) => l.type === "boutique").map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </div>
  );

  const header = (
    <PageTitle
      title="Prévisions des ventes"
      subtitle="Algorithme Holt-Winters : tendance + saisonnalité, appris sur l'historique des ventes"
    />
  );

  if (forecast.isPending) return <>{header}{controls}<Loading label="Calcul de la prévision…" /></>;
  if (forecast.isError) return <>{header}{controls}<p className="text-critical">{forecast.error.message}</p></>;
  const f = forecast.data;
  if (f.error) return <>{header}{controls}<Card><p className="text-sm text-ink-2">{f.error}</p></Card></>;

  // Données du graphique : passé (réel + ce que le modèle aurait prédit) puis futur (prévision + fourchette)
  const last = f.history.at(-1)!;
  const data = [
    ...f.history.map((h) => ({ period: h.period, actual: h.actual, fitted: h.fitted })),
    ...f.forecast.map((p) => ({ period: p.period, forecast: p.value, band: [p.lower, p.upper] as [number, number] })),
  ];
  // la ligne de prévision part du dernier point réel (continuité visuelle)
  (data[f.history.length - 1] as { forecast?: number }).forecast = last.actual;

  const reliability = f.mape === null ? null : Math.max(0, 100 - f.mape);
  const strongest = [...f.seasonality].sort((a, b) => b.factor - a.factor);
  const top = strongest[0];
  const low = strongest.at(-1)!;
  const unitLabel = isDay ? "jours" : "mois";

  return (
    <>
      {header}
      {controls}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          label={`Total prévu sur ${f.forecast.length} ${unitLabel}`}
          value={params.metric === "revenue" ? fmtEurCompact(f.total) : fmtInt(f.total)}
          hint={params.metric === "revenue" ? "chiffre d'affaires HT" : "produits"}
          icon={<Sigma size={16} />}
        />
        <KpiCard
          label="Fiabilité mesurée"
          value={reliability === null ? "—" : `${reliability.toFixed(1).replace(".", ",")} %`}
          hint={f.mape === null ? "pas assez d'historique pour tester" : `erreur moyenne de ${String(f.mape).replace(".", ",")} % sur une période test`}
          icon={<Gauge size={16} />}
        />
        <KpiCard
          label="Réglages trouvés automatiquement"
          value={`α ${f.params.alpha} · β ${f.params.beta} · γ ${f.params.gamma}`}
          hint="niveau · tendance · saisonnalité"
          icon={<SlidersHorizontal size={16} />}
        />
      </div>

      <Card
        className="mb-6"
        title={params.metric === "revenue" ? "Chiffre d'affaires : réel et prévu" : "Quantités vendues : réel et prévu"}
        subtitle={isDay ? "4 derniers mois de réel, 4 semaines de prévision" : "3 ans de réel, 12 mois de prévision"}
        actions={
          <Legend
            items={[
              { label: "Réel", color: SERIES[0] },
              { label: "Modèle sur le passé", color: FITTED, dashed: true },
              { label: "Prévision", color: SERIES[1] },
              { label: "Fourchette probable (80 %)", color: SERIES[1], band: true },
            ]}
          />
        }
      >
        <ChartFrame height={340}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="period" {...axisProps} tickFormatter={fmtPeriod} minTickGap={isDay ? 36 : 20} />
              <YAxis {...axisProps} width={60} tickFormatter={fmtAxis} />
              <Tooltip content={<ChartTooltip labelFormatter={fmtPeriod} valueFormatter={fmtValue} />} />
              <ReferenceLine x={last.period} stroke="#c3c2b7" strokeDasharray="3 3" label={{ value: "Aujourd'hui", position: "insideTopRight", fill: "#898781", fontSize: 11 }} />
              <Area dataKey="band" name="Fourchette" stroke="none" fill={SERIES[1]} fillOpacity={0.15} isAnimationActive={false} />
              <Line dataKey="fitted" name="Modèle sur le passé" stroke={FITTED} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="actual" name="Réel" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
              <Line dataKey="forecast" name="Prévision" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFrame>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card
          title={isDay ? "Effet du jour de la semaine" : "Effet du mois de l'année"}
          subtitle="Coefficient appris par le modèle : 1,00 = période moyenne"
        >
          <ChartFrame height={220}>
            <ResponsiveContainer>
              <BarChart data={f.seasonality} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} width={40} domain={[0, "auto"]} tickFormatter={(v) => v.toFixed(1).replace(".", ",")} />
                <ReferenceLine y={1} stroke="#898781" strokeDasharray="3 3" />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  content={<ChartTooltip valueFormatter={(v) => `×${v.toFixed(2).replace(".", ",")}`} />}
                />
                <Bar dataKey="factor" name="Coefficient" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        </Card>

        <Explainer>
          <p className="font-medium text-ink">Comment lire cette prévision ?</p>
          <p>
            L'algorithme a découpé les ventes passées en trois morceaux : le <b>niveau</b> actuel, la <b>tendance</b> (est-ce que ça
            monte ou ça baisse ?) et la <b>saisonnalité</b>. Ici, il a appris tout seul qu'on vend
            {" "}<b>{Math.round((top.factor - 1) * 100)} % de plus</b> qu'en moyenne {isDay ? "le" : "en"} <b>{top.label}</b>, et
            {" "}{Math.round((1 - low.factor) * 100)} % de moins {isDay ? "le" : "en"} <b>{low.label}</b>.
          </p>
          <p>
            Pour mesurer sa fiabilité, on lui a caché la dernière période, on lui a demandé de la prévoir, puis on a comparé à la
            réalité : il s'est trompé en moyenne de <b>{f.mape === null ? "—" : `${String(f.mape).replace(".", ",")} %`}</b>.
          </p>
          <p>
            La zone orange claire est la <b>fourchette probable</b> : il y a 8 chances sur 10 que la réalité tombe dedans. Elle
            s'élargit avec le temps, car on est moins sûr dans un mois que demain.
          </p>
        </Explainer>
      </div>
    </>
  );
}
