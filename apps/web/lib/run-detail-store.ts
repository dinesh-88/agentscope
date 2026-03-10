"use client";

import { create } from "zustand";

type RunDetailState = {
  selectedSpanId: string | null;
  setSelectedSpanId: (spanId: string | null) => void;
};

export const useRunDetailStore = create<RunDetailState>((set) => ({
  selectedSpanId: null,
  setSelectedSpanId: (selectedSpanId) => set({ selectedSpanId }),
}));
