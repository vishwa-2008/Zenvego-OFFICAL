import React from 'react';
import { FIREBASE_CONSOLE_UPGRADE_URL } from '../lib/firebase';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isQuotaError: boolean;
  isPermissionError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isQuotaError: false,
      isPermissionError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const raw = error?.message || 'An unexpected error occurred.';
    const lower = raw.toLowerCase();
    const isQuotaError = lower.includes('quota exceeded') || lower.includes('resource-exhausted');
    const isPermissionError = lower.includes('permission-denied') || lower.includes('insufficient permissions');

    let readable = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string; path?: string; operationType?: string };
      if (parsed.error) {
        readable = `${parsed.error}${parsed.path ? ` (${parsed.operationType || 'op'} on ${parsed.path})` : ''}`;
      }
    } catch {
      // Keep original message
    }

    return {
      hasError: true,
      errorMessage: readable,
      isQuotaError,
      isPermissionError,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Zenvego ErrorBoundary caught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f5fbf5] text-[#171d1a] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border border-[#bfc9c1]/40 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined">error_outline</span>
              </div>
              <div>
                <h2 className="font-headline font-bold text-lg text-[#002113]">
                  {this.state.isQuotaError
                    ? 'Database Daily Quota Reached'
                    : this.state.isPermissionError
                      ? 'Access Permission Blocked'
                      : 'Something went wrong'}
                </h2>
                <p className="text-xs text-[#404943]">Zenvego recovered safely without losing session state.</p>
              </div>
            </div>

            <p className="text-xs text-[#404943] bg-[#eff5ef] rounded-xl p-3 break-words font-mono">
              {this.state.errorMessage}
            </p>

            {this.state.isQuotaError && (
              <div className="text-xs text-[#404943] space-y-2">
                <p>
                  Firestore free tier quota resets daily. You can inspect or upgrade your database quota directly in the
                  Firebase Console:
                </p>
                <a
                  href={FIREBASE_CONSOLE_UPGRADE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[#005232] font-semibold underline"
                >
                  Open Firebase Firestore Console
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                </a>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '', isQuotaError: false, isPermissionError: false });
                window.location.reload();
              }}
              className="w-full py-3 rounded-xl bg-[#005232] text-white font-semibold text-sm hover:bg-[#003d25] transition-colors cursor-pointer"
            >
              Reload Zenvego
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
