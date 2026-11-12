import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ActivityDTO, ActivityInput, ActivityUpdate, MeSummaryDTO, TaskDTO, TaskInput, TaskListQuery, TaskStatsDTO, TaskUpdate } from "@crm/shared";
import { api } from "@/lib/api";
import { leadKeys, toQueryString } from "@/features/leads/useLeads";

export const taskKeys = {
  all: ["tasks"] as const,
  list: (q: TaskListQuery) => ["tasks", "list", q] as const,
  stats: (assigneeId?: string) => ["tasks", "stats", assigneeId ?? "all"] as const,
  summary: ["me-summary"] as const,
};

export const useTasks = (q: TaskListQuery) =>
  useQuery({ queryKey: taskKeys.list(q), queryFn: async () => (await api.get<{ tasks: TaskDTO[] }>(`/tasks${toQueryString(q as never)}`)).tasks });

export const useTaskStats = (assigneeId?: string) =>
  useQuery({ queryKey: taskKeys.stats(assigneeId), queryFn: async () => (await api.get<{ stats: TaskStatsDTO }>(`/tasks/stats${assigneeId ? `?assigneeId=${assigneeId}` : ""}`)).stats });

/** Sidebar counters; refreshed every minute so overdue counts tick over without a reload. */
export const useMeSummary = () =>
  useQuery({ queryKey: taskKeys.summary, queryFn: () => api.get<MeSummaryDTO>("/me/summary"), refetchInterval: 60_000 });

/** Tasks show up in task lists, stats, the sidebar badge, and a lead's Tasks tab and counts. */
function refreshAfterTaskChange(qc: QueryClient, leadId?: string | null) {
  qc.invalidateQueries({ queryKey: taskKeys.all });
  qc.invalidateQueries({ queryKey: taskKeys.summary });
  qc.invalidateQueries({ queryKey: ["calendar"] });
  if (leadId) {
    qc.invalidateQueries({ queryKey: leadKeys.detail(leadId) });
    qc.invalidateQueries({ queryKey: leadKeys.lists() });
  }
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Task added" },
    mutationFn: async (input: TaskInput) => (await api.post<{ task: TaskDTO }>("/tasks", input)).task,
    onSuccess: (task) => refreshAfterTaskChange(qc, task.lead?.id),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Task saved" },
    mutationFn: async ({ id, ...input }: TaskUpdate & { id: string }) => (await api.patch<{ task: TaskDTO }>(`/tasks/${id}`, input)).task,
    onSuccess: (task) => refreshAfterTaskChange(qc, task.lead?.id),
  });
}

/** Checkbox toggle with an instant UI update; rolls back if the save fails. */
export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (task) => ((task as { completedAt: string | null }).completedAt ? "Task completed" : "Task reopened"), errorToast: true },
    mutationFn: async (task: TaskDTO) => (await api.patch<{ task: TaskDTO }>(`/tasks/${task.id}`, { completed: !task.completedAt })).task,
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: taskKeys.all });
      const snapshot = qc.getQueriesData<TaskDTO[]>({ queryKey: taskKeys.all });
      const tabKey = task.lead ? leadKeys.tab(task.lead.id, "tasks") : null;
      const tabSnapshot = tabKey ? qc.getQueryData<TaskDTO[]>(tabKey) : undefined;
      const flip = (list?: TaskDTO[]) => list?.map((t) => (t.id === task.id ? { ...t, completedAt: t.completedAt ? null : new Date().toISOString() } : t));
      qc.setQueriesData<TaskDTO[]>({ queryKey: ["tasks", "list"] }, flip);
      if (tabKey) qc.setQueryData<TaskDTO[]>(tabKey, flip);
      return { snapshot, tabKey, tabSnapshot };
    },
    onError: (_e, _task, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.tabKey) qc.setQueryData(ctx.tabKey, ctx.tabSnapshot);
    },
    onSettled: (_data, _e, task) => refreshAfterTaskChange(qc, task.lead?.id),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Task deleted", errorToast: true },
    mutationFn: (task: TaskDTO) => api.delete(`/tasks/${task.id}`),
    onSuccess: (_d, task) => refreshAfterTaskChange(qc, task.lead?.id),
  });
}

// ---------- Activities ----------
function refreshAfterActivity(qc: QueryClient, leadId: string) {
  qc.invalidateQueries({ queryKey: leadKeys.detail(leadId) }); // detail, timeline, tasks tab
  qc.invalidateQueries({ queryKey: leadKeys.lists() }); // "last activity" column
  qc.invalidateQueries({ queryKey: ["pipeline"] });
  qc.invalidateQueries({ queryKey: taskKeys.all });
  qc.invalidateQueries({ queryKey: taskKeys.summary });
  qc.invalidateQueries({ queryKey: ["calendar"] });
}

export function useLogActivity(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (res) => ((res as { task: unknown }).task ? "Activity logged and follow-up task created" : "Activity logged") },
    mutationFn: (input: ActivityInput) => api.post<{ activity: ActivityDTO; task: TaskDTO | null }>(`/leads/${leadId}/activities`, input),
    onSuccess: () => refreshAfterActivity(qc, leadId),
  });
}

export function useUpdateActivity(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Activity updated" },
    mutationFn: async ({ id, ...input }: ActivityUpdate & { id: string }) => (await api.patch<{ activity: ActivityDTO }>(`/activities/${id}`, input)).activity,
    onSuccess: () => refreshAfterActivity(qc, leadId),
  });
}

export function useDeleteActivity(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Activity deleted", errorToast: true },
    mutationFn: (id: string) => api.delete(`/activities/${id}`),
    onSuccess: () => refreshAfterActivity(qc, leadId),
  });
}
