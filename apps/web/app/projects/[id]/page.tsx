"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useProjectsStore } from "@/lib/stores/projects-store";
import { useTasksStore } from "@/lib/stores/tasks-store";
import { useEventsStore } from "@/lib/stores/events-store";
import { useActorsStore } from "@/lib/stores/actors-store";
import MentionInput from "@/components/mention-input";
import {
  ensureDefaultHierarchy,
  ensureMvp,
  ensureSprint,
  ensureEpic,
  ensureFeature,
  createTask,
  createSubtask,
  createMvp,
  createSprint,
  createEpic,
  createFeature,
  getProjectMvps,
  getMvpSprints,
  getSprintEpics,
  getEpicFeatures,
  updateTask as apiUpdateTask,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
  type Task,
  type Comment,
  type Actor,
  type Mvp,
  type Sprint,
  type Epic,
  type Feature,
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

const COLUMNS = ["backlog", "assigned", "in_progress", "blocked", "review_request", "done", "cancelled"];

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-800 border border-gray-700 rounded p-3 hover:border-gray-500 transition-colors"
    >
      <p className="font-medium text-sm truncate">{task.title}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-gray-400">
          {task.assigned_agent?.name ?? "Unassigned"}
        </span>
        {task.subtasks?.length > 0 && (
          <span className="text-xs text-gray-500">
            {task.subtasks.length} subtask{task.subtasks.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </button>
  );
}

type TicketType = "mvp" | "sprint" | "epic" | "feature" | "task" | "subtask";

const TICKET_TYPES: { value: TicketType; label: string }[] = [
  { value: "mvp", label: "MVP" },
  { value: "sprint", label: "Sprint" },
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Task" },
  { value: "subtask", label: "Subtask" },
];

interface ParentOption { id: string; label: string; }

function NewTicketDialog({
  projectId,
  tasks,
  onCreated,
  onClose,
}: {
  projectId: string;
  tasks: Task[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [ticketType, setTicketType] = useState<TicketType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [parents, setParents] = useState<ParentOption[]>([]);
  const [loadingParents, setLoadingParents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load parent options when ticket type changes
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingParents(true);
      setParentId("");
      const opts: ParentOption[] = [];
      try {
        if (ticketType === "mvp") {
          // MVPs have no selectable parent — they go under the project
        } else if (ticketType === "sprint") {
          const mvps = await getProjectMvps(projectId);
          mvps.forEach((m) => opts.push({ id: m.id, label: `MVP: ${m.title}` }));
        } else if (ticketType === "epic") {
          const mvps = await getProjectMvps(projectId);
          for (const m of mvps) {
            const sprints = await getMvpSprints(m.id);
            sprints.forEach((s) => opts.push({ id: s.id, label: `Sprint: ${s.title} (${m.title})` }));
          }
        } else if (ticketType === "feature") {
          const mvps = await getProjectMvps(projectId);
          for (const m of mvps) {
            const sprints = await getMvpSprints(m.id);
            for (const s of sprints) {
              const epics = await getSprintEpics(s.id);
              epics.forEach((e) => opts.push({ id: e.id, label: `Epic: ${e.title} (${s.title})` }));
            }
          }
        } else if (ticketType === "task") {
          const mvps = await getProjectMvps(projectId);
          for (const m of mvps) {
            const sprints = await getMvpSprints(m.id);
            for (const s of sprints) {
              const epics = await getSprintEpics(s.id);
              for (const e of epics) {
                const features = await getEpicFeatures(e.id);
                features.forEach((f) => opts.push({ id: f.id, label: `Feature: ${f.title} (${e.title})` }));
              }
            }
          }
        } else if (ticketType === "subtask") {
          tasks
            .filter((t) => !t.parent_task_id)
            .forEach((t) => opts.push({ id: t.id, label: `Task: ${t.title}` }));
        }
      } catch {
        // ignore
      }
      if (!cancelled) {
        setParents(opts);
        if (opts.length > 0) setParentId(opts[0].id);
        setLoadingParents(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [ticketType, projectId, tasks]);

  const needsParent = ticketType !== "mvp";

  const handleSubmit = async () => {
    if (!title.trim()) { setError("Title is required"); return; }
    if (ticketType === "subtask" && !parentId) {
      setError("Select a parent task for subtasks");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const data = { title: title.trim(), description: description.trim() || undefined };
      if (ticketType === "mvp") {
        await createMvp(projectId, data);
      } else if (ticketType === "sprint") {
        const pid = parentId || await ensureMvp(projectId);
        await createSprint(pid, data);
      } else if (ticketType === "epic") {
        const pid = parentId || await ensureSprint(projectId);
        await createEpic(pid, data);
      } else if (ticketType === "feature") {
        const pid = parentId || await ensureEpic(projectId);
        await createFeature(pid, data);
      } else if (ticketType === "task") {
        const pid = parentId || await ensureFeature(projectId);
        await createTask(pid, data);
      } else if (ticketType === "subtask") {
        await createSubtask(parentId, data);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setSubmitting(false);
    }
  };

  const parentLabel = ticketType === "sprint" ? "Parent MVP"
    : ticketType === "epic" ? "Parent Sprint"
    : ticketType === "feature" ? "Parent Epic"
    : ticketType === "task" ? "Parent Feature"
    : ticketType === "subtask" ? "Parent Task"
    : "";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <h3 className="font-bold text-lg mb-4">New Ticket</h3>
        <div className="flex flex-col gap-3">
          {/* Ticket Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Type</label>
            <select
              value={ticketType}
              onChange={(e) => setTicketType(e.target.value as TicketType)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
            >
              {TICKET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Parent Selection (optional — auto-creates if empty) */}
          {needsParent && ticketType !== "subtask" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                {parentLabel} <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              {loadingParents ? (
                <p className="text-xs text-gray-500">Loading...</p>
              ) : parents.length === 0 ? (
                <p className="text-xs text-gray-400">
                  No existing {parentLabel.replace("Parent ", "").toLowerCase()}s — one will be auto-created.
                </p>
              ) : (
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="">Auto (create default)</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {/* Subtask MUST have a parent */}
          {ticketType === "subtask" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">{parentLabel}</label>
              {parents.length === 0 ? (
                <p className="text-xs text-red-400">No tasks exist yet. Create a task first.</p>
              ) : (
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
                >
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="px-3 py-1.5 bg-gray-700 rounded text-sm">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ALL_TASK_STATUSES = ["backlog", "assigned", "in_progress", "blocked", "review_request", "done", "cancelled"];

function TaskDetail({
  task,
  comments,
  loading,
  agents,
  projectId,
  onClose,
  onPostComment,
  onAssign,
  onStatusChange,
}: {
  task: Task;
  comments: Comment[];
  loading: boolean;
  agents: Actor[];
  projectId: string;
  onClose: () => void;
  onPostComment: (body: string) => void;
  onAssign: (agentId: string | null) => void;
  onStatusChange: (status: string) => void;
}) {
  const [commentBody, setCommentBody] = useState("");
  const [statusError, setStatusError] = useState("");
  const agentActors = agents.filter((a) => a.type === "agent");
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const prevCommentsLen = useRef(comments.length);

  // Auto-scroll only when NEW comments arrive
  useEffect(() => {
    if (comments.length > prevCommentsLen.current) {
      commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCommentsLen.current = comments.length;
  }, [comments.length]);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-800 z-50 flex flex-col">
      {/* Header — fixed */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
        <h3 className="font-bold text-lg truncate">{task.title}</h3>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/projects/${projectId}/tasks/${task.id}`}
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto p-4">
        {/* Status */}
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Status</h4>
          <select
            value={task.status}
            onChange={async (e) => {
              setStatusError("");
              try {
                onStatusChange(e.target.value);
              } catch (err) {
                setStatusError(err instanceof Error ? err.message : "Failed");
              }
            }}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
          >
            {ALL_TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
          {statusError && <p className="text-red-400 text-xs mt-1">{statusError}</p>}
        </div>

        {/* Agent Assignment */}
        <div className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Assigned Agent</h4>
          <select
            value={task.assigned_agent_id ?? ""}
            onChange={(e) => onAssign(e.target.value || null)}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
          >
            <option value="">Unassigned</option>
            {agentActors.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
            ))}
          </select>
        </div>

        {task.description && (
          <p className="text-sm text-gray-300 mb-4">{task.description}</p>
        )}

        {task.subtasks?.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Subtasks</h4>
            {task.subtasks.map((s) => (
              <div key={s.id} className="text-sm text-gray-300 py-1">{s.title}</div>
            ))}
          </div>
        )}

        <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
          Comments {loading ? "(loading...)" : `(${comments.length})`}
        </h4>
        <div className="flex flex-col gap-2">
          {comments.map((c) => (
            <div key={c.id} className="bg-gray-800 rounded p-2 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-200">{c.actor?.name ?? "unknown"}</span>
                <span className="text-xs text-gray-500">
                  {new Date(c.created_at).toLocaleTimeString()}
                </span>
                <span className="text-xs text-gray-600">{c.comment_type}</span>
              </div>
              <p className="text-gray-300 whitespace-pre-wrap">
                {c.body.split(/(@[\w-]+)/g).map((part, i) =>
                  part.startsWith("@") ? (
                    <span key={i} className="text-blue-400 font-medium">{part}</span>
                  ) : (
                    part
                  ),
                )}
              </p>
            </div>
          ))}
          <div ref={commentsEndRef} />
        </div>
      </div>

      {/* Comment input — fixed at bottom */}
      <div className="p-4 border-t border-gray-800 shrink-0 flex gap-2">
        <MentionInput
          value={commentBody}
          onChange={setCommentBody}
          actors={agents}
          placeholder="Write a comment..."
          className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
          onSubmit={() => {
            if (commentBody.trim()) {
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

function DeleteProjectDialog({
  projectName,
  onConfirm,
  onClose,
}: {
  projectName: string;
  onConfirm: (deleteFiles: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(deleteFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setSubmitting(false);
    }
  };

  const canConfirm = confirmText === projectName && !submitting;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <h3 className="font-bold text-lg mb-2">Delete Project</h3>
        <p className="text-sm text-gray-300 mb-4">
          This will permanently delete <span className="font-semibold text-white">{projectName}</span> and
          all its MVPs, sprints, epics, features, tasks, comments, and wake events. This cannot be undone.
        </p>

        <label className="flex items-start gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm text-gray-300">
            Also delete the workspace files on disk
            <span className="block text-xs text-gray-500">
              (the entire <code className="text-gray-400">repo_path</code> directory will be removed recursively)
            </span>
          </span>
        </label>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">
            Type <span className="text-gray-300 font-mono">{projectName}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-red-500"
            autoFocus
          />
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm font-medium disabled:bg-gray-700 disabled:text-gray-500"
          >
            {submitting ? "Deleting..." : "Delete Project"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const id = params.id as string;
  const { activeProject, loading: projectLoading, fetchProject } = useProjectsStore();
  const { tasks, loading: tasksLoading, fetchTasks, selectedTaskId, selectTask, comments, commentsLoading, postComment } = useTasksStore();
  const { connect, disconnect, onEvent } = useEventsStore();
  const { allActors: agents, fetchAgents } = useActorsStore();
  const [showNewTask, setShowNewTask] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    fetchProject(id);
    fetchTasks(id);
    fetchAgents();
    connect();
    return () => disconnect();
  }, [id, fetchProject, fetchTasks, fetchAgents, connect, disconnect]);

  useEffect(() => {
    const unsub1 = onEvent("task_change", () => fetchTasks(id));
    const unsub2 = onEvent("comment_change", () => {
      if (selectedTaskId) selectTask(selectedTaskId);
    });
    return () => { unsub1(); unsub2(); };
  }, [id, onEvent, fetchTasks, selectedTaskId, selectTask]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  if (projectLoading || !activeProject) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  const tabs = [
    { label: "Board", href: `/projects/${id}` },
    { label: "Tree", href: `/projects/${id}/tree` },
    { label: "Agents", href: `/projects/${id}/agents` },
    { label: "Files", href: `/projects/${id}/files` },
  ];

  const tasksByStatus = COLUMNS.map((status) => ({
    status,
    tasks: tasks.filter((t) => t.status === status && !t.parent_task_id),
  }));

  const handleAssign = async (agentId: string | null) => {
    if (!selectedTask) return;
    await apiUpdateTask(selectedTask.id, {
      assigned_agent_id: agentId,
    } as Partial<Task>);
    fetchTasks(id);
    selectTask(selectedTask.id);
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">{activeProject.name}</h1>
          <select
            value={activeProject.status}
            onChange={async (e) => {
              try {
                await apiUpdateProject(id, { status: e.target.value });
                fetchProject(id);
              } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to update status");
              }
            }}
            className={`text-xs px-2 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none ${STATUS_COLORS[activeProject.status] ?? "bg-gray-700"}`}
          >
            <option value="analysing">analysing</option>
            <option value="paused">paused</option>
            <option value="active">active</option>
            <option value="completed">completed</option>
          </select>
          <button
            onClick={() => setShowDelete(true)}
            className="ml-auto text-xs px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
            title="Delete project"
          >
            Delete
          </button>
        </div>
        <p className="text-gray-400 text-sm">{activeProject.brief}</p>
      </div>

      <div className="flex items-center justify-between border-b border-gray-800 mb-6">
        <div className="flex gap-1">
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
        <button
          onClick={() => setShowNewTask(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors mb-1"
        >
          + New Task
        </button>
      </div>

      {tasksLoading ? (
        <p className="text-gray-400">Loading tasks...</p>
      ) : tasks.length === 0 ? (
        <p className="text-gray-500">No tasks yet. Click "+ New Task" to create one.</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {tasksByStatus.map(({ status, tasks: columnTasks }) => (
            <div key={status} className="flex-shrink-0 w-56">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${TASK_STATUS_COLORS[status] ?? ""}`}>
                  {status.replace("_", " ")}
                </span>
                <span className="text-xs text-gray-500">({columnTasks.length})</span>
              </div>
              <div className="flex flex-col gap-2">
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onClick={() => selectTask(task.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewTask && (
        <NewTicketDialog
          projectId={id}
          tasks={tasks}
          onCreated={() => fetchTasks(id)}
          onClose={() => setShowNewTask(false)}
        />
      )}

      {showDelete && (
        <DeleteProjectDialog
          projectName={activeProject.name}
          onConfirm={async (deleteFiles) => {
            await apiDeleteProject(id, deleteFiles);
            router.push("/projects");
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          comments={comments}
          loading={commentsLoading}
          agents={agents}
          projectId={id}
          onClose={() => selectTask(null)}
          onAssign={handleAssign}
          onStatusChange={async (status) => {
            try {
              await apiUpdateTask(selectedTask.id, { status } as Partial<Task>);
              fetchTasks(id);
              selectTask(selectedTask.id);
            } catch (err) {
              alert(err instanceof Error ? err.message : "Failed to update status");
            }
          }}
          onPostComment={(body) => {
            const username = typeof window !== "undefined" ? localStorage.getItem("username") ?? "brian" : "brian";
            const actor = agents.find((a) => a.name === username) ?? agents.find((a) => a.name === "brian");
            if (actor) {
              void postComment(selectedTask.id, actor.id, body, "update");
            }
          }}
        />
      )}
    </div>
  );
}
