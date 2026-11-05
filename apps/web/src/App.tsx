import { can, type Permission, roleLabels } from "@fabrique/shared";
import {
  Activity,
  Boxes,
  CalendarClock,
  Cookie,
  Database,
  Factory,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  ScanSearch,
  TrendingUp,
  Truck,
} from "lucide-react";
import { Navigate, NavLink, Route, Routes } from "react-router";
import { ApiError, useLogout, useMe } from "./api";
import { DataExplorerPage } from "./pages/DataExplorer";
import { DirectionPage } from "./pages/Direction";
import { ForecastPage } from "./pages/Forecast";
import { LoginPage } from "./pages/Login";
import { OperationsPage } from "./pages/Operations";
import { PlanningPage } from "./pages/Planning";
import { ProductionPage } from "./pages/Production";
import { ReceptionsPage } from "./pages/Receptions";
import { StockPage } from "./pages/Stock";
import { TracePage } from "./pages/Trace";
import { Loading } from "./ui";

type NavItem = { to: string; label: string; icon: LucideIcon; permission?: Permission };

// Le menu, rangé par grandes familles. `permission` : le lien n'apparaît que si le rôle l'autorise.
const sections: { title: string; items: NavItem[] }[] = [
  {
    title: "Pilotage",
    items: [
      { to: "/", label: "Vue direction", icon: LayoutDashboard, permission: "pilotage" },
      { to: "/previsions", label: "Prévisions", icon: TrendingUp, permission: "planning" },
      { to: "/planification", label: "Planification", icon: CalendarClock, permission: "planning" },
    ],
  },
  {
    title: "Opérations",
    items: [
      { to: "/operations", label: "Activité", icon: Activity },
      { to: "/production", label: "Production", icon: Factory },
      { to: "/stock", label: "Stock", icon: Boxes },
      { to: "/receptions", label: "Réceptions", icon: Truck, permission: "reception" },
      { to: "/tracabilite", label: "Traçabilité", icon: ScanSearch },
    ],
  },
  {
    title: "Données",
    items: [{ to: "/donnees", label: "Explorateur", icon: Database, permission: "data" }],
  },
];

export function App() {
  const me = useMe();
  const logout = useLogout();

  // Tant qu'on ne sait pas qui est connecté : écran d'attente. Pas connecté (401) : page de connexion.
  if (me.isPending) return <div className="p-8"><Loading /></div>;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <LoginPage />;
    return <p className="p-8 text-critical">Impossible de joindre l'API. Est-elle démarrée ?</p>;
  }
  const user = me.data;
  const allowed = (item: NavItem) => !item.permission || can(user.role, item.permission);
  const initials = user.name.replace(/\(.*\)/, "").trim().slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-cocoa text-stone-300">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <Cookie size={18} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight text-white">Fabrique ERP</p>
            <p className="text-[11px] text-stone-400">Gennevilliers · Ardin</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {sections.map((section) => {
            const items = section.items.filter(allowed);
            if (items.length === 0) return null;
            return (
              <div key={section.title}>
                <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-stone-500">{section.title}</p>
                <div className="space-y-0.5">
                  {items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === "/"}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                          isActive ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon size={17} className={isActive ? "text-amber-400" : ""} aria-hidden />
                          {label}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cocoa-2 text-sm font-medium text-white ring-1 ring-white/15">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="text-[11px] text-stone-400">{roleLabels[user.role]}</p>
            </div>
            <button
              onClick={() => logout.mutate()}
              title="Changer de rôle"
              aria-label="Changer de rôle"
              className="rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px] px-8 py-7">
          <Routes>
            <Route path="/" element={can(user.role, "pilotage") ? <DirectionPage /> : <Navigate to="/operations" replace />} />
            <Route path="/previsions" element={<ForecastPage />} />
            <Route path="/planification" element={<PlanningPage />} />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/production" element={<ProductionPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/receptions" element={<ReceptionsPage />} />
            <Route path="/tracabilite" element={<TracePage />} />
            <Route path="/donnees" element={<DataExplorerPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
