import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import {
  NOTIFICATION_CATEGORIES,
  notificationListQuery,
  notificationPrefUpdate,
  notificationReadInput,
  type EventType,
  type NotificationPageDTO,
  type NotificationPrefsDTO,
} from "@crm/shared";
import { currentUser, requireAuth } from "../auth/session";
import { schema } from "../db/client";
import { selectEvents, toFeedEvent } from "./insights";

const { notifications, notificationPrefs, events } = schema;

const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  const unreadCount = async (userId: string) => {
    const [{ n }] = await app.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return n;
  };

  app.get("/notifications", async (request): Promise<NotificationPageDTO> => {
    const me = currentUser(request);
    const q = notificationListQuery.parse(request.query);
    // Page through my notifications, then load their events with the shared feed shape.
    const notes = await app.db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, me.id),
        q.unread === "1" ? isNull(notifications.readAt) : undefined,
        q.before ? lt(notifications.createdAt, new Date(q.before)) : undefined,
      ))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(q.limit + 1);
    const page = notes.slice(0, q.limit);
    const eventRows = page.length ? await selectEvents(app.db).where(inArray(events.id, page.map((n) => n.eventId))) : [];
    const byId = new Map(eventRows.map((r) => [r.e.id, toFeedEvent(r)]));
    return {
      items: page.filter((n) => byId.has(n.eventId)).map((n) => ({ id: n.id, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(), event: byId.get(n.eventId)! })),
      unreadCount: await unreadCount(me.id),
      nextBefore: notes.length > q.limit ? page.at(-1)!.createdAt.toISOString() : null,
    };
  });

  app.get("/notifications/unread-count", async (request) => ({ unreadCount: await unreadCount(currentUser(request).id) }));

  /** Marks the given notifications (or all of mine) as read. */
  app.post("/notifications/read", async (request) => {
    const me = currentUser(request);
    const { ids } = notificationReadInput.parse(request.body ?? {});
    await app.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt), ids?.length ? inArray(notifications.id, ids) : undefined));
    return { unreadCount: await unreadCount(me.id) };
  });

  // ---------- Preferences (in-app; email arrives with email delivery) ----------
  const prefsFor = async (userId: string): Promise<NotificationPrefsDTO> => {
    const off = await app.db.select({ type: notificationPrefs.eventType }).from(notificationPrefs).where(and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.inApp, false)));
    const offTypes = new Set(off.map((r) => r.type));
    return { categories: NOTIFICATION_CATEGORIES.map((c) => ({ key: c.key, inApp: !c.types.some((t) => offTypes.has(t)) })) };
  };

  app.get("/me/notification-prefs", async (request) => prefsFor(currentUser(request).id));

  app.put("/me/notification-prefs", async (request) => {
    const me = currentUser(request);
    const { key, inApp } = notificationPrefUpdate.parse(request.body);
    const category = NOTIFICATION_CATEGORIES.find((c) => c.key === key)!;
    await app.db
      .insert(notificationPrefs)
      .values(category.types.map((eventType) => ({ userId: me.id, eventType: eventType as EventType, inApp })))
      .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.eventType], set: { inApp } });
    return prefsFor(me.id);
  });
};

export default notificationRoutes;
