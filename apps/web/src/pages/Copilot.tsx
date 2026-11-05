// =====================================================================
// COPILOTE IA : une conversation en français avec les données de l'ERP
// =====================================================================
import type { Role } from "@fabrique/shared";
import { KeyRound, Send, Sparkles, User, Wrench } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { type ChatMessage, useAskCopilot, useCopilotStatus, useMe } from "../api";
import { Button, Card, ErrorBox, Explainer, Loading, PageTitle } from "../ui";

// Questions d'exemple adaptées au métier de la personne connectée
const suggestions: Record<Role, string[]> = {
  admin: [
    "Comment se portent les ventes ce mois-ci par rapport au mois dernier ?",
    "Quelle boutique progresse le plus, et laquelle m'inquiète ?",
    "Quel produit est le plus rentable ?",
    "Combien prévoit-on de vendre en décembre ?",
  ],
  production: [
    "Que dois-je produire cette semaine ?",
    "Quelles matières vont manquer dans les 14 prochains jours ?",
    "Quels ordres de fabrication sont en cours ?",
    "D'où vient le lot OF-2026-00002 ?",
  ],
  achats: [
    "Quelles matières dois-je commander, et pour quel budget ?",
    "Quelles matières sont sous leur seuil minimum ?",
    "Quels lots de beurre avons-nous en stock ?",
    "Combien de cookies prévoit-on de vendre les 4 prochaines semaines ?",
  ],
  boutique: [
    "Quel est le stock de cookies dans ma boutique ?",
    "Quels produits ont une date limite proche ?",
    "D'où vient le lot OF-2026-00002 ?",
    "Quelles sont les dernières fournées terminées ?",
  ],
};

/** Mise en forme minimale des réponses : paragraphes, listes « - » et **gras** */
function RichText({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
    );
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="ml-5 list-disc space-y-1">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[-*•] /.test(line)) list.push(line.slice(2));
    else {
      flush();
      if (line.startsWith("#")) blocks.push(<p key={blocks.length} className="font-semibold">{inline(line.replace(/^#+\s*/, ""))}</p>);
      else if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}

export function CopilotPage() {
  const me = useMe();
  const status = useCopilotStatus();
  const ask = useAskCopilot();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Défile jusqu'au dernier message. Accolades obligatoires : un effet React ne doit rien renvoyer
  // (sauf une fonction de nettoyage) ; or scrollIntoView renvoie une promesse dans les navigateurs récents.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, ask.isPending]);

  function send(question: string) {
    const q = question.trim();
    if (!q || ask.isPending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    ask.mutate(next, {
      onSuccess: (r) => setMessages([...next, { role: "assistant", content: r.answer, tools: r.tools }]),
      // En cas d'erreur, on retire la question pour pouvoir la reposer
      onError: () => { setMessages(messages); setInput(q); },
    });
  }

  const role = me.data?.role ?? "admin";

  return (
    <>
      <PageTitle title="Copilote IA" subtitle="Pose une question en français : l'IA consulte les données de l'ERP (avec tes droits) et te répond" />

      {status.data && !status.data.enabled && (
        <div className="mb-6">
          <Explainer>
            <p className="flex items-center gap-2 font-medium text-ink"><KeyRound size={16} aria-hidden /> Copilote désactivé : aucun crédit et aucune clé d'API</p>
            <p>
              Le copilote est prêt, mais il n'est pas encore branché : aucun crédit n'a été mis sur le compte Anthropic et aucune
              clé d'API n'est configurée. Chaque question coûterait quelques centimes.
            </p>
            <p>
              Pour l'activer : ajouter du crédit et créer une clé sur platform.claude.com, la coller dans le fichier
              <code className="mx-1 rounded bg-white px-1">.env</code> après <code className="mx-1 rounded bg-white px-1">ANTHROPIC_API_KEY=</code>,
              puis redémarrer l'API.
            </p>
          </Explainer>
        </div>
      )}

      <Card padded={false} className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="mx-auto max-w-2xl py-6 text-center">
              <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Sparkles size={22} aria-hidden />
              </span>
              <p className="font-medium">Que veux-tu savoir ?</p>
              <p className="mb-5 text-sm text-ink-2">Quelques idées pour commencer :</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions[role].map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={!status.data?.enabled}
                    className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm text-ink-2 transition hover:border-brand/40 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Sparkles size={16} aria-hidden /></span>
              )}
              <div className={`max-w-[78%] rounded-xl px-4 py-3 text-sm ${m.role === "user" ? "bg-cocoa text-white" : "border border-line bg-page/60"}`}>
                {m.role === "user" ? m.content : <RichText text={m.content} />}
                {m.tools && m.tools.length > 0 && (
                  <p className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs text-muted">
                    <Wrench size={12} aria-hidden /> A consulté : {m.tools.join(" · ")}
                  </p>
                )}
              </div>
              {m.role === "user" && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cocoa-2 text-white"><User size={15} aria-hidden /></span>
              )}
            </div>
          ))}

          {ask.isPending && (
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Sparkles size={16} aria-hidden /></span>
              <div className="rounded-xl border border-line bg-page/60 px-4 py-3"><Loading label="Le copilote consulte les données…" /></div>
            </div>
          )}
          {ask.isError && <ErrorBox error={ask.error} />}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-end gap-2 border-t border-line p-3"
        >
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={status.data?.enabled ? "Pose ta question… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)" : "Copilote désactivé : ajoute la clé d'API"}
            disabled={!status.data?.enabled}
            className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
          />
          <Button type="submit" disabled={!input.trim() || ask.isPending || !status.data?.enabled}>
            <Send size={15} aria-hidden /> Envoyer
          </Button>
          {messages.length > 0 && (
            <Button type="button" variant="secondary" onClick={() => setMessages([])} disabled={ask.isPending}>Nouvelle conversation</Button>
          )}
        </form>
      </Card>
    </>
  );
}
