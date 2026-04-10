"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { useTasksStore } from "@/lib/stores/tasks-store";
import { useEventsStore } from "@/lib/stores/events-store";
import { useActorsStore } from "@/lib/stores/actors-store";
import {
  getProjectMvps,
  getMvpSprints,
  getSprintEpics,
  getEpicFeatures,
  getFeatureTasks,
  getActors,
  updateTask as apiUpdateTask,
  type Task,
  type Comment,
  type Actor,
} from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  analysing: "bg-yellow-500/20 text-yellow-400",
  paused: "bg-gray-500/20 text-gray-400",
  active: "bg-green-500/20 text-green-400",
  completed: "bg-blue-500/20 text-blue-400",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  backlog: "bg-gray-600/30 text-gray-400",
  assigned: "bg-purple-500/20 text-purple-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  blocked: "bg-red-500/20 text-red-400",
  review_request: "bg-orange-500/20 text-orange-400",
  done: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/30 text-red-300",
};

const TYPE_BADGES: Record<string, string> = {
  mvp: "bg-purple-500/20 text-purple-400",
  sprint: "bg-blue-500/20 text-blue-400",
  epic: "bg-orange-500/20 text-orange-400",
  feature: "bg-green-500/20 text-green-400",
  task: "bg-gray-500/20 text-gray-400",
};

const STATUS_ICONS: Record<string, string> = {
  backlog: "○",
  assigned: "◐",
  in_progress: "◑",
  blocked: "⊘",
  review_request: "◎",
  done: "●",
  cancelled: "⊗",
};

interface TreeNode {
  id: string;
  type: "mvp" | "sprint" | "epic" | "feature" | "task";
  title: string;
  status?: string;
  agentName?: string | null;
  children: TreeNode[];
}

/** Derive a summary status from all descendant tasks */
function deriveStatus(node: TreeNode): string | undefined {
  if (node.type === "task") return node.status;
  const childStatuses = node.children.map(deriveStatus).filter(Boolean) as string[];
  if (childStatuses.length === 0) return undefined;
  if (childStatuses.every((s) => s === "done")) return "done";
  if (childStatuses.every((s) => s === "cancelled")) return "cancelled";
  if (childStatuses.every((s) => s === "done" || s === "cancelled")) return "done";
  if (childStatuses.some((s) => s === "blocked")) return "blocked";
  if (childStatuses.some((s) => s === "in_progress")) return "in_progress";
  if (childStatuses.some((s) => s === "review_request")) return "review_request";
  if (childStatuses.some((s) => s === "assigned")) return "assigned";
  return "backlog";
}

function matchesFilter(node: TreeNode, statusFilter: string, ownerFilter: string): boolean {
  // Check this node
  if (node.type === "task") {
    const statusOk = !statusFilter || node.status === statusFilter;
    const ownerOk = !ownerFilter || node.agentName === ownerFilter;
    if (statusOk && ownerOk) return true;
  }
  // Check children recursively
  return node.children.some((c) => matchesFilter(c, statusFilter, ownerFilter));
}

function TreeItem({
  node,
  depth = 0,
  statusFilter,
  ownerFilter,
  projectId,
  onTaskClick,
}: {
  node: TreeNode;
  depth?: number;
  statusFilter: string;
  ownerFilter: string;
  projectId: string;
  onTaskClick: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  // Filter: hide nodes that don't match
  if (statusFilter || ownerFilter) {
    if (!matchesFilter(node, statusFilter, ownerFilter)) return null;
  }

  const isTask = node.type === "task";
  const displayStatus = isTask ? node.status : deriveStatus(node);

  return (
    <div style={{ paddingLeft: `${depth * 16}px` }}>
      <div className="flex items-center gap-2 py-1 hover:bg-gray-800/50 rounded px-2 text-sm">
        <button
          onClick={() => setOpen(!open)}
          className="text-gray-500 w-4 text-center shrink-0"
        >
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </button>
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGES[node.type] ?? ""}`}>
          {node.type}
        </span>
        {displayStatus && (
          <span className={`shrink-0 ${TASK_STATUS_COLORS[displayStatus]?.split(' ')[1] ?? 'text-gray-400'}`} title={displayStatus}>
            {STATUS_ICONS[displayStatus] ?? "○"}
          </span>
        )}
        {isTask ? (
          <button
            onClick={() => onTaskClick(node.id)}
            className="text-gray-200 hover:text-blue-400 truncate text-left"
          >
            {node.title}
          </button>
        ) : (
          <span className="text-gray-200 truncate">{node.title}</span>
        )}
        {isTask && node.status && (
          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_COLORS[node.status] ?? ""}`}>
            {node.status.replace("_", " ")}
          </span>
        )}
        {isTask && node.agentName && (
          <span className="text-xs text-gray-500 shrink-0">
            {node.agentName}
          </span>
        )}
      </div>
      {open &&
        node.children.map((child) => (
          <TreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            statusFilter={statusFilter}
            ownerFilter={ownerFilter}
            onTaskClick={onTaskClick}
            projectId={projectId}
          />
        ))}
    </div>
  );
}

export default function TreeViewPage() {
  const params = useParams();
  const id = params.id as string;
  const { activeProject, fetchProject } = useProjectsStore();
  const { selectedTaskId, selectTask, comments, commentsLoading, postComment } = useTasksStore();
  const { connect, disconnect, onEvent } = useEventsStore();
  const { allActors: allAgents, fetchAgents } = useActorsStore();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [agents, setAgents] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const pathname = `/projects/${id}/tree`;

  // Collect the selected task from the tree
  function findTask(nodes: TreeNode[], taskId: string): TreeNode | null {
    for (const n of nodes) {
      if (n.id === taskId && n.type === "task") return n;
      const found = findTask(n.children, taskId);
      if (found) return found;
    }
    return null;
  }

  useEffect(() => {
    fetchProject(id);
    fetchAgents();
    getActors({ type: "agent" }).then(setAgents);
    connect();
    return () => disconnect();
  }, [id, fetchProject, fetchAgents, connect, disconnect]);

  useEffect(() => {
    const unsub = onEvent("comment_change", () => {
      if (selectedTaskId) selectTask(selectedTaskId);
    });
    return unsub;
  }, [onEvent, selectedTaskId, selectTask]);

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
                children: tasks.map((t: Task) => ({
                  id: t.id,
                  type: "task" as const,
                  title: t.title,
                  status: t.status,
                  agentName: t.assigned_agent?.name ?? null,
                  children: (t.subtasks ?? []).map((s: Task) => ({
                    id: s.id,
                    type: "task" as const,
                    title: s.title,
                    status: s.status,
                    agentName: s.assigned_agent?.name ?? null,
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

  // Collect all unique statuses and owners from tree
  const allStatuses = new Set<string>();
  const allOwners = new Set<string>();
  function collectFilters(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type === "task" && n.status) allStatuses.add(n.status);
      if (n.type === "task" && n.agentName) allOwners.add(n.agentName);
      collectFilters(n.children);
    }
  }
  collectFilters(tree);

  const tabs = [
    { label: "Board", href: `/projects/${id}` },
    { label: "Tree", href: `/projects/${id}/tree` },
    { label: "Agents", href: `/projects/${id}/agents` },
    { label: "Files", href: `/projects/${id}/files` },
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

      {/* Filters */}
      {tree.length > 0 && (
        <div className="flex gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
          >
            <option value="">All statuses</option>
            {[...allStatuses].sort().map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
          >
            <option value="">All owners</option>
            {[...allOwners].sort().map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {(statusFilter || ownerFilter) && (
            <button
              onClick={() => { setStatusFilter(""); setOwnerFilter(""); }}
              className="text-xs text-gray-400 hover:text-white px-2"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400">Loading hierarchy...</p>
      ) : tree.length === 0 ? (
        <p className="text-gray-500">No hierarchy yet. Create MVPs, Sprints, Epics, and Features via the API.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          {tree.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              statusFilter={statusFilter}
              ownerFilter={ownerFilter}
              projectId={id}
              onTaskClick={(taskId) => selectTask(taskId)}
            />
          ))}
        </div>
      )}

      {/* Task sidebar */}
      {selectedTaskId && (
        <TaskSidebar
          taskId={selectedTaskId}
          projectId={id}
          comments={comments}
          commentsLoading={commentsLoading}
          agents={allAgents}
          onClose={() => selectTask(null)}
          onPostComment={(body) => {
            const username = typeof window !== "undefined" ? localStorage.getItem("username") ?? "brian" : "brian";
            const actor = allAgents.find((a) => a.name === username) ?? allAgents.find((a) => a.name === "brian");
            if (actor) postComment(selectedTaskId, actor.id, body, "update");
          }}
        />
      )}
    </div>
  );
}

// Sidebar component for tree view — fetches its own task data
function TaskSidebar({
  taskId,
  projectId,
  comments,
  commentsLoading,
  agents,
  onClose,
  onPostComment,
}: {
  taskId: string;
  projectId: string;
  comments: Comment[];
  commentsLoading: boolean;
  agents: Actor[];
  onClose: () => void;
  onPostComment: (body: string) => void;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const prevCommentsLen = useRef(comments.length);

  useEffect(() => {
    import("@/lib/api").then(({ getTask }) => {
      getTask(taskId).then(setTask);
    });
  }, [taskId]);

  useEffect(() => {
    if (comments.length > prevCommentsLen.current) {
      commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCommentsLen.current = comments.length;
  }, [comments.length]);

  const agentActors = agents.filter((a) => a.type === "agent");

  const handleAssign = async (agentId: string | null) => {
    await apiUpdateTask(taskId, { assigned_agent_id: agentId } as Partial<Task>);
    const { getTask } = await import("@/lib/api");
    setTask(await getTask(taskId));
  };

  const handleStatusChange = async (status: string) => {
    try {
      await apiUpdateTask(taskId, { status } as Partial<Task>);
      const { getTask } = await import("@/lib/api");
      setTask(await getTask(taskId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  if (!task) return null;

  const ALL_STATUSES = ["backlog", "assigned", "in_progress", "blocked", "review_request", "done", "cancelled"];

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-800 z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
        <h3 className="font-bold text-lg truncate">{task.title}</h3>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/projects/${projectId}/tasks/${taskId}`}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 text-sm"
            title="Open full page"
          >
            ⛶
          </Link>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 text-xl">
            &times;
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Status</h4>
          <select
            value={task.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Assigned Agent</h4>
          <select
            value={task.assigned_agent_id ?? ""}
            onChange={(e) => handleAssign(e.target.value || null)}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
          >
            <option value="">Unassigned</option>
            {agentActors.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
            ))}
          </select>
        </div>

        {task.description && <p className="text-sm text-gray-300 mb-4">{task.description}</p>}

        <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
          Comments {commentsLoading ? "(loading...)" : `(${comments.length})`}
        </h4>
        <div className="flex flex-col gap-2">
          {comments.map((c) => (
            <div key={c.id} className="bg-gray-800 rounded p-2 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-200">{c.actor?.name ?? "unknown"}</span>
                <span className="text-xs text-gray-500">{new Date(c.created_at).toLocaleTimeString()}</span>
                <span className="text-xs text-gray-600">{c.comment_type}</span>
              </div>
              <p className="text-gray-300 whitespace-pre-wrap">
                {c.body.split(/(@[\w-]+)/g).map((part, i) =>
                  part.startsWith("@") ? <span key={i} className="text-blue-400 font-medium">{part}</span> : part
                )}
              </p>
            </div>
          ))}
          <div ref={commentsEndRef} />
        </div>
      </div>

      <div className="p-4 border-t border-gray-800 shrink-0 flex gap-2">
        <input
          type="text"
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="Write a comment..."
          className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
          onKeyDown={(e) => {
            if (e.key === "Enter" && commentBody.trim()) {
              onPostComment(commentBody.trim());
              setCommentBody("");
            }
          }}
        />
        <button
          onClick={() => {
            if (commentBody.trim()) {
              onPostComment(commentBody.trim());
              setCommentBody("");
            }
          }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}
