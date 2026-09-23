import { serverEnv } from '@/env';

export const metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  const email = serverEnv.ALLOWED_EMAIL;
  return (
    <>
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p>
        Runway is a personal course tracker used by one person, its owner. Only the owner&apos;s email address can sign in. There are no other users and no
        accounts to sign up for.
      </p>
      <h2>What Runway stores</h2>
      <ul>
        <li>Course deadlines, exams, links, lecture notes, and text the owner pastes in.</li>
        <li>Public course web pages it checks for changes.</li>
        <li>If the owner connects Google Calendar, a token that lets Runway manage one calendar it creates, named Runway. It cannot read or change other calendars.</li>
      </ul>
      <h2>Where it is kept</h2>
      <p>
        Data is stored in a Supabase database, and dated items are copied to the owner&apos;s Google Calendar. The app runs on Vercel. For courses whose AI
        switch is on, notes and pastes are sent to Anthropic&apos;s Claude API to be cleaned up and indexed; courses with the switch off are never sent.
      </p>
      <h2>Sharing</h2>
      <p>Runway does not sell, share, or show this data to anyone else, and it has no ads or analytics.</p>
      <h2>Deleting data</h2>
      <p>
        The owner can delete items and notes in the app, disconnect Google Calendar in Settings, or revoke access at myaccount.google.com. Deleting the
        account removes everything in the database.
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
