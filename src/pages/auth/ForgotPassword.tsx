import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { forgotPasswordInput, type ForgotPasswordInput } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import { api, errorMessage } from "@/lib/api";
import AuthLayout from "./AuthLayout";

export default function ForgotPassword() {
  const forgot = useMutation({ mutationFn: (input: ForgotPasswordInput) => api.post<void>("/auth/forgot", input) });
  const { register, handleSubmit, getValues, formState: { errors } } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordInput) });

  if (forgot.isSuccess)
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login" className="auth-link">Back to sign in</Link>}>
        <p className="auth-text">If an account exists for <b>{getValues("email")}</b>, we've sent a link to reset your password. It expires in one hour.</p>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your work email and we'll send you a reset link." footer={<Link to="/login" className="auth-link">Back to sign in</Link>}>
      <form className="auth-form" onSubmit={handleSubmit((v) => forgot.mutate(v))} noValidate>
        {forgot.isError && <FormAlert>{errorMessage(forgot.error)}</FormAlert>}
        <TextField label="Work email" type="email" autoComplete="email" autoFocus error={errors.email?.message} {...register("email")} />
        <button className="btn btn-primary btn-block" type="submit" disabled={forgot.isPending}>{forgot.isPending ? "Sending…" : "Send reset link"}</button>
      </form>
    </AuthLayout>
  );
}
