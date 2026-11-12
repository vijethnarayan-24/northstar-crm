import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationCategory, NotificationPageDTO, NotificationPrefsDTO } from "@crm/shared";
import { api } from "@/lib/api";

const KEYS = { list: ["notifications", "list"] as const, count: ["notifications", "count"] as const, prefs: ["notification-prefs"] as const };

/** Unread badge: polled every 30 s so reminders and teammates' actions show up without a reload. */
export const useUnreadCount = () =>
  useQuery({ queryKey: KEYS.count, queryFn: async () => (await api.get<{ unreadCount: number }>("/notifications/unread-count")).unreadCount, refetchInterval: 30_000 });

export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: KEYS.list, queryFn: () => api.get<NotificationPageDTO>("/notifications?limit=20"), enabled });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorToast: true },
    mutationFn: (ids?: string[]) => api.post<{ unreadCount: number }>("/notifications/read", ids ? { ids } : {}),
    onSuccess: ({ unreadCount }, ids) => {
      qc.setQueryData(KEYS.count, unreadCount);
      qc.setQueryData<NotificationPageDTO>(KEYS.list, (page) => page && {
        ...page,
        unreadCount,
        items: page.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
      });
    },
  });
}

export const useNotificationPrefs = () => useQuery({ queryKey: KEYS.prefs, queryFn: () => api.get<NotificationPrefsDTO>("/me/notification-prefs") });

export function useSetNotificationPref() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Notification settings saved" },
    mutationFn: (input: { key: NotificationCategory; inApp: boolean }) => api.put<NotificationPrefsDTO>("/me/notification-prefs", input),
    onSuccess: (prefs) => qc.setQueryData(KEYS.prefs, prefs),
  });
}
