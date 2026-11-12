import { useOutletContext } from "react-router";
import type { View } from "@/types";

export function viewFromPath(pathname: string): View {
  if (pathname.startsWith("/leads/")) return "detail";
  if (pathname.startsWith("/leads")) return "leads";
  if (pathname.startsWith("/pipeline")) return "pipeline";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

export const VIEW_PATHS: Record<Exclude<View, "detail">, string> = {
  dashboard: "/",
  leads: "/leads",
  pipeline: "/pipeline",
  tasks: "/tasks",
  calendar: "/calendar",
  activity: "/activity",
  reports: "/reports",
  settings: "/settings",
};

export interface AppActions {
  /** Opens the Add lead drawer, optionally pre-selecting a pipeline stage. */
  openAddLead: (stageId?: string) => void;
  openEditLead: (id: string) => void;
}

export const useAppActions = () => useOutletContext<AppActions>();
