import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardDTO, DashboardQuery, FeedPageDTO, FeedQuery, GoalDTO, GoalUpdate } from "@crm/shared";
import { api } from "@/lib/api";
import { toQueryString } from "@/features/leads/useLeads";

export const useDashboard = (q: DashboardQuery) =>
  useQuery({ queryKey: ["dashboard", q], queryFn: () => api.get<DashboardDTO>(`/dashboard${toQueryString(q as never)}`), staleTime: 30_000 });

/** Feed pages, newest first, loaded with a time cursor. */
export const useFeed = (q: Omit<FeedQuery, "before">) =>
  useInfiniteQuery({
    queryKey: ["feed", q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<FeedPageDTO>(`/feed${toQueryString({ ...q, before: pageParam } as never)}`),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 60_000,
  });

export const useGoal = () => useQuery({ queryKey: ["goal"], queryFn: async () => (await api.get<{ goal: GoalDTO }>("/goal")).goal, staleTime: 60_000 });

export function useSetGoal() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Monthly goal saved" },
    mutationFn: async (input: GoalUpdate) => (await api.put<{ goal: GoalDTO }>("/goal", input)).goal,
    onSuccess: (goal) => qc.setQueryData(["goal"], goal),
  });
}
