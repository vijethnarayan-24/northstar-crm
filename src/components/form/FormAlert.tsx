import type { ReactNode } from "react";

export default function FormAlert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  return <div className={`form-alert form-alert-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
