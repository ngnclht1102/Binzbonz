"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getProjects, getActors, type Project, type Actor } from "@/lib/api";

const STATUS_DOT: Record<string, string> = {
  idle: "bg-gray-500",
  working: "bg-green-400 animate-pulse",
  compacting: "bg-yellow-400",
};

const PROJECT_STATUS_DOT: Record<string, string> = {
  analysing: "bg-yellow-400",
  paused: "bg-gray-400",
  active: "bg-green-400",
  completed: "bg-blue-400",
};

export default function Sidebar() {
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Actor[]>([]);

  useEffect(() => {
    const fetch = () => {
      getProjects().then(setProjects).catch(() => {});
      getActors({ type: "agent" }).then(setAgents).catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, 10000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 overflow-auto">
      <div className="p-4">
        <Link href="/projects" className="text-lg font-bold tracking-tight">
          Binzbonz
        </Link>
      </div>

      <nav className="flex-1 px-2 pb-4 flex flex-col gap-4 text-sm">
        {/* Projects */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <Link href="/projects" className="text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300">
              Projects
            </Link>
            <Link
              href="/projects/new"
              className="text-gray-500 hover:text-white text-xs"
              title="New project"
            >
              +
            </Link>
          </div>
          <div className="flex flex-col gap-0.5">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors truncate ${
                  isActive(`/projects/${p.id}`)
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PROJECT_STATUS_DOT[p.status] ?? "bg-gray-500"}`} />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
            {projects.length === 0 && (
              <p className="px-2 text-xs text-gray-600">No projects</p>
            )}
          </div>
        </div>

        {/* Agents */}
        <div>
          <Link href="/agents" className="block px-2 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-300">
            Agents
          </Link>
          <div className="flex flex-col gap-0.5">
            {agents.map((a) => (
              <Link
                key={a.id}
                href={`/agents/${a.id}`}
                className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors truncate ${
                  isActive(`/agents/${a.id}`)
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[a.status] ?? "bg-gray-500"}`} />
                <span className="truncate">{a.name}</span>
                {a.status === "working" && (
                  <span className="text-[10px] text-green-400 shrink-0">working</span>
                )}
              </Link>
            ))}
            {agents.length === 0 && (
              <p className="px-2 text-xs text-gray-600">No agents</p>
            )}
          </div>
        </div>
      </nav>
    </aside>
  );
}
