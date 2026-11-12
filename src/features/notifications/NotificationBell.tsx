import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { NotificationDTO } from "@crm/shared";
import Icon from "@/components/ui/Icon";
import FeedItem from "@/features/insights/FeedItem";
import { errorMessage } from "@/lib/api";
import { useMarkRead, useNotifications, useUnreadCount } from "./useNotifications";
import { SkeletonList } from "@/components/ui/Skeleton";

/** Bell with unread count; opens a panel of recent notifications. */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const count = useUnreadCount();
  const list = useNotifications(open);
  const markRead = useMarkRead();
  const unread = count.data ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => { if (open) void list.refetch(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openItem = (n: NotificationDTO) => {
    if (!n.readAt) markRead.mutate([n.id]);
    setOpen(false);
    const lead = n.event.lead;
    if (lead && !lead.deleted) navigate(n.event.type.startsWith("task.") ? `/leads/${lead.id}?tab=tasks` : n.event.type.startsWith("document.") ? `/leads/${lead.id}?tab=documents` : `/leads/${lead.id}`);
    else if (n.event.type.startsWith("task.")) navigate("/tasks");
    else if (n.event.type === "system.error") navigate("/settings/system");
  };

  return (
    <div className="menu notification-menu" ref={root}>
      <button type="button" className="icon-btn notification" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />{unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-head">
            <b>Notifications</b>
            <span>{unread > 0 && <button type="button" className="text-button" onClick={() => markRead.mutate(undefined)}>Mark all as read</button>}
              <button type="button" className="text-button" onClick={() => { setOpen(false); navigate("/settings/notifications"); }}>Settings</button></span>
          </div>
          {list.isPending && <SkeletonList rows={3}/>}
          {list.isError && <p className="empty-note list-note">{errorMessage(list.error)}</p>}
          {list.data?.items.length === 0 && <p className="empty-note list-note">You're all caught up.</p>}
          <ul>
            {list.data?.items.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "unread"}>
                <button type="button" onClick={() => openItem(n)}><FeedItem event={n.event} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
