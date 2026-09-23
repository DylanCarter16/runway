import Link from 'next/link';
import { serverEnv } from '@/env';

export const metadata = { title: 'Terms' };

export default function TermsPage() {
  const email = serverEnv.ALLOWED_EMAIL;
  return (
    <>
      <h1 className="text-2xl font-semibold">Terms</h1>
      <p>Runway is a personal app built for and used by one person, its owner. It is not offered to the public, and no one else can sign in.</p>
      <h2>Use at your own risk</h2>
      <p>
        Runway is provided as is, with no warranty of any kind. Dates it reads from course pages, pastes, and emails can be wrong or late. Always check the
        official course outline, LEARN, and Quest for deadlines and exam times. The owner is responsible for their own deadlines.
      </p>
      <h2>Data</h2>
      <p>
        How data is stored and used is described in the{' '}
        <Link href="/privacy" className="text-tie underline underline-offset-2">
          privacy page
        </Link>
        .
      </p>
      <h2>Contact</h2>
      <p>
        <a href={`mailto:${email}`} className="text-tie underline underline-offset-2">
          {email}
        </a>
      </p>
    </>
  );
}
