"use client";
import { create } from "zustand";
import { API_SSE_URL } from "../api";

interface EventsState {
  connected: boolean;
  eventSource: EventSource | null;
  listeners: Map<string, Set<() => void>>;
  connect: () => void;
  disconnect: () => void;
  onEvent: (channel: string, callback: () => void) => () => void;
}

export const useEventsStore = create<EventsState>((set, get) => ({
  connected: false,
  eventSource: null,
  listeners: new Map(),

  connect: () => {
    const existing = get().eventSource;
    if (existing) return;

    const es = new EventSource(API_SSE_URL);

    es.onopen = () => set({ connected: true });
    es.onerror = () => {
      set({ connected: false });
      // Auto-reconnect handled by EventSource
    };

    const channels = ["comment_change", "task_change", "wake_event_change"];
    for (const channel of channels) {
      es.addEventListener(channel, () => {
        const listeners = get().listeners.get(channel);
        if (listeners) {
          listeners.forEach((cb) => cb());
        }
      });
    }

    set({ eventSource: es });
  },

  disconnect: () => {
    const es = get().eventSource;
    if (es) {
      es.close();
      set({ eventSource: null, connected: false });
    }
  },

  onEvent: (channel: string, callback: () => void) => {
    const { listeners } = get();
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set());
    }
    listeners.get(channel)!.add(callback);
    set({ listeners: new Map(listeners) });

    // Return unsubscribe function
    return () => {
      const set_ = listeners.get(channel);
      if (set_) set_.delete(callback);
    };
  },
}));
