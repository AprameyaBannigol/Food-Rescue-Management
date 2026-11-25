'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { Button, ErrorBox, Field, Input, Notice, cx } from '@/components/ui';

const ROLES = [
  { value: 'donor', icon: '🏨', title: 'Donor', body: 'Hotel, restaurant, hostel or college mess with surplus cooked food' },
  { value: 'ngo', icon: '🏠', title: 'NGO', body: 'Shelter, orphanage or community kitchen that serves meals' },
  { value: 'volunteer', icon: '🛵', title: 'Volunteer', body: 'Pick up food and deliver it on your bike or car' },
];

export default function LoginPage() {
  const router = useRouter();
  const { user, profile, loading, signIn } = useAuth();
  const [step, setStep] = useState('phone'); // phone -> code -> role
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!loading && user) router.replace(homeFor(user, profile));
  }, [loading, user, profile, router]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function requestOtp(e) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post('/auth/otp/request', { phone });
      setDevCode(res.devCode ?? null);
      setStep('code');
      setResendIn(30);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = { phone, code };
      if (step === 'role') Object.assign(body, { role, name: name.trim() });
      const res = await post('/auth/otp/verify', body);
      const me = await signIn(res.token);
      router.replace(homeFor(me.user, me.profile));
    } catch (err) {
      if (err.details?.needsRole) setStep('role');
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-700 to-brand-900">
      <div className="px-6 pb-8 pt-12 text-white">
        <img src="/icons/icon.svg" alt="" className="h-14 w-14 rounded-2xl ring-2 ring-white/30" />
        <h1 className="mt-4 text-3xl font-bold">Food Rescue</h1>
        <p className="mt-1 text-brand-100">Good food from Hubballi's kitchens, to people who need it, within its safe window.</p>
      </div>

      <div className="safe-bottom flex-1 rounded-t-3xl bg-white px-6 pb-8 pt-6">
        <div className="mx-auto max-w-sm">
          {step === 'phone' && (
            <form onSubmit={requestOtp} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Log in or sign up</h2>
              <Field label="Mobile number" hint="We'll send a 6-digit code by SMS">
                <div className="flex">
                  <span className="flex items-center rounded-l-xl bg-slate-100 px-3 text-slate-600 ring-1 ring-slate-300">+91</span>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98xxxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 10))}
                    className="rounded-l-none"
                    required
                  />
                </div>
              </Field>
              <ErrorBox error={error} />
              <Button type="submit" block size="lg" loading={busy} disabled={phone.length !== 10}>
                Send code
              </Button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={verify} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Enter the code</h2>
              <p className="text-sm text-slate-600">
                Sent to +91 {phone}.{' '}
                <button type="button" className="font-semibold text-brand-700" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>
                  Change number
                </button>
              </p>
              {devCode && (
                <Notice tone="blue" title="Demo mode">
                  Your code is <b className="code-digits">{devCode}</b>. Real SMS is off on this server.
                </Notice>
              )}
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="code-digits text-center text-2xl font-bold"
                autoFocus
              />
              <ErrorBox error={error} />
              <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6}>
                Verify
              </Button>
              <button type="button" disabled={resendIn > 0 || busy} onClick={requestOtp} className="w-full text-sm font-semibold text-brand-700 disabled:text-slate-400">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            </form>
          )}

          {step === 'role' && (
            <form onSubmit={verify} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Welcome! How will you help?</h2>
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    className={cx(
                      'flex w-full items-start gap-3 rounded-2xl p-3 text-left ring-2 transition',
                      role === r.value ? 'bg-brand-50 ring-brand-500' : 'bg-white ring-slate-200 hover:ring-slate-300',
                    )}
                  >
                    <span className="text-3xl">{r.icon}</span>
                    <span>
                      <span className="block font-bold text-slate-900">{r.title}</span>
                      <span className="block text-sm text-slate-600">{r.body}</span>
                    </span>
                  </button>
                ))}
              </div>
              <Field label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" required minLength={2} />
              </Field>
              <ErrorBox error={error} />
              <Button type="submit" block size="lg" loading={busy} disabled={!role || name.trim().length < 2}>
                Continue
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
