import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CalendarItemDTO, CalendarQuery, ReportQuery, ReportsDTO } from "@crm/shared";
import { api, apiUrl } from "@/lib/api";
import { toQueryString } from "@/features/leads/useLeads";

export const useReports = (q: ReportQuery) =>
  useQuery({
    queryKey: ["reports", q],
    queryFn: () => api.get<ReportsDTO>(`/reports${toQueryString(q as never)}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

/** Direct link to the server-built CSV of every closed deal (the browser downloads it with the session cookie). */
export const closedDealsCsvUrl = (q: ReportQuery) => apiUrl(`/reports/deals.csv${toQueryString(q as never)}`);

export const useCalendar = (q: CalendarQuery) =>
  useQuery({
    queryKey: ["calendar", q],
    queryFn: async () => (await api.get<{ items: CalendarItemDTO[] }>(`/calendar${toQueryString(q as never)}`)).items,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
