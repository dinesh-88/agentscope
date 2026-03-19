"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { searchArtifacts, type ArtifactSearchResult } from "@/lib/api";

const SEARCH_DEBOUNCE_MS = 350;

function sanitizeSnippet(value: string) {
  return value.replace(/<[^>]*>/g, "");
}

export function ArtifactSearchPanel() {
  const [query, setQuery] = useState("");
  const [errorType, setErrorType] = useState("");
  const [model, setModel] = useState("");
  const [spanType, setSpanType] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<ArtifactSearchResult[]>([]);

  const tags = useMemo(
    () =>
      tagsInput
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    [tagsInput],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setTotal(0);
      setError(null);
      setIsLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await searchArtifacts({
          query: trimmed,
          error_type: errorType || undefined,
          model: model || undefined,
          span_type: spanType || undefined,
          tags,
          limit: 25,
          offset: 0,
        });
        setResults(response.results);
        setTotal(response.total);
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "Search failed";
        setError(message);
        setResults([]);
        setTotal(0);
      } finally {
        setIsLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [errorType, model, query, spanType, tags]);

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-base font-medium text-gray-900">Artifact Search</h2>
        <p className="text-sm text-gray-600">Full-text search across prompts, responses, and error artifacts.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="relative block xl:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search text (required)"
            className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500"
          />
        </label>

        <select
          value={errorType}
          onChange={(event) => setErrorType(event.target.value)}
          className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
        >
          <option value="">All error types</option>
          <option value="invalid_json">invalid_json</option>
          <option value="rate_limit">rate_limit</option>
          <option value="timeout">timeout</option>
          <option value="tool_error">tool_error</option>
          <option value="unknown">unknown</option>
        </select>

        <input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Model"
          className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
        />

        <input
          value={spanType}
          onChange={(event) => setSpanType(event.target.value)}
          placeholder="Span type"
          className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
        />
      </div>

      <div className="mt-3">
        <input
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
          placeholder="Tags (comma separated)"
          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
        />
      </div>

      <div className="mt-4 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 text-sm text-gray-600">
          <span>{query.trim() ? `${total} result${total === 1 ? "" : "s"}` : "Enter a query to search"}</span>
          <span>{isLoading ? "Searching..." : "Ready"}</span>
        </div>

        {error ? <div className="px-3 py-4 text-sm text-red-700">{error}</div> : null}

        {!error && query.trim() && !isLoading && results.length === 0 ? (
          <div className="px-3 py-4 text-sm text-gray-600">No artifacts matched your query and filters.</div>
        ) : null}

        {results.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {results.map((item) => (
              <li key={item.artifact_id} className="px-3 py-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span className="rounded bg-gray-100 px-2 py-0.5">{item.span_type}</span>
                  <span>{item.model ?? "model: -"}</span>
                  <span>{item.error_type ?? "error: -"}</span>
                  <span>rank: {item.rank.toFixed(2)}</span>
                </div>
                <p className="mb-2 text-sm text-gray-900">{sanitizeSnippet(item.snippet)}</p>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-gray-500">run {item.run_id}</span>
                  <Link href={`/runs/${item.run_id}`} className="font-medium text-blue-700 hover:text-blue-800">
                    Open trace
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
