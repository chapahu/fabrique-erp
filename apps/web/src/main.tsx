import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./index.css";

// TanStack Query gère toutes les données venant de l'API :
// mise en cache, état de chargement, erreurs, et rafraîchissement automatique.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les écrans se mettent à jour tout seuls toutes les 5 secondes :
      // si l'atelier clôture un OF, le stock affiché en boutique bouge sans recharger la page.
      refetchInterval: 5000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
