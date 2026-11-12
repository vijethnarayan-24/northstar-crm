import type { ReactNode } from "react";
import type { Tone } from "@/types";

export default function Badge({ children, tone = "gray", dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="badge-dot"/>}{children}</span>;
}
