import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render errors so a thrown exception never leaves the user staring at
 * a blank white page (audit S-16).
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with your error reporting service when one is configured.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background-light">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-card p-6 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined">error</span>
          </div>
          <h1 className="mt-4 font-extrabold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            The page could not be displayed. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 bg-primary hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-lg text-sm"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
