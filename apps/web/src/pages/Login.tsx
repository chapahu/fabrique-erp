import { loginInput, type Role } from "@fabrique/shared";
import { useState } from "react";
import { type DemoAccount, useDemoAccounts, useDemoLogin, useLogin } from "../api";
import { Button, ErrorBox, Field, fieldErrors, inputClass } from "../ui";

// Ce que chaque rôle voit et peut faire, pour aider à choisir
const roleCards: Record<Role, { icon: string; title: string; description: string }> = {
  admin: { icon: "👔", title: "Direction", description: "Vue globale : voit tout et peut tout faire" },
  production: { icon: "🏭", title: "Chef d'atelier", description: "Planifie et fabrique les cookies, reçoit les livraisons" },
  achats: { icon: "🚚", title: "Achats", description: "Enregistre les livraisons des fournisseurs" },
  boutique: { icon: "🛍️", title: "Vendeur·se", description: "Vend les cookies, dans sa boutique uniquement" },
};

function RolePicker({ accounts }: { accounts: DemoAccount[] }) {
  const demoLogin = useDemoLogin();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((a) => {
          const card = roleCards[a.role];
          return (
            <button
              key={a.id}
              onClick={() => demoLogin.mutate(a.id)}
              disabled={demoLogin.isPending}
              className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-amber-500 hover:shadow ${
                a.role === "admin" ? "border-amber-300 sm:col-span-2" : "border-stone-200"
              }`}
            >
              <p className="text-2xl">{card.icon}</p>
              <p className="mt-1 font-semibold">
                {card.title}
                {a.location && <span className="font-normal text-stone-500"> · {a.location}</span>}
              </p>
              <p className="text-sm text-stone-500">{card.description}</p>
              <p className="mt-2 text-xs text-stone-400">Connecté en tant que {a.name}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-3"><ErrorBox error={demoLogin.error} /></div>
    </>
  );
}

function PasswordLogin() {
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = loginInput.safeParse({ email, password });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    login.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <Field label="E-mail" error={errors.email}>
        <input className={inputClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Mot de passe" error={errors.password}>
        <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorBox error={login.error} />
      <Button type="submit" className="w-full" disabled={login.isPending}>Se connecter</Button>
    </form>
  );
}

export function LoginPage() {
  const demo = useDemoAccounts();
  const demoEnabled = demo.isSuccess && demo.data.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 p-6">
      <div className={`w-full ${demoEnabled ? "max-w-2xl" : "max-w-sm"}`}>
        <p className="mb-1 text-center text-2xl font-semibold">🍪 Fabrique ERP</p>

        {demo.isPending ? null : demoEnabled ? (
          <>
            <p className="mb-6 text-center text-sm text-stone-500">Mode démo : choisis un rôle pour entrer</p>
            <RolePicker accounts={demo.data} />
            <details className="mt-6 text-sm text-stone-500">
              <summary className="cursor-pointer">Connexion classique (e-mail et mot de passe)</summary>
              <div className="mt-3"><PasswordLogin /></div>
            </details>
          </>
        ) : (
          <div className="mt-6"><PasswordLogin /></div>
        )}
      </div>
    </div>
  );
}
