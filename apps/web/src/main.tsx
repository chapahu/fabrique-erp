import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ApiError } from "./api";
import { App } from "./App";
import "./index.css";

// TanStack Query gère toutes les données venant de l'API :
// mise en cache, état de chargement, erreurs, et rafraîchissement automatique.
const queryClient: QueryClient = new QueryClient({
  // Si une donnée répond 401 (badge expiré), on revérifie "qui suis-je ?" -> retour à la page de connexion
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== "me") {
        queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Les écrans se mettent à jour tout seuls toutes les 5 secondes :
      // si l'atelier clôture un OF, le stock affiché en boutique bouge sans recharger la page.
      refetchInterval: 5000,
      // On réessaie une fois en cas de souci réseau, mais pas si l'API dit "non connecté" ou "interdit"
      retry: (count, error) => !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1,
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
