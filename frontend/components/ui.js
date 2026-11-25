'use client';

import Link from 'next/link';

const cx = (...c) => c.filter(Boolean).join(' ');

const BUTTON = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary: 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
  warn: 'bg-saffron-500 text-white hover:bg-saffron-600 disabled:bg-saffron-100',
};

export function Button({ variant = 'primary', size = 'md', block, loading, className, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed',
        size === 'lg' ? 'min-h-14 px-5 text-base' : size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-sm',
        BUTTON[variant],
        block && 'w-full',
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = 'primary', size = 'md', block, className, children, ...props }) {
  return (
    <Link
      href={href}
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition',
        size === 'lg' ? 'min-h-14 px-5 text-base' : size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-sm',
        BUTTON[variant],
        block && 'w-full',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ className, children, as: As = 'div', ...props }) {
  return (
    <As {...props} className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200', className)}>
      {children}
    </As>
  );
}

const TONE = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-brand-100 text-brand-800',
  amber: 'bg-saffron-100 text-saffron-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-sky-100 text-sky-800',
  violet: 'bg-violet-100 text-violet-800',
};

export function Badge({ tone = 'slate', className, children }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', TONE[tone], className)}>{children}</span>;
}

export function Spinner({ small }) {
  return (
    <span
      aria-label="Loading"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', small ? 'h-4 w-4' : 'h-6 w-6')}
    />
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner /> <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
      <p>{typeof error === 'string' ? error : error.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'amber', title, children, className }) {
  const tones = {
    amber: 'bg-saffron-50 text-saffron-700 ring-saffron-100',
    green: 'bg-brand-50 text-brand-800 ring-brand-100',
    blue: 'bg-sky-50 text-sky-900 ring-sky-100',
    red: 'bg-red-50 text-red-800 ring-red-200',
  };
  return (
    <div className={cx('rounded-xl px-4 py-3 text-sm ring-1', tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
    </div>
  );
}

export function Empty({ icon = '🍽️', title, children }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-2 font-semibold text-slate-800">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, back, action }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {back && (
        <Link href={back} aria-label="Back" className="-ml-2 mt-0.5 rounded-full p-2 text-slate-600 hover:bg-slate-200">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold leading-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// `group` for anything that is not a single form control (buttons, stars, a
// photo picker): a <label> there would steal the accessible name of whatever
// it wraps, so those get a fieldset and legend instead.
export function Field({ label, hint, error, children, className, group }) {
  const body = (
    <>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </>
  );
  if (group) {
    return (
      <fieldset className={cx('block min-w-0', className)}>
        <legend className="mb-1 block text-sm font-medium text-slate-700">{label}</legend>
        {body}
      </fieldset>
    );
  }
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {body}
    </label>
  );
}

const INPUT = 'block w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base text-slate-900 ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:bg-slate-100';

export function Input({ className, ...props }) {
  return <input {...props} className={cx(INPUT, className)} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select {...props} className={cx(INPUT, 'pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }) {
  return <textarea rows={3} {...props} className={cx(INPUT, className)} />;
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left disabled:opacity-50"
    >
      <span>
        <span className="block font-semibold text-slate-900">{label}</span>
        {hint && <span className="block text-sm text-slate-500">{hint}</span>}
      </span>
      <span className={cx('relative inline-flex h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition', checked ? 'left-[1.375rem]' : 'left-0.5')} />
      </span>
    </button>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-xl bg-slate-200/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition', value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export { cx };
