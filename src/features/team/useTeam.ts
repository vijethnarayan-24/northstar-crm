import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangePasswordInput, InvitationDTO, InviteCreatedDTO, MemberUpdate, ProfileUpdate, Role, UserDTO } from "@crm/shared";
import { api } from "@/lib/api";
import { ME_KEY } from "@/lib/queryClient";

const USERS_KEY = ["users"] as const;
const INVITES_KEY = ["invitations"] as const;

export const useUsers = () => useQuery({ queryKey: USERS_KEY, queryFn: async () => (await api.get<{ users: UserDTO[] }>("/users")).users });

export const useInvitations = (enabled: boolean) =>
  useQuery({ queryKey: INVITES_KEY, enabled, queryFn: async () => (await api.get<{ invitations: InvitationDTO[] }>("/invitations")).invitations });

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Invitation created" },
    mutationFn: (input: { email: string; role: Role }) => api.post<InviteCreatedDTO>("/invitations", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useRenewInvite() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Invitation renewed" },
    mutationFn: (id: string) => api.post<InviteCreatedDTO>(`/invitations/${id}/renew`),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Invitation revoked" },
    mutationFn: (id: string) => api.delete(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Team member updated" },
    mutationFn: ({ id, ...changes }: MemberUpdate & { id: string }) => api.patch<{ user: UserDTO }>(`/users/${id}`, changes),
    onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    meta: { success: "Profile saved" },
    mutationFn: (changes: ProfileUpdate) => api.patch<{ user: UserDTO }>("/me", changes),
    onSuccess: ({ user }) => {
      qc.setQueryData(ME_KEY, user);
      qc.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
}

export const useChangePassword = () => useMutation({ meta: { success: "Password changed" }, mutationFn: (input: ChangePasswordInput) => api.post<void>("/me/password", input) });
