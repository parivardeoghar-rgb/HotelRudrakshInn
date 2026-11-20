import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed.error) {
          friendly = `Database operation (${parsed.operationType || 'access'} on ${parsed.path || 'record'}) failed: ${parsed.error}`;
        }
      } catch {
        // Use raw message
      }

      return (
        <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#1C1E22] border border-zinc-800 rounded-xl p-8">
            <div className="flex items-center gap-3 text-amber-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="font-display text-xl font-semibold">Hotel Rudraksh Inn — Notice</h1>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed mb-6">{friendly}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C59B27] text-[#141518] font-semibold text-sm hover:bg-[#D4AF37] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
