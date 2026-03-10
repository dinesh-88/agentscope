export function formatSummary(items: string[]): string {
  if (items.length === 0) {
    return "No items";
  }

  return `Summary: ${items.join(", ")}.`;
}

export function firstItem(items: string[]): string {
  return (items[0] ?? "unknown").toUpperCase();
}

console.log(formatSummary(["alpha", "beta"]));
console.log(firstItem(["alpha"]));
