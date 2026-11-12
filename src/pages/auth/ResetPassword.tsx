import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { resetPasswordInput } from "@crm/shared";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import { api, errorMessage } from "@/lib/api";
import { applyServerErrors } from "@/lib/forms";
import AuthLayout from "./AuthLayout";

const formSchema = z
  .object({ password: resetPasswordInput.shape.password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });
type FormValues = z.infer<typeof formSchema>;

export default function ResetPassword() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const reset = useMutation({ mutationFn: (password: string) => api.post<void>("/auth/reset", { token, password }) });
  const { register, handleSubmit, setError, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const onSubmit = handleSubmit(({ password }) =>
    reset.mutate(password, {
      onSuccess: () => navigate("/login?reset=1", { replace: true }),
      onError: (error) => applyServerErrors(error, setError),
    }),
  );

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll be signed out of all other devices." footer={<Link to="/login" className="auth-link">Back to sign in</Link>}>
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {reset.isError && (
          <FormAlert>
            {errorMessage(reset.error)} <Link to="/forgot-password" className="auth-link">Request a new link</Link>
          </FormAlert>
        )}
        <TextField label="New password" type="password" autoComplete="new-password" autoFocus hint="At least 12 characters" error={errors.password?.message} {...register("password")} />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
        <button className="btn btn-primary btn-block" type="submit" disabled={reset.isPending}>{reset.isPending ? "Saving…" : "Update password"}</button>
      </form>
    </AuthLayout>
  );
}
