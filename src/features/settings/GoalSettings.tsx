import { useEffect, useState } from "react";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Button from "@/components/ui/Button";
import { useGoal, useSetGoal } from "@/features/insights/useInsights";
import { ApiError, errorMessage } from "@/lib/api";
import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/format";

/** Admins set this month's revenue target; everyone sees progress in the sidebar. */
export default function GoalSettings() {
  const isAdmin = useCurrentUser().role === "admin";
  const goal = useGoal();
  const save = useSetGoal();
  const [value, setValue] = useState("");
  useEffect(() => { if (goal.data) setValue(centsToInput(goal.data.targetCents)); }, [goal.data]);

  const cents = parseMoneyToCents(value);
  const invalid = Number.isNaN(cents);
  const monthName = goal.data ? new Date(`${goal.data.month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";
  const dirty = !!goal.data && cents !== goal.data.targetCents;
  const serverError = save.error instanceof ApiError ? save.error.issues.targetCents?.[0] : undefined;

  return (
    <section className="card settings-card">
      <div className="card-header"><div><h2>Monthly goal</h2><p>The revenue target shown in everyone's sidebar. Progress counts deals won this month.</p></div></div>
      <form className="settings-body settings-form" noValidate onSubmit={(e) => { e.preventDefault(); if (goal.data && !invalid) save.mutate({ month: goal.data.month, targetCents: cents }); }}>
        {goal.error && <FormAlert>{errorMessage(goal.error)}</FormAlert>}
        {save.isSuccess && !dirty && <FormAlert tone="success">Goal saved.</FormAlert>}
        {save.isError && !serverError && <FormAlert>{errorMessage(save.error)}</FormAlert>}
        <TextField label={`Target for ${monthName} (USD)`} inputMode="decimal" placeholder="e.g. 100k" value={value} disabled={!isAdmin}
          error={invalid ? "Enter an amount like 100000 or 100k" : serverError}
          hint={goal.data ? `Won so far: ${formatMoney(goal.data.wonCents)}. Leave empty for no goal.` : undefined}
          onChange={(e) => setValue(e.target.value)} />
        {isAdmin ? <div><Button type="submit" disabled={!dirty || invalid || save.isPending}>{save.isPending ? "Saving…" : "Save goal"}</Button></div>
          : <p className="muted-note">Only workspace admins can change the goal.</p>}
      </form>
    </section>
  );
}
