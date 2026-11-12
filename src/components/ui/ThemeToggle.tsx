import Icon from "@/components/ui/Icon";
import { useTheme } from "@/lib/theme";

/** Switches between the light and dark themes; the choice is remembered on this device. */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={`icon-btn theme-toggle ${className}`}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
