const DAY = 86_400_000;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** 2400000 → "$24,000" */
export const formatMoney = (cents: number | null | undefined) => (cents == null ? "—" : money.format(cents / 100));

/** 28450000 → "$284.5k" */
export const formatMoneyCompact = (cents: number) => {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return money.format(dollars);
};

/** "24,000" / "$24k" / "24000.50" → cents, or null for blank; NaN for invalid. */
export const parseMoneyToCents = (input: string): number | null => {
  const s = input.trim().replace(/[$,\s]/g, "").toLowerCase();
  if (!s) return null;
  const multiplier = s.endsWith("k") ? 1_000 : s.endsWith("m") ? 1_000_000 : 1;
  const n = Number(multiplier === 1 ? s : s.slice(0, -1));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * multiplier * 100) : NaN;
};
export const centsToInput = (cents: number | null | undefined) => (cents == null ? "" : String(cents / 100));

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });

/** "Just now", "8 min ago", "2h ago", "Yesterday", "3d ago", "Nov 2" */
export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24 && dayDiff(new Date(), d) === 0) return `${Math.round(mins / 60)}h ago`;
  const days = dayDiff(new Date(), d);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return shortDate(d);
}

/** Follow-up label and whether it is overdue: "Today, 2:30 PM", "Tomorrow", "Overdue 2d", "Nov 28". */
export function formatFollowup(iso: string | null | undefined): { label: string; overdue: boolean } {
  if (!iso) return { label: "—", overdue: false };
  const d = new Date(iso);
  const now = new Date();
  const days = dayDiff(d, now);
  if (d.getTime() < now.getTime()) {
    return { label: days === 0 ? `Overdue · ${time(d)}` : `Overdue ${-days}d`, overdue: true };
  }
  if (days === 0) return { label: `Today, ${time(d)}`, overdue: false };
  if (days === 1) return { label: "Tomorrow", overdue: false };
  return { label: shortDate(d), overdue: false };
}

export const daysSince = (iso: string) => Math.max(0, dayDiff(new Date(), new Date(iso)));

export const formatDate = (iso: string | null | undefined) => (iso ? shortDate(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)) : "—");
export const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = dayDiff(d, new Date());
  return `${days === 0 ? "Today" : days === -1 ? "Yesterday" : shortDate(d)}, ${time(d)}`;
};

/** <input type="datetime-local"> uses local time without a zone. */
export const toDateTimeLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromDateTimeLocal = (value: string) => (value ? new Date(value).toISOString() : null);

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
