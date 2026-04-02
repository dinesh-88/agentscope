import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUsd(
  value: number,
  options?: {
    decimals?: number;
    tinyThreshold?: number;
  },
) {
  const decimals = options?.decimals ?? 4;
  const tinyThreshold = options?.tinyThreshold ?? 0.0001;
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);

  if (abs > 0 && abs < tinyThreshold) {
    return `<$${tinyThreshold.toFixed(decimals)}`;
  }

  return `$${safe.toFixed(decimals)}`;
}
