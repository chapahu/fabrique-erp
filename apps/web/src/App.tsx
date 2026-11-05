import { can, type Permission, roleLabels } from "@fabrique/shared";
import { NavLink, Route, Routes } from "react-router";
import { ApiError, useLogout, useMe } from "./api";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { ProductionPage } from "./pages/Production";
import { ReceptionsPage } from "./pages/Receptions";
import { StockPage } from "./pages/Stock";
import { TracePage } from "./pages/Trace";
import { Loading } from "./ui";

// `permission` : le lien n'apparaît que si le rôle autorise cette action
const links: { to: string; label: string; icon: string; permission?: Permission }[] = [
  { to: "/", label: "Tableau de bord", icon: "📊" },
  { to: "/stock", label: "Stock", icon: "📦" },
  { to: "/production", label: "Production", icon: "🏭" },
  { to: "/receptions", label: "Réceptions", icon: "🚚", permission: "reception" },
  { to: "/tracabilite", label: "Traçabilité", icon: "🔎" },
];

export function App() {
  const me = useMe();
  const logout = useLogout();

  // Tant qu'on ne sait pas qui est connecté : écran d'attente. Pas connecté (401) : page de connexion.
  if (me.isPending) return <div className="p-8"><Loading /></div>;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
    return <p className="p-8 text-red-700">Impossible de joindre l'API. Est-elle démarrée ?</p>;
  }
  const user = me.data;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-stone-900 text-stone-200">
        <div className="px-5 py-6">
          <p className="text-lg font-semibold text-white">🍪 Fabrique ERP</p>
          <p className="text-xs text-stone-400">Biscuiterie · Gennevilliers & Ardin</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {links
            .filter((l) => !l.permission || can(user.role, l.permission))
            .map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    isActive ? "bg-amber-700 text-white" : "hover:bg-stone-800"
                  }`
                }
              >
                <span>{l.icon}</span>
                {l.label}
              </NavLink>
            ))}
        </nav>
        <div className="border-t border-stone-800 px-5 py-4 text-sm">
          <p className="font-medium text-white">{user.name}</p>
          <p className="text-xs text-stone-400">Rôle : {roleLabels[user.role]}</p>
          <button onClick={() => logout.mutate()} className="mt-2 text-xs text-amber-400 hover:underline">
            ↩ Changer de rôle
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/production" element={<ProductionPage />} />
          <Route path="/receptions" element={<ReceptionsPage />} />
          <Route path="/tracabilite" element={<TracePage />} />
        </Routes>
      </main>
    </div>
  );
}
