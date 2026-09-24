'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { continueWithGoogle } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending}>
      {pending ? 'Opening Google…' : 'Continue with Google'}
    </Button>
  );
}

export function GoogleButton() {
  return (
    <form action={continueWithGoogle}>
      <SubmitButton />
    </form>
  );
}
