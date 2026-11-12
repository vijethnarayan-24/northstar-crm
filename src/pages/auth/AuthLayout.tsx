import type { ReactNode } from "react";
import ThemeToggle from "@/components/ui/ThemeToggle";

/** Split screen: an editorial headline on the left, the form on the right (stacks on phones). */
export default function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-split">
      <section className="auth-hero" aria-label="Northstar CRM">
        <div className="auth-brand brand"><span className="brand-mark" aria-hidden="true">N</span><span>Northstar<span className="brand-muted"> CRM</span></span></div>
        <div>
          <h1>Every lead. Every deal. <em>One pipeline.</em></h1>
          <p>The team's shared workspace for following up on time, moving deals forward and seeing what's working.</p>
        </div>
        <ul className="auth-points">
          <li><span className="num">01</span>Capture leads</li>
          <li><span className="num">02</span>Work the pipeline</li>
          <li><span className="num">03</span>Close and learn</li>
        </ul>
      </section>
      <main className="auth-panel">
        <ThemeToggle className="auth-theme"/>
        <div className="auth-card">
          <p className="eyebrow">Northstar workspace</p>
          <h1>{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
          {footer && <p className="auth-footer">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
