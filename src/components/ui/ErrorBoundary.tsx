import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/errorReporting";

/**
 * Catches a crash while drawing a page, shows a friendly screen instead of a blank one, and
 * reports it to the server so admins see it on Settings → System status. `resetKey` (the
 * current path) clears the error when the user navigates elsewhere.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, { componentStack: info.componentStack ?? undefined });
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="crash-screen" role="alert">
          <p className="eyebrow">Something went wrong</p>
          <h1>This page hit a problem</h1>
          <p>It has been reported automatically. Try again; if it keeps happening, tell your admin what you were doing.</p>
          <div className="crash-actions">
            <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button type="button" className="btn btn-secondary" onClick={() => window.location.assign("/")}>Go to dashboard</button>
          </div>
          <details><summary>Technical details</summary><code>{this.state.error.message}</code></details>
        </div>
      </div>
    );
  }
}
