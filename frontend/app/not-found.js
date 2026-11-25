import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <img src="/icons/icon.svg" alt="" className="h-14 w-14" />
      <h1 className="text-xl font-bold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-500">That link does not exist, or it was for a listing that has closed.</p>
      <Link href="/" className="mt-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">
        Go to my home page
      </Link>
    </div>
  );
}
