export default function Avatar({ initials, color = "purple", size = "md" }: { initials: string; color?: string; size?: "sm" | "md" | "lg" }) {
  return <span className={`avatar avatar-${size} avatar-${color}`}>{initials}</span>;
}
