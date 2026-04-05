export type PromptSectionFormat = "text" | "json";

export type PromptSection = {
  id: string;
  title: string;
  content: string;
  format: PromptSectionFormat;
};

export type PromptPresentation = {
  sections: PromptSection[];
  raw: string;
  rawFormat: PromptSectionFormat;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return toJson(value);
}

function normalizeRaw(payload: unknown): { raw: string; rawFormat: PromptSectionFormat } {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return { raw: JSON.stringify(JSON.parse(trimmed), null, 2), rawFormat: "json" };
      } catch {
        return { raw: payload, rawFormat: "text" };
      }
    }
    return { raw: payload, rawFormat: "text" };
  }
  return { raw: toJson(payload), rawFormat: "json" };
}

function getValueByPath(root: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function pickByPaths(root: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    const value = getValueByPath(root, path);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function isSchemaLike(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = ["properties", "required", "$schema", "type", "title", "items", "oneOf", "anyOf", "allOf"];
  return keys.some((key) => key in value);
}

function roleLabel(role: string) {
  const normalized = role.trim().toLowerCase();
  if (normalized === "system") return "System";
  if (normalized === "assistant") return "Assistant";
  if (normalized === "user") return "User";
  return "Message";
}

function buildMessageSections(messages: unknown[]): PromptSection[] {
  const sections: PromptSection[] = [];

  messages.forEach((message, index) => {
    if (typeof message === "string") {
      sections.push({
        id: `message-${index + 1}`,
        title: `User Message ${index + 1}`,
        content: message,
        format: "text",
      });
      return;
    }

    if (isRecord(message)) {
      const role = typeof message.role === "string" ? message.role : "message";
      const contentSource = message.content ?? message.text ?? message.message ?? message;
      const format: PromptSectionFormat = typeof contentSource === "string" ? "text" : "json";

      sections.push({
        id: `message-${index + 1}`,
        title: `${roleLabel(role)} Message ${index + 1}`,
        content: format === "text" ? String(contentSource) : toJson(contentSource),
        format,
      });
      return;
    }

    sections.push({
      id: `message-${index + 1}`,
      title: `Message ${index + 1}`,
      content: toDisplayText(message),
      format: typeof message === "string" ? "text" : "json",
    });
  });

  return sections;
}

function dedupeSections(sections: PromptSection[]) {
  const seen = new Set<string>();
  return sections.filter((section) => {
    const key = `${section.title}::${section.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildPromptPresentation(payload: unknown): PromptPresentation {
  const raw = normalizeRaw(payload);

  if (!isRecord(payload)) {
    return {
      sections: [
        {
          id: "prompt-content",
          title: "Prompt Content",
          content: toDisplayText(payload),
          format: typeof payload === "string" ? "text" : "json",
        },
      ],
      raw: raw.raw,
      rawFormat: raw.rawFormat,
    };
  }

  const sections: PromptSection[] = [];

  const messages = payload.messages;
  if (Array.isArray(messages)) {
    sections.push(...buildMessageSections(messages));
  }

  const promptText = pickByPaths(payload, [
    ["system_prompt"],
    ["system"],
    ["instructions"],
    ["instruction"],
    ["prompt"],
    ["query"],
    ["task"],
    ["data", "final_prompt"],
  ]);

  if (promptText !== undefined && promptText !== null) {
    sections.push({
      id: "prompt-text",
      title: "Prompt",
      content: toDisplayText(promptText),
      format: typeof promptText === "string" ? "text" : "json",
    });
  }

  const schemaCandidate = pickByPaths(payload, [
    ["schema"],
    ["json_schema"],
    ["output_schema"],
    ["response_schema"],
    ["response_format", "json_schema"],
    ["response_format", "schema"],
    ["data", "schema"],
  ]);

  if (isSchemaLike(schemaCandidate)) {
    sections.push({
      id: "output-schema",
      title: "Output Schema",
      content: toJson(schemaCandidate),
      format: "json",
    });
  }

  const inputCandidate = pickByPaths(payload, [
    ["input"],
    ["payload"],
    ["request"],
    ["context"],
    ["data", "input"],
    ["data", "payload"],
    ["data", "request"],
    ["columns"],
    ["sample_rows"],
    ["describe"],
  ]);

  if (inputCandidate !== undefined && inputCandidate !== null) {
    sections.push({
      id: "context-data",
      title: "User Input / Context Data",
      content: toDisplayText(inputCandidate),
      format: typeof inputCandidate === "string" ? "text" : "json",
    });
  }

  const deduped = dedupeSections(sections);
  if (deduped.length === 0) {
    deduped.push({
      id: "prompt-content",
      title: "Prompt Content",
      content: toDisplayText(payload),
      format: "json",
    });
  }

  return {
    sections: deduped,
    raw: raw.raw,
    rawFormat: raw.rawFormat,
  };
}
