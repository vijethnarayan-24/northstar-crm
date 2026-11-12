import { useId, type ComponentProps } from "react";

type Props = ComponentProps<"input"> & { label: string; error?: string; hint?: string; wide?: boolean };

/** Labelled input wired for react-hook-form's `register` (React 19 passes `ref` as a prop). */
export default function TextField({ label, error, hint, wide = false, id, ...input }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={`field ${wide ? "wide" : ""} ${error ? "has-error" : ""}`}>
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {error ? <small id={`${inputId}-error`} className="field-error">{error}</small> : hint ? <small id={`${inputId}-hint`} className="field-hint">{hint}</small> : null}
    </div>
  );
}
