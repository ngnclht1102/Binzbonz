"use client";
import { create } from "zustand";
import { getActors, createActor, type Actor } from "../api";

interface ActorsState {
  agents: Actor[];
  allActors: Actor[];
  loading: boolean;
  fetchAgents: () => Promise<void>;
  createAgent: (name: string) => Promise<void>;
}

export const useActorsStore = create<ActorsState>((set) => ({
  agents: [],
  allActors: [],
  loading: false,

  fetchAgents: async () => {
    set({ loading: true });
    const [agents, allActors] = await Promise.all([
      getActors({ type: "agent" }),
      getActors(),
    ]);
    set({ agents, allActors, loading: false });
  },

  createAgent: async (name: string) => {
    await createActor({ name, type: "agent", role: "developer" });
    const agents = await getActors({ type: "agent" });
    set({ agents });
  },
}));
