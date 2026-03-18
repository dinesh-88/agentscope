"use client";

import { FormEvent, useEffect, useState } from "react";
import { motion } from "framer-motion";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createAlert,
  deleteAlert,
  getAlertEvents,
  getAlerts,
  getCurrentUser,
  type Alert,
  type AlertEvent,
} from "@/lib/api";

const conditions = ["failure_rate", "latency_ms", "token_usage", "cost_usd", "tool_error_rate"];

export default function AlertsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [name, setName] = useState("Failure rate guardrail");
  const [condition, setCondition] = useState("failure_rate");
  const [threshold, setThreshold] = useState("0.2");
  const [windowMinutes, setWindowMinutes] = useState("15");

  async function refresh() {
    const [alertRows, eventRows] = await Promise.all([getAlerts(), getAlertEvents()]);
    setAlerts(alertRows);
    setEvents(eventRows);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const me = await getCurrentUser();
      if (!cancelled) setProjectId(me.onboarding.default_project_id);
      await refresh();
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    await createAlert({
      project_id: projectId,
      name,
      condition_type: condition,
      threshold_value: Number(threshold),
      window_minutes: Number(windowMinutes),
    });
    await refresh();
  }

  return (
    <AppShell activePath="/alerts">
      <section className="space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Alerts</h1>
          <p className="text-sm text-neutral-600">Set simple safeguards and get notified when behavior drifts.</p>
        </div>

        <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
          <CardHeader>
            <CardTitle>Create Alert</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
              <input className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm" value={name} onChange={(e) => setName(e.target.value)} required />
              <select className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm" value={condition} onChange={(e) => setCondition(e.target.value)}>
                {conditions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <input type="number" step="0.0001" className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              <input type="number" min={1} className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
              <Button type="submit" className="sm:col-span-2" disabled={!projectId}>Create alert</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
            <CardHeader>
              <CardTitle>Active Alerts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
              {alerts.map((alert, index) => (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="flex items-center justify-between rounded-xl border border-black/8 bg-white p-3"
                >
                  <div>
                    <p className="font-medium text-neutral-900">{alert.name}</p>
                    <p className="text-xs text-neutral-500">{alert.condition_type} &gt; {alert.threshold_value} in {alert.window_minutes}m</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void deleteAlert(alert.id).then(refresh)}>
                    Remove
                  </Button>
                </motion.div>
              ))}
              {alerts.length === 0 ? <p className="text-sm text-neutral-500">No alerts configured yet.</p> : null}
            </CardContent>
          </Card>

          <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pb-4">
              {events.map((item) => (
                <div key={item.id} className="rounded-xl border border-black/8 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-700">{new Date(item.triggered_at).toLocaleString()}</p>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-600">{JSON.stringify(item.payload, null, 2)}</pre>
                </div>
              ))}
              {events.length === 0 ? <p className="text-sm text-neutral-500">No events yet.</p> : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
