import { LegalFooter } from '@/components/app/legal-footer';
import { PRIVATE_MESSAGE } from '@/lib/auth/allowed';
import { GoogleButton } from './google-button';

const ERRORS: Record<string, string> = {
  private: PRIVATE_MESSAGE,
  failed: "Sign-in didn't finish. Try again.",
};

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { error } = await searchParams;
  const message = typeof error === 'string' ? ERRORS[error] : undefined;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Runway</h1>
          <p className="text-sm text-muted-foreground">Sign in with your Google account</p>
        </div>
        <GoogleButton />
        {message ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {message}
          </p>
        ) : null}
      </div>
      <LegalFooter />
    </main>
  );
}
