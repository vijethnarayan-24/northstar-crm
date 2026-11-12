import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toaster";
import { ApiError, errorMessage } from "./api";

export const ME_KEY = ["me"] as const;

/**
 * Per-action status messages, declared where each mutation is defined:
 *   useMutation({ ..., meta: { success: "Lead saved" } })
 *   meta: { success: (data, variables) => `Moved to ${...}` }
 *   meta: { errorToast: true }  // for actions whose errors aren't shown in a form
 */
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      success?: string | ((data: unknown, variables: unknown) => string | null);
      errorToast?: boolean;
    };
  }
}

let sessionToastShown = false;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // Session expired or revoked elsewhere: drop the cached user so RequireAuth sends us to /login.
      if (error instanceof ApiError && error.status === 401) {
        if (queryClient.getQueryData(ME_KEY) && !sessionToastShown) {
          sessionToastShown = true;
          toast.info("You've been signed out", "Your session ended. Sign in again to continue.");
        }
        queryClient.setQueryData(ME_KEY, null);
      }
    },
  }),
  mutationCache: new MutationCache({
    onSuccess: (data, variables, _context, mutation) => {
      // Any change can move dashboard numbers, add feed events or affect the monthly goal.
      for (const key of [["dashboard"], ["feed"], ["goal"], ["notifications"], ["reports"], ["calendar"]]) queryClient.invalidateQueries({ queryKey: key });
      const success = mutation.meta?.success;
      const message = typeof success === "function" ? success(data, variables) : success;
      if (message) toast.success(message);
      sessionToastShown = false;
    },
    onError: (error, _variables, _context, mutation) => {
      // Forms show their own errors inline; everything else pops up. Lost connections always do.
      const offline = error instanceof ApiError && error.status === 0;
      if (mutation.meta?.errorToast || offline) toast.error(offline ? "You're offline" : "That didn't work", errorMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Retry network errors and 5xx (e.g. 502 while the API restarts during a deploy) with backoff; never 4xx.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 4,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});
