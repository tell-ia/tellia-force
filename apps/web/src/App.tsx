import { useEffect, useState } from "react";
import type { Alert } from "@tellia/shared";
import { api } from "./lib/api";
import { Screen, Card, Button } from "./components";

export default function App() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.list("alert", { limit: 20 })
      .then((r) => setAlerts(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <Screen title="Tellia Force">
      <div className="flex flex-col gap-3">
        {error && (
          <Card className="border-red-900 text-red-300">
            API: {error}
            <p className="text-xs text-neutral-500 mt-1">
              Lance l'API (<code>deno task dev</code>) — elle lit Supabase.
            </p>
          </Card>
        )}

        {loading && <p className="text-neutral-500 text-sm">Chargement…</p>}

        {alerts.map((a) => (
          <Card key={a.id}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{a.title}</span>
              <span className="text-xs text-neutral-500">#{a.priority}</span>
            </div>
            {a.body && <p className="text-sm text-neutral-400 mt-1">{a.body}</p>}
            <span className="text-xs text-neutral-600">{a.status}</span>
          </Card>
        ))}

        {!loading && !error && alerts.length === 0 && (
          <p className="text-neutral-500 text-sm">Aucune alerte.</p>
        )}

        <Button onClick={load}>Rafraîchir</Button>
      </div>
    </Screen>
  );
}
