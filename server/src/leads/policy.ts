import type { schema } from "../db/client";

type User = typeof schema.users.$inferSelect;
type Lead = Pick<typeof schema.leads.$inferSelect, "ownerId" | "createdBy">;

/**
 * Who may change a lead. Everyone can see every lead; members can edit leads they own,
 * created, or that nobody owns yet. Admins can do anything. Kept in one place so the
 * rule is easy to change.
 */
export const canEditLead = (user: User, lead: Lead) =>
  user.role === "admin" || lead.ownerId === null || lead.ownerId === user.id || lead.createdBy === user.id;

export const canDeleteLead = (user: User, lead: Lead) => user.role === "admin" || lead.ownerId === user.id || lead.createdBy === user.id;

/**
 * Anyone can log activity or add tasks on any lead (it's a shared workspace).
 * Editing or deleting an activity is limited to its author and admins.
 */
export const canEditActivity = (user: User, activity: { authorId: string | null }) => user.role === "admin" || activity.authorId === user.id;

/**
 * Who may give a task to whom. Anyone can create tasks for themselves; handing a task
 * to someone else is for admins and for the owner of the lead the task is about.
 */
export const canAssignTask = (user: User, assigneeId: string, leadOwnerId: string | null) =>
  user.role === "admin" || assigneeId === user.id || (leadOwnerId !== null && leadOwnerId === user.id);

/** Tasks can be changed by the assignee, whoever created them, the lead's owner, or an admin. */
export const canEditTask = (user: User, task: { assigneeId: string; createdBy: string | null }, leadOwnerId: string | null) =>
  user.role === "admin" || task.assigneeId === user.id || task.createdBy === user.id || (leadOwnerId !== null && leadOwnerId === user.id);
