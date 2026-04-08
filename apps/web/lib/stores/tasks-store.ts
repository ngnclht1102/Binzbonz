"use client";
import { create } from "zustand";
import { getProjectTasks, getTaskComments, createTaskComment, type Task, type Comment } from "../api";

interface TasksState {
  tasks: Task[];
  loading: boolean;
  selectedTaskId: string | null;
  comments: Comment[];
  commentsLoading: boolean;
  fetchTasks: (projectId: string) => Promise<void>;
  selectTask: (taskId: string | null) => Promise<void>;
  postComment: (taskId: string, actorId: string, body: string, commentType?: string) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  selectedTaskId: null,
  comments: [],
  commentsLoading: false,

  fetchTasks: async (projectId: string) => {
    set({ loading: true });
    const tasks = await getProjectTasks(projectId);
    set({ tasks, loading: false });
  },

  selectTask: async (taskId: string | null) => {
    set({ selectedTaskId: taskId, comments: [] });
    if (taskId) {
      set({ commentsLoading: true });
      const comments = await getTaskComments(taskId);
      set({ comments, commentsLoading: false });
    }
  },

  postComment: async (taskId: string, actorId: string, body: string, commentType?: string) => {
    await createTaskComment(taskId, { actor_id: actorId, body, comment_type: commentType });
    const comments = await getTaskComments(taskId);
    set({ comments });
  },
}));
