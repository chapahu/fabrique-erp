import { useState } from "react";
import { useSearchParams } from "react-router";
import { useLotSearch, useLotTrace } from "../api";
import { Badge, Card, fmtDate, fmtDateTime, fmtQty, inputClass, Loading, PageTitle, Table, td } from "../ui";

const movementLabels: Record<string, string> = {
  reception: "Réception",
  consommation: "Consommation",
  production: "Production",
  vente: "Vente",
  transfert: "Transfert",
  perte: "Perte",
  ajustement: "Ajustement",
};

export function TracePage() {
  // Le lot choisi est dans l'URL (?lot=8) : on peut partager le lien ou y arriver depuis la page Stock
  const [params, setParams] = useSearchParams();
  const lotId = params.get("lot") ? Number(params.get("lot")) : null;
  const [search, setSearch] = useState("");
  const results = useLotSearch(search);
  const trace = useLotTrace(lotId);
  const select = (id: number) => setParams({ lot: String(id) });

  return (
    <>
      <PageTitle
        title="Traçabilité"
        subtitle="D'où vient un lot, dans quoi il a été utilisé : en cas d'alerte qualité, la réponse en quelques secondes"
      />
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <Card title="Rechercher un lot">
          <input
            className={inputClass}
            placeholder="N° de lot ou article (ex. BEU, cookie)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="mt-3 max-h-[60vh] space-y-1 overflow-auto">
            {results.data?.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => select(l.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-amber-50 ${lotId === l.id ? "bg-amber-50 ring-1 ring-amber-300" : ""}`}
                >
                  <span className="font-mono text-xs">{l.lot_number}</span>
                  <span className="block text-stone-600">{l.item}</span>
                  <span className="text-xs text-stone-400">reste {fmtQty(l.quantity, l.unit)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {lotId === null ? (
          <Card><p className="text-sm text-stone-500">Choisis un lot pour afficher sa traçabilité.</p></Card>
        ) : trace.isPending ? (
          <Card><Loading /></Card>
        ) : trace.data ? (
          <div className="space-y-6">
            <Card>
              <p className="font-mono text-sm text-stone-500">{trace.data.lot.lot_number}</p>
              <p className="text-xl font-semibold">{trace.data.lot.item}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {trace.data.lot.supplier && <Badge color="blue">Fournisseur : {trace.data.lot.supplier}</Badge>}
                {trace.data.lot.production_order && <Badge color="amber">Fabriqué par {trace.data.lot.production_order}</Badge>}
                <Badge>DLC {fmtDate(trace.data.lot.expires_on)}</Badge>
              </div>
            </Card>

            {trace.data.upstream.length > 0 && (
              <Card title="⬆️ Amont : matières utilisées pour fabriquer ce lot">
                <Table head={["Lot", "Matière", "Quantité utilisée"]}>
                  {trace.data.upstream.map((u) => (
                    <tr key={u.lot_id} onClick={() => select(u.lot_id)} className="cursor-pointer hover:bg-amber-50">
                      <td className={`${td} font-mono text-xs text-amber-800`}>{u.lot_number}</td>
                      <td className={td}>{u.item}</td>
                      <td className={td}>{fmtQty(u.quantity_used, u.unit)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}

            {trace.data.downstream.length > 0 && (
              <Card title="⬇️ Aval : produits fabriqués avec ce lot">
                <Table head={["OF", "Lot produit", "Produit", "Quantité de ce lot utilisée"]}>
                  {trace.data.downstream.map((d) => (
                    <tr key={d.lot_id} onClick={() => select(d.lot_id)} className="cursor-pointer hover:bg-amber-50">
                      <td className={`${td} font-mono text-xs`}>{d.production_order}</td>
                      <td className={`${td} font-mono text-xs text-amber-800`}>{d.lot_number}</td>
                      <td className={td}>{d.item}</td>
                      <td className={td}>{fmtQty(d.quantity_used, trace.data.lot.unit)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}

            <Card title="🕑 Historique des mouvements">
              <Table head={["Date", "Mouvement", "Quantité", "Emplacement", "OF"]}>
                {trace.data.history.map((h, i) => (
                  <tr key={i}>
                    <td className={td}>{fmtDateTime(h.created_at)}</td>
                    <td className={td}>{movementLabels[h.type] ?? h.type}</td>
                    <td className={`${td} font-medium ${h.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {h.quantity > 0 ? "+" : ""}{fmtQty(h.quantity, trace.data.lot.unit)}
                    </td>
                    <td className={td}>{h.location}</td>
                    <td className={`${td} font-mono text-xs`}>{h.production_order ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
