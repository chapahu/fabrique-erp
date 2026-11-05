import { receptionInput } from "@fabrique/shared";
import { useState } from "react";
import { useCreateReception, useItems, useLocations, useSuppliers } from "../api";
import { Button, Card, ErrorBox, Field, fieldErrors, inputClass, PageTitle } from "../ui";

const empty = { itemId: "", supplierId: "", locationId: "", lotNumber: "", quantity: "", expiresOn: "" };

export function ReceptionsPage() {
  const items = useItems();
  const suppliers = useSuppliers();
  const locations = useLocations();
  const create = useCreateReception();
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = receptionInput.safeParse({
      itemId: Number(form.itemId),
      supplierId: Number(form.supplierId),
      locationId: Number(form.locationId),
      lotNumber: form.lotNumber,
      quantity: Number(form.quantity),
      expiresOn: form.expiresOn || undefined,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    create.mutate(parsed.data, { onSuccess: () => setForm(empty) });
  }

  const unit = items.data?.find((i) => i.id === Number(form.itemId))?.unit;

  return (
    <>
      <PageTitle title="Réceptions" subtitle="Enregistrer une livraison fournisseur : crée un lot et l'entrée en stock" />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Article" error={errors.itemId}>
              <select className={inputClass} value={form.itemId} onChange={set("itemId")}>
                <option value="">Choisir…</option>
                {items.data?.filter((i) => i.type !== "produit_fini").map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Fournisseur" error={errors.supplierId}>
              <select className={inputClass} value={form.supplierId} onChange={set("supplierId")}>
                <option value="">Choisir…</option>
                {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Livré à" error={errors.locationId}>
              <select className={inputClass} value={form.locationId} onChange={set("locationId")}>
                <option value="">Choisir…</option>
                {locations.data?.filter((l) => l.type !== "boutique").map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>
            <Field label="N° de lot fournisseur" error={errors.lotNumber}>
              <input className={inputClass} value={form.lotNumber} onChange={set("lotNumber")} placeholder="ex. BEU-2026-0102" />
            </Field>
            <Field label={`Quantité${unit ? ` (${unit})` : ""}`} error={errors.quantity}>
              <input type="number" step="any" className={inputClass} value={form.quantity} onChange={set("quantity")} />
            </Field>
            <Field label="DLC / DDM (facultatif)" error={errors.expiresOn}>
              <input type="date" className={inputClass} value={form.expiresOn} onChange={set("expiresOn")} />
            </Field>
          </div>
          <p className="text-xs text-stone-500">Sans date saisie, la DLC est calculée à partir de la durée de vie de l'article.</p>
          <ErrorBox error={create.error} />
          {create.isSuccess && <p className="text-sm text-emerald-700">✅ Lot {create.data.lot.lot_number} réceptionné et entré en stock</p>}
          <Button type="submit" disabled={create.isPending}>Réceptionner</Button>
        </form>
      </Card>
    </>
  );
}
