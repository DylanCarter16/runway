'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requestCode, verifyCode } from './actions';

export default function LoginPage() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmitEmail(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestCode(email);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep('code');
    });
  }

  function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifyCode(email, code);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Runway</h1>
          <p className="text-sm text-muted-foreground">
            {step === 'email' ? 'Sign in with your email' : `Enter the code sent to ${email}`}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={onSubmitEmail} className="space-y-4">
            <Input
              type="email"
              name="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSubmitCode} className="space-y-4">
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              name="code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              autoFocus
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Verifying…' : 'Verify code'}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-muted-foreground underline underline-offset-2"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
