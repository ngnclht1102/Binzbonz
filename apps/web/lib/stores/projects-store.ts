"use client";
import { create } from "zustand";
import { getProjects, getProject, type Project } from "../api";

interface ProjectsState {
  projects: Project[];
  activeProject: Project | null;
  loading: boolean;
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  activeProject: null,
  loading: false,

  fetchProjects: async () => {
    set({ loading: true });
    const projects = await getProjects();
    set({ projects, loading: false });
  },

  fetchProject: async (id: string) => {
    set({ loading: true });
    const project = await getProject(id);
    set({ activeProject: project, loading: false });
  },
}));
