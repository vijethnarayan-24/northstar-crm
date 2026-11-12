import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActivityDTO,
  DocumentDTO,
  LeadDetailDTO,
  LeadInput,
  LeadListItemDTO,
  LeadListQuery,
  TaskDTO,
  LeadUpdate,
  LookupsDTO,
  MoveLeadInput,
  Paginated,
  PipelineDTO,
  PipelineQuery,
  StageChangeDTO,
  LeadHistoryEntryDTO,
  TagCreateInput,
  TagRef,
} from "@crm/shared";
import { api } from "@/lib/api";

export const leadKeys = {
  all: ["leads"] as const,
  lists: () => [...leadKeys.all, "list"] as const,
  list: (q: LeadListQuery) => [...leadKeys.lists(), q] as const,
  detail: (id: string) => [...leadKeys.all, "detail", id] as const,
  tab: (id: string, tab: string) => [...leadKeys.all, "detail", id, tab] as const,
};
const LOOKUPS_KEY = ["lookups"] as const;

/** Serializes list params, repeating array keys (`?stageId=a&stageId=b`). */
export function toQueryString(q: LeadListQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const useLookups = () =>
  useQuery({ queryKey: LOOKUPS_KEY, queryFn: () => api.get<LookupsDTO>("/lookups"), staleTime: 5 * 60_000 });

export const useLeadList = (q: LeadListQuery, options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: leadKeys.list(q),
    queryFn: () => api.get<Paginated<LeadListItemDTO>>(`/leads${toQueryString(q)}`),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });

export const useLead = (id: string | undefined) =>
  useQuery({
    queryKey: leadKeys.detail(id ?? ""),
    queryFn: async () => (await api.get<{ lead: LeadDetailDTO }>(`/leads/${id}`)).lead,
    enabled: !!id,
  });

const useLeadTab = <T,>(id: string, tab: string, pick: (data: never) => T) =>
  useQuery({ queryKey: leadKeys.tab(id, tab), queryFn: async () => pick((await api.get(`/leads/${id}/${tab}`)) as never) });

export const useLeadActivities = (id: string) => useLeadTab<ActivityDTO[]>(id, "activities", (d: { activities: ActivityDTO[] }) => d.activities);
export const useLeadTasks = (id: string) => useLeadTab<TaskDTO[]>(id, "tasks", (d: { tasks: TaskDTO[] }) => d.tasks);
export const useLeadDocuments = (id: string) => useLeadTab<DocumentDTO[]>(id, "documents", (d: { documents: DocumentDTO[] }) => d.documents);
export const useStageHistory = (id: string) => useLeadTab<StageChangeDTO[]>(id, "stage-history", (d: { history: StageChangeDTO[] }) => d.history);
export const useLeadHistory = (id: string) => useLeadTab<LeadHistoryEntryDTO[]>(id, "history", (d: { history: LeadHistoryEntryDTO[] }) => d.history);

export const PIPELINE_KEY = ["pipeline"] as const;

export const usePipeline = (q: PipelineQuery) =>
  useQuery({
    queryKey: [...PIPELINE_KEY, q],
    queryFn: () => api.get<PipelineDTO>(`/pipeline${toQueryString(q as LeadListQuery)}`),
    placeholderData: keepPreviousData,
  });

/** Move used by the board, where the lead id varies per call. */
export function useBoardMove() {
  const refresh = useInvalidateLead();
  return useMutation({
    meta: { success: "Lead moved" },
    mutationFn: async ({ id, ...input }: MoveLeadInput & { id: string }) => (await api.post<{ lead: LeadDetailDTO }>(`/leads/${id}/move`, input)).lead,
    onSettled: (lead) => refresh(lead ?? undefined),
  });
}

/** After any lead change: refresh lists, the board, lookups (lead types) and the lead's own detail/tabs. */
function useInvalidateLead() {
  const qc = useQueryClient();
  return (lead?: LeadDetailDTO) => {
    if (lead) qc.setQueryData(leadKeys.detail(lead.id), lead);
    qc.invalidateQueries({ queryKey: leadKeys.lists() });
    qc.invalidateQueries({ queryKey: PIPELINE_KEY });
    qc.invalidateQueries({ queryKey: LOOKUPS_KEY });
    if (lead) qc.invalidateQueries({ queryKey: leadKeys.detail(lead.id), predicate: (q) => q.queryKey.length > 3 });
  };
}

export function useCreateLead() {
  const refresh = useInvalidateLead();
  return useMutation({
    meta: { success: (lead) => `Lead added: ${(lead as { fullName: string }).fullName}` },
    mutationFn: async (input: LeadInput) => (await api.post<{ lead: LeadDetailDTO }>("/leads", input)).lead,
    onSuccess: (lead) => refresh(lead),
  });
}

export function useUpdateLead(id: string) {
  const refresh = useInvalidateLead();
  return useMutation({
    meta: { success: "Lead saved" },
    mutationFn: async (input: LeadUpdate) => (await api.patch<{ lead: LeadDetailDTO }>(`/leads/${id}`, input)).lead,
    onSuccess: (lead) => refresh(lead),
  });
}

export function useMoveLead(id: string) {
  const refresh = useInvalidateLead();
  return useMutation({
    meta: { success: (lead) => `Moved to ${(lead as { stage: { name: string } }).stage.name}` },
    mutationFn: async (input: MoveLeadInput) => (await api.post<{ lead: LeadDetailDTO }>(`/leads/${id}/move`, input)).lead,
    onSuccess: (lead) => refresh(lead),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Lead deleted" },
    mutationFn: (id: string) => api.delete(`/leads/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: leadKeys.detail(id) });
      qc.invalidateQueries({ queryKey: leadKeys.lists() });
      qc.invalidateQueries({ queryKey: PIPELINE_KEY });
    },
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: (tag) => `Tag “${(tag as { name: string }).name}” created` },
    mutationFn: async (input: TagCreateInput) => (await api.post<{ tag: TagRef }>("/tags", input)).tag,
    onSuccess: () => qc.invalidateQueries({ queryKey: LOOKUPS_KEY }),
  });
}
