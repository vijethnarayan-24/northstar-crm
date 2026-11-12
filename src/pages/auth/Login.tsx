import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { loginInput, type LoginInput } from "@crm/shared";
import { useLogin, useMe } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import { errorMessage } from "@/lib/api";
import { applyServerErrors, safeNext } from "@/lib/forms";
import AuthLayout from "./AuthLayout";

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const { data: me } = useMe();
  const login = useLogin();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<LoginInput>({ resolver: zodResolver(loginInput) });

  if (me) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: () => navigate(next, { replace: true }),
      onError: (error) => applyServerErrors(error, setError),
    }),
  );

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Sign in to your workspace.">
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {login.isError && <FormAlert>{errorMessage(login.error)}</FormAlert>}
        {params.get("reset") === "1" && !login.isError && <FormAlert tone="success">Password updated. Sign in with your new password.</FormAlert>}
        <TextField label="Work email" type="email" autoComplete="email" autoFocus error={errors.email?.message} {...register("email")} />
        <TextField label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register("password")} />
        <div className="auth-row"><Link to="/forgot-password" className="auth-link">Forgot password?</Link></div>
        <button className="btn btn-primary btn-block" type="submit" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</button>
      </form>
    </AuthLayout>
  );
}
