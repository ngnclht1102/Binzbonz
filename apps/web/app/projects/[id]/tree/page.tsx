"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectsStore } from "@/lib/stores/projects-store";
import {
  getProjectMvps,
  getMvpSprints,
  getSprintEpics,
  getEpicFeatures,
  getFeatureTasks,
  type Mvp,
  type Sprint,
  type Epic,
  type Feature,
  type Task,
} from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  analysing: "bg-yellow-500/20 text-yellow-400",
  paused: "bg-gray-500/20 text-gray-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-blue-500/20 text-blue-400",
};

interface TreeNode {
  id: string;
  type: "mvp" | "sprint" | "epic" | "feature" | "task";
  title: string;
  children: TreeNode[];
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const TYPE_BADGES: Record<string, string> = {
    mvp: "bg-purple-500/20 text-purple-400",
    sprint: "bg-blue-500/20 text-blue-400",
    epic: "bg-orange-500/20 text-orange-400",
    feature: "bg-green-500/20 text-green-400",
    task: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-1 hover:bg-gray-800/50 rounded px-2 w-full text-left text-sm"
      >
        <span className="text-gray-500 w-4 text-center">
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGES[node.type] ?? ""}`}>
          {node.type}
        </span>
        <span className="text-gray-200">{node.title}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeItem key={child.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export default function TreeViewPage() {
  const params = useParams();
  const id = params.id as string;
  const { activeProject, fetchProject } = useProjectsStore();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = `/projects/${id}/tree`;

  useEffect(() => {
    fetchProject(id);
  }, [id, fetchProject]);

  useEffect(() => {
    async function loadTree() {
      setLoading(true);
      const mvps = await getProjectMvps(id);
      const nodes: TreeNode[] = [];
      for (const mvp of mvps) {
        const sprints = await getMvpSprints(mvp.id);
        const sprintNodes: TreeNode[] = [];
        for (const sprint of sprints) {
          const epics = await getSprintEpics(sprint.id);
          const epicNodes: TreeNode[] = [];
          for (const epic of epics) {
            const features = await getEpicFeatures(epic.id);
            const featureNodes: TreeNode[] = [];
            for (const feature of features) {
              const tasks = await getFeatureTasks(feature.id);
              featureNodes.push({
                id: feature.id,
                type: "feature",
                title: feature.title,
                children: tasks.map((t) => ({
                  id: t.id,
                  type: "task" as const,
                  title: t.title,
                  children: (t.subtasks ?? []).map((s) => ({
                    id: s.id,
                    type: "task" as const,
                    title: s.title,
                    children: [],
                  })),
                })),
              });
            }
            epicNodes.push({ id: epic.id, type: "epic", title: epic.title, children: featureNodes });
          }
          sprintNodes.push({ id: sprint.id, type: "sprint", title: sprint.title, children: epicNodes });
        }
        nodes.push({ id: mvp.id, type: "mvp", title: mvp.title, children: sprintNodes });
      }
      setTree(nodes);
      setLoading(false);
    }
    loadTree();
  }, [id]);

  const tabs = [
    { label: "Board", href: `/projects/${id}` },
    { label: "Tree", href: `/projects/${id}/tree` },
    { label: "Agents", href: `/projects/${id}/agents` },
  ];

  return (
    <div className="p-8">
      {activeProject && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold">{activeProject.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[activeProject.status] ?? "bg-gray-700"}`}>
              {activeProject.status}
            </span>
          </div>
          <p className="text-gray-400 text-sm">{activeProject.brief}</p>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-800 mb-6">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              pathname === tab.href
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400">Loading hierarchy...</p>
      ) : tree.length === 0 ? (
        <p className="text-gray-500">No hierarchy yet. Create MVPs, Sprints, Epics, and Features via the API.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          {tree.map((node) => (
            <TreeItem key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}
