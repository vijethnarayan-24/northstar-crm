import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "./api";

/**
 * Copies field-level validation errors from the API onto the form.
 * Returns true when at least one field error was applied.
 */
export function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  for (const [field, messages] of Object.entries(error.issues)) {
    if (messages?.length) {
      setError(field as Path<T>, { type: "server", message: messages[0] });
      applied = true;
    }
  }
  return applied;
}

/** Only allow same-app relative redirects after login. */
export const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
