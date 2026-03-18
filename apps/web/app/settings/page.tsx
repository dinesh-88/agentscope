"use client";

import { useState } from "react";
import { Bell, Database, Key, Save, Shield } from "lucide-react";

import { AppShell } from "@/components/app-shell";

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <AppShell activePath="/settings">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-gray-600">Configure your AgentScope environment</p>
        </div>

        <div className="max-w-3xl space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Key className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">API Configuration</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="api-key" className="text-sm font-medium text-gray-900">
                  API Key
                </label>
                <input
                  id="api-key"
                  type="password"
                  placeholder="sk-..."
                  defaultValue="sk-proj-xxxxxxxxxxxx"
                  className="mt-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Your OpenAI API key for LLM calls</p>
              </div>
              <div>
                <label htmlFor="api-endpoint" className="text-sm font-medium text-gray-900">
                  API Endpoint
                </label>
                <input
                  id="api-endpoint"
                  type="url"
                  placeholder="https://api.openai.com/v1"
                  defaultValue="https://api.openai.com/v1"
                  className="mt-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="default-model" className="text-sm font-medium text-gray-900">
                  Default Model
                </label>
                <select
                  id="default-model"
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  defaultValue="gpt-4-turbo"
                >
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  <option value="claude-3-opus">Claude 3 Opus</option>
                  <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Notifications</h2>
            </div>
            <div className="space-y-4">
              {[
                ["Failed Run Alerts", "Get notified when a run fails", true],
                ["High Latency Warnings", "Alert when latency exceeds threshold", true],
                ["Token Usage Alerts", "Notify when approaching token limits", false],
                ["Daily Summary", "Receive daily performance summary", false],
              ].map(([title, desc, checked]) => (
                <div key={String(title)} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{title}</p>
                    <p className="text-sm text-gray-600">{desc}</p>
                  </div>
                  <input defaultChecked={Boolean(checked)} type="checkbox" className="h-4 w-4" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Storage & Retention</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="retention" className="text-sm font-medium text-gray-900">
                  Run History Retention
                </label>
                <select
                  id="retention"
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  defaultValue="30"
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="forever">Forever</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Store Prompts & Responses</p>
                  <p className="text-sm text-gray-600">Save full LLM inputs and outputs</p>
                </div>
                <input defaultChecked type="checkbox" className="h-4 w-4" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Compress Old Runs</p>
                  <p className="text-sm text-gray-600">Reduce storage for runs older than 90 days</p>
                </div>
                <input defaultChecked type="checkbox" className="h-4 w-4" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Security</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Redact Sensitive Data</p>
                  <p className="text-sm text-gray-600">Automatically redact PII in logs</p>
                </div>
                <input defaultChecked type="checkbox" className="h-4 w-4" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Require Authentication</p>
                  <p className="text-sm text-gray-600">Enforce login for all users</p>
                </div>
                <input defaultChecked type="checkbox" className="h-4 w-4" />
              </div>
              <div>
                <label htmlFor="session-timeout" className="text-sm font-medium text-gray-900">
                  Session Timeout (minutes)
                </label>
                <input
                  id="session-timeout"
                  type="number"
                  defaultValue="60"
                  min="5"
                  max="1440"
                  className="mt-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
              Reset to Defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
            >
              <Save className="mr-2 h-4 w-4" />
              {saved ? "Saved!" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
