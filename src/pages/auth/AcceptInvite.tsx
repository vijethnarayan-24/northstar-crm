import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { acceptInviteInput, type Role } from "@crm/shared";
import { useAcceptInvite, useMe } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import { api, errorMessage } from "@/lib/api";
import { applyServerErrors } from "@/lib/forms";
import AuthLayout from "./AuthLayout";

const formSchema = z
  .object({ name: acceptInviteInput.shape.name, password: acceptInviteInput.shape.password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
type FormValues = z.infer<typeof formSchema>;

export default function AcceptInvite() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => api.get<{ email: string; role: Role }>(`/auth/invite/${token}`), retry: false });
  const accept = useAcceptInvite();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  if (invite.isPending) return <AuthLayout title="Checking your invite…"><p className="auth-text">One moment.</p></AuthLayout>;
  if (invite.isError)
    return (
      <AuthLayout title="Invite unavailable" footer={<Link to="/login" className="auth-link">Go to sign in</Link>}>
        <FormAlert>{errorMessage(invite.error)}</FormAlert>
      </AuthLayout>
    );

  const onSubmit = handleSubmit(({ name, password }) =>
    accept.mutate({ token, name, password }, {
      onSuccess: () => navigate("/", { replace: true }),
      onError: (error) => applyServerErrors(error, setError),
    }),
  );

  return (
    <AuthLayout
      title="Join Northstar CRM"
      subtitle={<>You're joining as {invite.data.role === "admin" ? "an admin" : "a member"} with <b>{invite.data.email}</b>.</>}
      footer={<>Already have an account? <Link to="/login" className="auth-link">Sign in</Link></>}
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {me && <FormAlert tone="info">You're signed in as {me.email}. Accepting will switch to the new account.</FormAlert>}
        {accept.isError && <FormAlert>{errorMessage(accept.error)}</FormAlert>}
        <TextField label="Full name" autoComplete="name" autoFocus error={errors.name?.message} {...register("name")} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 12 characters" error={errors.password?.message} {...register("password")} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
        <button className="btn btn-primary btn-block" type="submit" disabled={accept.isPending}>{accept.isPending ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthLayout>
  );
}
