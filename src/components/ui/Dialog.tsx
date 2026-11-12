import { useEffect, useRef, type ReactNode } from "react";
import Icon from "./Icon";

/**
 * Centered modal built on the native <dialog>: focus is trapped, Escape closes it,
 * and focus returns to the trigger on close.
 */
export default function Dialog({ title, description, eyebrow, onClose, children, footer, variant = "center" }: { title: string; description?: ReactNode; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; variant?: "center" | "drawer" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // showModal() focuses the first focusable element (the close button). Prefer the first
    // field in the body, then the first footer action (e.g. Cancel in a confirmation).
    dialog.querySelector<HTMLElement>(".dialog-body :is(input, select, textarea, button):not([disabled]), .dialog-footer button")?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog ${variant === "drawer" ? "dialog-drawer" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="dialog-header">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id="dialog-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
