import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { DEAL_SIZES, LEAD_INTENTS, PROJECT_TYPES, TEMPERATURES, type LeadDetailDTO, type LeadInput, type LookupsDTO } from "@crm/shared";
import { useCurrentUser } from "@/auth/useAuth";
import FormAlert from "@/components/form/FormAlert";
import TextField from "@/components/form/TextField";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { ApiError, errorMessage } from "@/lib/api";
import { centsToInput, fromDateTimeLocal, parseMoneyToCents, toDateTimeLocal } from "@/lib/format";
import { DEAL_SIZE_LABELS, INTENT_LABELS, PROJECT_TYPE_LABELS, TEMPERATURE_LABELS } from "./labels";
import TagPicker from "./TagPicker";
import { useCreateLead, useLead, useLookups, useUpdateLead } from "./useLeads";
import { SkeletonList } from "@/components/ui/Skeleton";

const formSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(160),
  jobTitle: z.string().max(120),
  company: z.string().max(160),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  phone: z.string().max(40),
  location: z.string().max(160),
  sourceId: z.string(),
  projectType: z.string(),
  leadType: z.string().max(80),
  temperature: z.enum(TEMPERATURES),
  stageId: z.string(),
  intent: z.string(),
  value: z.string().refine((v) => !Number.isNaN(parseMoneyToCents(v)), "Enter an amount like 24000 or 24k"),
  dealSize: z.string(),
  expectedClose: z.string(),
  ownerId: z.string(),
  nextFollowupAt: z.string(),
  tagIds: z.array(z.string()),
  pinnedNote: z.string().max(2000),
});
type FormValues = z.infer<typeof formSchema>;

/** API field name → form field name, for mapping server validation errors. */
const SERVER_FIELD: Partial<Record<string, keyof FormValues>> = { valueCents: "value" };

function toFormValues(lead: LeadDetailDTO | undefined, defaults: { stageId?: string; ownerId: string }): FormValues {
  return {
    fullName: lead?.fullName ?? "",
    jobTitle: lead?.jobTitle ?? "",
    company: lead?.company ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    location: lead?.location ?? "",
    sourceId: lead?.source?.id ?? "",
    projectType: lead?.projectType ?? "",
    leadType: lead?.leadType ?? "",
    temperature: lead?.temperature ?? "warm",
    stageId: lead?.stage.id ?? defaults.stageId ?? "",
    intent: lead?.intent ?? "",
    value: centsToInput(lead?.valueCents),
    dealSize: lead?.dealSize ?? "",
    expectedClose: lead?.expectedClose ?? "",
    ownerId: lead ? lead.owner?.id ?? "" : defaults.ownerId,
    nextFollowupAt: toDateTimeLocal(lead?.nextFollowupAt),
    tagIds: lead?.tags.map((t) => t.id) ?? [],
    pinnedNote: lead?.pinnedNote ?? "",
  };
}

function toPayload(v: FormValues): LeadInput {
  return {
    fullName: v.fullName,
    jobTitle: v.jobTitle,
    company: v.company,
    email: v.email,
    phone: v.phone,
    location: v.location,
    sourceId: v.sourceId || null,
    projectType: (v.projectType || null) as LeadInput["projectType"],
    leadType: v.leadType,
    temperature: v.temperature,
    intent: (v.intent || null) as LeadInput["intent"],
    valueCents: parseMoneyToCents(v.value),
    dealSize: (v.dealSize || null) as LeadInput["dealSize"],
    expectedClose: v.expectedClose || null,
    ownerId: v.ownerId || null,
    nextFollowupAt: fromDateTimeLocal(v.nextFollowupAt),
    tagIds: v.tagIds,
    pinnedNote: v.pinnedNote,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="form-section"><h3>{title}</h3>{children}</section>;
}

function SelectField({ label, error, wide, children, ...select }: ComponentProps<"select"> & { label: string; error?: string; wide?: boolean }) {
  const id = useId();
  return (
    <div className={`field ${wide ? "wide" : ""} ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-invalid={error ? true : undefined} {...select}>{children}</select>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

export type LeadFormTarget = { mode: "create"; stageId?: string } | { mode: "edit"; id: string };

export default function LeadFormDrawer({ target, onClose }: { target: LeadFormTarget; onClose: () => void }) {
  const lookups = useLookups();
  const lead = useLead(target.mode === "edit" ? target.id : undefined);

  const loading = lookups.isPending || (target.mode === "edit" && lead.isPending);
  const loadError = lookups.error ?? (target.mode === "edit" ? lead.error : null);

  return (
    <Dialog
      variant="drawer"
      eyebrow={target.mode === "create" ? "New opportunity" : "Edit lead"}
      title={target.mode === "create" ? "Add lead" : lead.data?.fullName ?? "Edit lead"}
      description={target.mode === "create" ? "Capture contact and opportunity details." : "Update contact and opportunity details."}
      onClose={onClose}
    >
      {loadError ? (
        <FormAlert>{errorMessage(loadError)}</FormAlert>
      ) : loading ? (
        <SkeletonList rows={5} avatar={false}/>
      ) : (
        <LeadForm target={target} lookups={lookups.data!} lead={lead.data} onClose={onClose} />
      )}
    </Dialog>
  );
}

function LeadForm({ target, lookups, lead, onClose }: { target: LeadFormTarget; lookups: LookupsDTO; lead?: LeadDetailDTO; onClose: () => void }) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const create = useCreateLead();
  const update = useUpdateLead(lead?.id ?? "");
  const mutation = target.mode === "create" ? create : update;
  const [duplicate, setDuplicate] = useState<{ id: string; fullName: string } | null>(null);
  const typesId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  const defaultStage = target.mode === "create" ? target.stageId ?? lookups.stages.find((s) => s.kind === "open")?.id : undefined;
  const { register, handleSubmit, control, setError, formState: { errors, isDirty } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(lead, { stageId: defaultStage, ownerId: me.id }),
  });

  const submit = (allowDuplicate: boolean) =>
    handleSubmit((values) => {
      setDuplicate(null);
      const payload = { ...toPayload(values), allowDuplicate };
      const onError = (error: Error) => {
        if (!(error instanceof ApiError)) return;
        if (error.code === "duplicate_email") {
          setDuplicate((error.body.lead as { id: string; fullName: string } | undefined) ?? null);
          return;
        }
        let first = true;
        for (const [field, messages] of Object.entries(error.issues)) {
          if (!messages?.length) continue;
          setError(SERVER_FIELD[field] ?? (field as keyof FormValues), { type: "server", message: messages[0] }, { shouldFocus: first });
          first = false;
        }
      };
      if (target.mode === "create") {
        create.mutate({ ...payload, stageId: values.stageId || undefined }, {
          onSuccess: (created) => { onClose(); navigate(`/leads/${created.id}`); },
          onError,
        });
      } else {
        update.mutate(payload, { onSuccess: onClose, onError });
      }
    });

  const err = (k: keyof FormValues) => errors[k]?.message as string | undefined;
  const showGenericError = mutation.isError && !(mutation.error instanceof ApiError && (mutation.error.code === "duplicate_email" || Object.keys(mutation.error.issues).length));

  // Form-level messages render at the top; bring them into view when they appear.
  useEffect(() => {
    if (duplicate || showGenericError) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [duplicate, showGenericError]);

  return (
    <form className="lead-form" onSubmit={submit(false)} noValidate>
      <div className="dialog-scroll" ref={scrollRef}>
        {showGenericError && <FormAlert>{errorMessage(mutation.error)}</FormAlert>}
        {duplicate && (
          <FormAlert>
            <Link to={`/leads/${duplicate.id}`} onClick={onClose} className="auth-link">{duplicate.fullName}</Link> already uses this email.{" "}
            <button type="button" className="inline-link" onClick={submit(true)}>Save anyway</button>
          </FormAlert>
        )}

        <Section title="Contact info">
          <div className="form-grid">
            <TextField label="Full name *" placeholder="e.g. Jordan Lee" autoComplete="off" error={err("fullName")} {...register("fullName")} />
            <TextField label="Job title" placeholder="Head of Product" error={err("jobTitle")} {...register("jobTitle")} />
            <TextField label="Company" placeholder="Company" error={err("company")} {...register("company")} />
            <TextField label="Email" type="email" placeholder="name@company.com" error={err("email")} {...register("email")} />
            <TextField label="Phone" type="tel" placeholder="+1 555 000 0000" error={err("phone")} {...register("phone")} />
            <TextField label="Location" placeholder="City, Country" error={err("location")} {...register("location")} />
          </div>
        </Section>

        <Section title="Lead source & type">
          <div className="form-grid">
            <SelectField label="Source" error={err("sourceId")} {...register("sourceId")}>
              <option value="">No source</option>
              {lookups.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <SelectField label="Project type" {...register("projectType")}>
              <option value="">Not set</option>
              {PROJECT_TYPES.map((p) => <option key={p} value={p}>{PROJECT_TYPE_LABELS[p]}</option>)}
            </SelectField>
            <TextField label="Lead type" placeholder="Design, Development…" list={typesId} wide error={err("leadType")} {...register("leadType")} />
            <datalist id={typesId}>{lookups.leadTypes.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
        </Section>

        <Section title="Qualification">
          <Controller
            control={control}
            name="temperature"
            render={({ field }) => (
              <fieldset className="choice-group">
                <legend>Temperature</legend>
                <div className="pill-selector">
                  {TEMPERATURES.map((t) => (
                    <button key={t} type="button" className={`${field.value === t ? `active ${t}` : ""}`} aria-pressed={field.value === t} onClick={() => field.onChange(t)}>{TEMPERATURE_LABELS[t]}</button>
                  ))}
                </div>
              </fieldset>
            )}
          />
          <div className="form-grid">
            {target.mode === "create" && (
              <SelectField label="Stage" error={err("stageId")} {...register("stageId")}>
                {lookups.stages.filter((s) => s.kind !== "lost").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectField>
            )}
            <SelectField label="Lead intent" {...register("intent")}>
              <option value="">Not set</option>
              {LEAD_INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABELS[i]}</option>)}
            </SelectField>
          </div>
        </Section>

        <Section title="Deal info">
          <div className="form-grid">
            <TextField label="Estimated value (USD)" inputMode="decimal" placeholder="24000 or 24k" error={err("value")} {...register("value")} />
            <SelectField label="Deal size" {...register("dealSize")}>
              <option value="">Not set</option>
              {DEAL_SIZES.map((d) => <option key={d} value={d}>{DEAL_SIZE_LABELS[d]}</option>)}
            </SelectField>
            <TextField label="Expected close" type="date" error={err("expectedClose")} {...register("expectedClose")} />
            <SelectField label="Owner" error={err("ownerId")} {...register("ownerId")}>
              <option value="">Unassigned</option>
              {lookups.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? " (you)" : ""}</option>)}
            </SelectField>
            <TextField label="Next follow-up" type="datetime-local" wide error={err("nextFollowupAt")} {...register("nextFollowupAt")} />
          </div>
          <Controller control={control} name="tagIds" render={({ field }) => <TagPicker allTags={lookups.tags} value={field.value} onChange={field.onChange} />} />
          {errors.tagIds && <small className="field-error">{errors.tagIds.message}</small>}
        </Section>

        <Section title="Pinned note">
          <div className={`field wide ${errors.pinnedNote ? "has-error" : ""}`}>
            <label htmlFor="pinned-note">Context your team should see first</label>
            <textarea id="pinned-note" placeholder="Budget, decision makers, deadlines…" {...register("pinnedNote")} />
            {errors.pinnedNote && <small className="field-error">{errors.pinnedNote.message}</small>}
          </div>
        </Section>
      </div>

      <div className="dialog-footer">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <button className="btn btn-primary" type="submit" disabled={mutation.isPending || (target.mode === "edit" && !isDirty)}>
          {mutation.isPending ? "Saving…" : target.mode === "create" ? "Create lead" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
