import { NavLink, Route, Routes } from "react-router";
import { DashboardPage } from "./pages/Dashboard";
import { ProductionPage } from "./pages/Production";
import { ReceptionsPage } from "./pages/Receptions";
import { StockPage } from "./pages/Stock";
import { TracePage } from "./pages/Trace";

const links = [
  { to: "/", label: "Tableau de bord", icon: "📊" },
  { to: "/stock", label: "Stock", icon: "📦" },
  { to: "/production", label: "Production", icon: "🏭" },
  { to: "/receptions", label: "Réceptions", icon: "🚚" },
  { to: "/tracabilite", label: "Traçabilité", icon: "🔎" },
];

export function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-stone-900 text-stone-200">
        <div className="px-5 py-6">
          <p className="text-lg font-semibold text-white">🍪 Fabrique ERP</p>
          <p className="text-xs text-stone-400">Biscuiterie · Gennevilliers & Ardin</p>
        </div>
        <nav className="space-y-1 px-3">
          {links.map((l) => (
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
