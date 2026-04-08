"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useProjectsStore } from "@/lib/stores/projects-store";

const STATUS_COLORS: Record<string, string> = {
  analysing: "bg-yellow-500/20 text-yellow-400",
  paused: "bg-gray-500/20 text-gray-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-blue-500/20 text-blue-400",
};

export default function ProjectsPage() {
  const { projects, loading, fetchProjects } = useProjectsStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link
          href="/projects/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
        >
          New Project
        </Link>
      </div>

      {loading && <p className="text-gray-400">Loading...</p>}

      {!loading && projects.length === 0 && (
        <p className="text-gray-400">No projects yet.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold truncate">{p.name}</h2>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status] ?? "bg-gray-700 text-gray-300"}`}
              >
                {p.status}
              </span>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2">
              {p.brief ?? p.description ?? "No description"}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              {new Date(p.created_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
