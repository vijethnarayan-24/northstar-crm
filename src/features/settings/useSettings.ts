import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Color, ResetLinkDTO, SourceAdminDTO, StageAdminDTO, TagAdminDTO, WorkspaceDTO, WorkspaceUpdate } from "@crm/shared";
import { api } from "@/lib/api";

const keys = {
  sources: ["settings", "sources"] as const,
  stages: ["settings", "stages"] as const,
  tags: ["settings", "tags"] as const,
  workspace: ["workspace"] as const,
};

/** Settings feed lookups, lead lists, lead details and the board, so refresh them all after a change. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["settings"] }),
    qc.invalidateQueries({ queryKey: ["lookups"] }),
    qc.invalidateQueries({ queryKey: ["leads"] }),
    qc.invalidateQueries({ queryKey: ["pipeline"] }),
  ]);
}

/** Generic mutation that refreshes settings-derived data afterwards. */
function useSettingsMutation<TInput, TResult = unknown>(fn: (input: TInput) => Promise<TResult>, success: string) {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: fn, onSuccess: () => refresh(), meta: { success } });
}

export const useSourcesAdmin = () => useQuery({ queryKey: keys.sources, queryFn: async () => (await api.get<{ sources: SourceAdminDTO[] }>("/settings/sources")).sources });
export const useStagesAdmin = () => useQuery({ queryKey: keys.stages, queryFn: async () => (await api.get<{ stages: StageAdminDTO[] }>("/settings/stages")).stages });
export const useTagsAdmin = () => useQuery({ queryKey: keys.tags, queryFn: async () => (await api.get<{ tags: TagAdminDTO[] }>("/settings/tags")).tags });
export const useWorkspace = () => useQuery({ queryKey: keys.workspace, queryFn: async () => (await api.get<{ workspace: WorkspaceDTO }>("/workspace")).workspace, staleTime: 5 * 60_000 });

type NameColor = { name: string; color: Color };

export const useCreateSource = () => useSettingsMutation((input: NameColor) => api.post("/sources", input), "Source added");
export const useUpdateSource = () => useSettingsMutation(({ id, ...input }: Partial<NameColor> & { id: string; archived?: boolean }) => api.patch(`/sources/${id}`, input), "Source saved");
export const useDeleteSource = () => useSettingsMutation((id: string) => api.delete(`/sources/${id}`), "Source deleted");

export const useCreateStage = () => useSettingsMutation((input: NameColor) => api.post("/stages", input), "Stage added");
export const useUpdateStage = () => useSettingsMutation(({ id, ...input }: Partial<NameColor> & { id: string }) => api.patch(`/stages/${id}`, input), "Stage saved");
export const useRemoveStage = () => useSettingsMutation(({ id, moveToStageId }: { id: string; moveToStageId?: string }) => api.post(`/stages/${id}/remove`, { moveToStageId }), "Stage removed");

export const useCreateTag = () => useSettingsMutation((input: NameColor) => api.post("/tags", input), "Tag added");
export const useUpdateTag = () => useSettingsMutation(({ id, ...input }: Partial<NameColor> & { id: string }) => api.patch(`/tags/${id}`, input), "Tag saved");
export const useDeleteTag = () => useSettingsMutation((id: string) => api.delete(`/tags/${id}`), "Tag deleted");
export const useMergeTag = () => useSettingsMutation(({ id, intoId }: { id: string; intoId: string }) => api.post(`/tags/${id}/merge`, { intoId }), "Tags merged");

/** Reorder with an optimistic cache update so the list doesn't jump back while saving. */
export function useReorder(kind: "sources" | "stages") {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  const key = keys[kind];
  return useMutation({
    meta: { success: "New order saved" },
    mutationFn: (ids: string[]) => api.put<void>(`/${kind}/order`, { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ id: string }[]>(key);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        const reordered = ids.map((id) => byId.get(id)!).filter(Boolean);
        qc.setQueryData(key, [...reordered, ...previous.filter((item) => !ids.includes(item.id))]);
      }
      return { previous };
    },
    onError: (_e, _ids, ctx) => { if (ctx?.previous) qc.setQueryData(key, ctx.previous); },
    onSettled: () => refresh(),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Workspace settings saved" },
    mutationFn: async (input: WorkspaceUpdate) => (await api.patch<{ workspace: WorkspaceDTO }>("/workspace", input)).workspace,
    onSuccess: (ws) => {
      qc.setQueryData(keys.workspace, ws);
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export const useResetLink = () => useMutation({ meta: { success: "Reset link created" }, mutationFn: (userId: string) => api.post<ResetLinkDTO>(`/users/${userId}/reset-link`) });
