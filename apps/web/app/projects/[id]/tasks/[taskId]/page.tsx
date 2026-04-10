"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getTask,
  getTaskComments,
  createTaskComment,
  updateTask as apiUpdateTask,
  getActors,
  type Task,
  type Comment,
  type Actor,
} from "@/lib/api";
import { useEventsStore } from "@/lib/stores/events-store";

const TASK_STATUS_COLORS: Record<string, string> = {
  backlog: "bg-gray-600/30 text-gray-400",
  assigned: "bg-purple-500/20 text-purple-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  blocked: "bg-red-500/20 text-red-400",
  review_request: "bg-orange-500/20 text-orange-400",
  done: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/30 text-red-300",
};

const ALL_TASK_STATUSES = ["backlog", "assigned", "in_progress", "blocked", "review_request", "done", "cancelled"];

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const taskId = params.taskId as string;
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Actor[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [loading, setLoading] = useState(true);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const prevCommentsLen = useRef(0);
  const { connect, disconnect, onEvent } = useEventsStore();

  const fetchData = async () => {
    try {
      const [t, c, a] = await Promise.all([
        getTask(taskId),
        getTaskComments(taskId),
        getActors(),
      ]);
      setTask(t);
      setComments(c);
      setAgents(a);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    connect();
    return () => disconnect();
  }, [taskId]);

  useEffect(() => {
    const unsub1 = onEvent("comment_change", async () => {
      const c = await getTaskComments(taskId);
      setComments(c);
    });
    const unsub2 = onEvent("task_change", async () => {
      const t = await getTask(taskId);
      setTask(t);
    });
    return () => { unsub1(); unsub2(); };
  }, [taskId, onEvent]);

  // Auto-scroll to bottom only when NEW comments arrive
  useEffect(() => {
    if (comments.length > prevCommentsLen.current) {
      commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCommentsLen.current = comments.length;
  }, [comments.length]);

  const handleAssign = async (agentId: string | null) => {
    await apiUpdateTask(taskId, { assigned_agent_id: agentId } as Partial<Task>);
    fetchData();
  };

  const handleStatusChange = async (status: string) => {
    try {
      await apiUpdateTask(taskId, { status } as Partial<Task>);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  const handlePostComment = async (body: string) => {
    const brian = agents.find((a) => a.name === (typeof window !== "undefined" ? localStorage.getItem("username") ?? "brian" : "brian")) ?? agents.find((a) => a.name === "brian");
    if (brian) {
      await createTaskComment(taskId, { actor_id: brian.id, body, comment_type: "update" });
      const c = await getTaskComments(taskId);
      setComments(c);
    }
  };

  if (loading || !task) return <div className="p-8 text-gray-400">Loading...</div>;

  const agentActors = agents.filter((a) => a.type === "agent");

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Back */}
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        className="text-sm text-gray-400 hover:text-gray-200 mb-4 inline-block"
      >
        ← Back to board
      </button>

      {/* Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        <h1 className="text-xl font-bold mb-4">{task.title}</h1>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Status */}
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Status</h4>
            <select
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
            >
              {ALL_TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </select>
          </div>

          {/* Agent */}
          <div>
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
        </div>

        {task.description && (
          <p className="text-sm text-gray-300">{task.description}</p>
        )}

        {task.subtasks?.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Subtasks</h4>
            {task.subtasks.map((s) => (
              <div key={s.id} className="text-sm text-gray-300 py-1 flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${TASK_STATUS_COLORS[s.status] ?? ""}`}>{s.status}</span>
                {s.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase mb-4">
          Comments ({comments.length})
        </h2>

        <div className="flex flex-col gap-3 max-h-[60vh] overflow-auto" id="comments-scroll">
          {comments.map((c) => (
            <div key={c.id} className="bg-gray-800 rounded p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-200">{c.actor?.name ?? "unknown"}</span>
                <span className="text-xs text-gray-500">
                  {new Date(c.created_at).toLocaleString()}
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

        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Write a comment..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && commentBody.trim()) {
                handlePostComment(commentBody.trim());
                setCommentBody("");
              }
            }}
          />
          <button
            onClick={() => {
              if (commentBody.trim()) {
                handlePostComment(commentBody.trim());
                setCommentBody("");
              }
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
