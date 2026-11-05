import { productionOrderInput } from "@fabrique/shared";
import { useState } from "react";
import {
  useCompleteProductionOrder,
  useCreateProductionOrder,
  useLocations,
  useProductionOrder,
  useProductionOrders,
  useRecipes,
  useStartProductionOrder,
} from "../api";
import {
  Button,
  Card,
  ErrorBox,
  Field,
  fieldErrors,
  fmtDate,
  fmtQty,
  inputClass,
  Loading,
  PageTitle,
  StatusBadge,
  Table,
  td,
} from "../ui";

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function CreateOrderForm() {
  const recipes = useRecipes();
  const locations = useLocations();
  const create = useCreateProductionOrder();
  const [form, setForm] = useState({ recipeId: "", locationId: "", plannedQuantity: "500", plannedFor: tomorrow() });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Validation AVANT l'envoi, avec le même schéma que l'API (paquet partagé)
    const parsed = productionOrderInput.safeParse({
      recipeId: Number(form.recipeId),
      locationId: Number(form.locationId),
      plannedQuantity: Number(form.plannedQuantity),
      plannedFor: form.plannedFor,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    create.mutate(parsed.data);
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Card title="Planifier un ordre de fabrication">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Recette" error={errors.recipeId}>
          <select className={inputClass} value={form.recipeId} onChange={set("recipeId")}>
            <option value="">Choisir…</option>
            {recipes.data?.map((r) => (
              <option key={r.id} value={r.id}>{r.name} (fournée de {r.yield_quantity})</option>
            ))}
          </select>
        </Field>
        <Field label="Site de production" error={errors.locationId}>
          <select className={inputClass} value={form.locationId} onChange={set("locationId")}>
            <option value="">Choisir…</option>
            {locations.data?.filter((l) => l.type === "production").map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantité" error={errors.plannedQuantity}>
            <input type="number" className={inputClass} value={form.plannedQuantity} onChange={set("plannedQuantity")} />
          </Field>
          <Field label="Prévu le" error={errors.plannedFor}>
            <input type="date" className={inputClass} value={form.plannedFor} onChange={set("plannedFor")} />
          </Field>
        </div>
        <ErrorBox error={create.error} />
        {create.isSuccess && <p className="text-sm text-emerald-700">✅ {create.data.number} planifié</p>}
        <Button type="submit" disabled={create.isPending}>Planifier</Button>
      </form>
    </Card>
  );
}

function OrderDetail({ id }: { id: number }) {
  const order = useProductionOrder(id);
  const start = useStartProductionOrder();
  const complete = useCompleteProductionOrder();
  const [produced, setProduced] = useState("");

  if (order.isPending) return <Card><Loading /></Card>;
  if (order.isError) return <Card><ErrorBox error={order.error} /></Card>;
  const o = order.data;
  const open = o.status === "planifie" || o.status === "en_cours";

  return (
    <Card title={`${o.number} · ${o.product}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status={o.status} />
        <span>{o.location}</span>
        <span className="text-stone-400">·</span>
        <span>prévu le {fmtDate(o.planned_for)}</span>
        <span className="text-stone-400">·</span>
        <span>{fmtQty(o.planned_quantity, o.unit)} planifiés</span>
        {o.produced_quantity !== null && <span className="font-medium">→ {fmtQty(o.produced_quantity, o.unit)} produits</span>}
      </div>

      <h3 className="mb-2 text-sm font-semibold text-stone-700">Besoins en matières (calculés depuis la recette)</h3>
      <Table head={["Matière", "Besoin", "Disponible sur site", ""]}>
        {o.needs.map((n) => {
          const ok = n.available >= n.needed;
          return (
            <tr key={n.item_id}>
              <td className={td}>{n.item}</td>
              <td className={td}>{fmtQty(n.needed, n.unit)}</td>
              <td className={`${td} ${open && !ok ? "font-medium text-red-700" : ""}`}>{fmtQty(n.available, n.unit)}</td>
              <td className={td}>{open && (ok ? "✅" : "❌")}</td>
            </tr>
          );
        })}
      </Table>

      {open && (
        <div className="mt-5 space-y-3 border-t border-stone-100 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            {o.status === "planifie" && (
              <Button variant="secondary" onClick={() => start.mutate(o.id)} disabled={start.isPending}>
                ▶ Démarrer
              </Button>
            )}
            <Field label="Quantité réellement produite">
              <input
                type="number"
                className={`${inputClass} w-40`}
                placeholder={String(o.planned_quantity)}
                value={produced}
                onChange={(e) => setProduced(e.target.value)}
              />
            </Field>
            <Button
              onClick={() => complete.mutate({ id: o.id, producedQuantity: produced ? Number(produced) : undefined })}
              disabled={complete.isPending}
            >
              ✔ Clôturer l'OF
            </Button>
          </div>
          <p className="text-xs text-stone-500">
            La clôture consomme les matières (lots les plus proches de la péremption d'abord) et crée le lot de produits finis.
          </p>
          <ErrorBox error={complete.error ?? start.error} />
        </div>
      )}
    </Card>
  );
}

export function ProductionPage() {
  const orders = useProductionOrders();
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <>
      <PageTitle title="Production" subtitle="Ordres de fabrication : planifier → démarrer → clôturer" />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Ordres de fabrication">
            {orders.isPending ? <Loading /> : (
              <Table head={["N°", "Produit", "Site", "Prévu le", "Quantité", "Statut"]}>
                {orders.data?.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setSelected(o.id)}
                    className={`cursor-pointer hover:bg-amber-50 ${selected === o.id ? "bg-amber-50" : ""}`}
                  >
                    <td className={`${td} font-mono text-xs`}>{o.number}</td>
                    <td className={td}>{o.product}</td>
                    <td className={td}>{o.location}</td>
                    <td className={td}>{fmtDate(o.planned_for)}</td>
                    <td className={td}>{fmtQty(o.produced_quantity ?? o.planned_quantity, o.unit)}</td>
                    <td className={td}><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-xs text-stone-400">Cliquer sur un OF pour voir ses besoins et le clôturer.</p>
          </Card>
          {selected !== null && <OrderDetail key={selected} id={selected} />}
        </div>
        <CreateOrderForm />
      </div>
    </>
  );
}
