import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcceptInviteInput, LoginInput, UserDTO } from "@crm/shared";
import { ApiError, api } from "@/lib/api";
import { ME_KEY } from "@/lib/queryClient";

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await api.get<{ user: UserDTO }>("/me")).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** For components rendered inside RequireAuth, where the user is guaranteed. */
export function useCurrentUser(): UserDTO {
  const { data } = useMe();
  if (!data) throw new Error("useCurrentUser must be used inside RequireAuth");
  return data;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: UserDTO }>("/auth/login", input),
    onSuccess: ({ user }) => {
      qc.clear();
      qc.setQueryData(ME_KEY, user);
    },
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptInviteInput) => api.post<{ user: UserDTO }>("/auth/accept-invite", input),
    onSuccess: ({ user }) => {
      qc.clear();
      qc.setQueryData(ME_KEY, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorToast: true },
    mutationFn: () => api.post<void>("/auth/logout"),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name;
