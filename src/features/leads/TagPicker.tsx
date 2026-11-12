import { useId, useState } from "react";
import type { TagRef } from "@crm/shared";
import Badge from "@/components/ui/Badge";
import { errorMessage } from "@/lib/api";
import { useCreateTag } from "./useLeads";

/** Selected tags as removable chips, plus a search box that suggests existing tags or creates a new one. */
export default function TagPicker({ allTags, value, onChange, label = "Tags" }: { allTags: TagRef[]; value: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const [text, setText] = useState("");
  const create = useCreateTag();
  const inputId = useId();
  const selected = value.map((id) => allTags.find((t) => t.id === id)).filter((t): t is TagRef => !!t);
  const term = text.trim().toLowerCase();
  const suggestions = allTags.filter((t) => !value.includes(t.id) && (!term || t.name.toLowerCase().includes(term))).slice(0, 6);
  const exact = allTags.find((t) => t.name.toLowerCase() === term);

  const add = (id: string) => {
    if (!value.includes(id)) onChange([...value, id]);
    setText("");
  };
  const createTag = () => create.mutate({ name: text.trim() }, { onSuccess: (tag) => add(tag.id) });

  return (
    <div className="field wide tag-picker">
      <label htmlFor={inputId}>{label}</label>
      {selected.length > 0 && (
        <div className="tag-chips">
          {selected.map((t) => (
            <span key={t.id} className="tag-chip">
              <Badge tone={t.color}>{t.name}</Badge>
              <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => onChange(value.filter((id) => id !== t.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        id={inputId}
        value={text}
        placeholder="Search or create a tag…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !term) return;
          e.preventDefault();
          if (exact) add(exact.id);
          else if (suggestions.length === 1) add(suggestions[0]!.id);
          else createTag();
        }}
      />
      {(suggestions.length > 0 || (term && !exact)) && (
        <div className="tag-suggestions">
          {suggestions.map((t) => (
            <button type="button" key={t.id} onClick={() => add(t.id)}><Badge tone={t.color}>{t.name}</Badge></button>
          ))}
          {term && !exact && (
            <button type="button" className="tag-create" disabled={create.isPending} onClick={createTag}>+ Create “{text.trim()}”</button>
          )}
        </div>
      )}
      {create.isError && <small className="field-error">{errorMessage(create.error)}</small>}
    </div>
  );
}
