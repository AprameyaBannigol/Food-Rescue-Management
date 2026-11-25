'use client';

export default function ErrorPage({ error, reset }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="text-4xl">😕</span>
      <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
      <p className="max-w-sm text-sm text-slate-500">{error?.message ?? 'Please try again.'}</p>
      <button type="button" onClick={reset} className="mt-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
