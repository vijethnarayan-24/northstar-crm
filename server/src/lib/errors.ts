/**
 * Throw from a handler; the app error handler turns it into `{ error: code, message, ...extra }`.
 * `extra` is for structured details such as `issues` or a conflicting record.
 */
export const httpError = (statusCode: number, code: string, message: string, extra?: Record<string, unknown>) =>
  Object.assign(new Error(message), { statusCode, code, extra });

/** 400 with field-level messages, same shape as schema validation errors. */
export const fieldError = (issues: Record<string, string[]>) =>
  httpError(400, "validation_error", "Please check the highlighted fields.", { issues });
