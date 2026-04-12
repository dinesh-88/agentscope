import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getPrompts } from "@/lib/server-api";

export default async function PromptsPage() {
  const prompts = await getPrompts();

  return (
    <AppShell activePath="/prompts">
      <div className="p-8">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Prompts</h1>
        <p className="mb-6 text-gray-600">Versioned prompt templates and their rollout health.</p>
        <div className="rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((prompt) => (
                <tr key={prompt.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link href={`/prompts/${prompt.id}`} className="text-blue-600 hover:text-blue-500">
                      {prompt.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{prompt.project_id}</td>
                  <td className="px-4 py-3 text-gray-700">{new Date(prompt.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {prompts.length === 0 ? <div className="p-6 text-gray-500">No prompt versions captured yet.</div> : null}
        </div>
      </div>
    </AppShell>
  );
}
