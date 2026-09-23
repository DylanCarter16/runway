import 'server-only';
import { google } from 'googleapis';
import { serverEnv } from '@/env';
import type { CalendarApi, GoogleEventBody, RemoteEvent } from './sync';

// The live Google side: OAuth (docs/SETUP.md step 7) and the Calendar calls behind
// CalendarApi. Only the calendar.app.created scope: Runway can manage the calendar
// it creates and nothing else in Dylan's account.

export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

/** Thrown when the refresh token no longer works; the integration needs a reconnect. */
export class GoogleReauthError extends Error {
  constructor() {
    super('Google access was revoked or expired. Reconnect Google Calendar in Settings, Integrations.');
  }
}

/** Thrown when the Runway calendar was deleted in Google. */
export class CalendarGoneError extends Error {}

export function googleConfigured(): boolean {
  return Boolean(serverEnv.GOOGLE_CLIENT_ID && serverEnv.GOOGLE_CLIENT_SECRET);
}

function oauth(redirectUri?: string) {
  if (!googleConfigured()) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.');
  return new google.auth.OAuth2(serverEnv.GOOGLE_CLIENT_ID, serverEnv.GOOGLE_CLIENT_SECRET, redirectUri);
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  return oauth(redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GCAL_SCOPE],
    state,
  });
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<{ refreshToken: string; scopes: string[] }> {
  const { tokens } = await oauth(redirectUri).getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove Runway at https://myaccount.google.com/permissions and connect again.');
  }
  return {
    refreshToken: tokens.refresh_token,
    scopes: (tokens.scope ?? GCAL_SCOPE).split(' '),
  };
}

function status(e: unknown): number | undefined {
  const err = e as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
  };
  return err.response?.status ?? err.status ?? (typeof err.code === 'number' ? err.code : undefined);
}

export function isInvalidGrant(e: unknown): boolean {
  const err = e as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  return err?.response?.data?.error === 'invalid_grant' || /invalid_grant/.test(err?.message ?? '');
}

/** Maps Google errors to readable ones and never includes the token. */
async function call<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isInvalidGrant(e)) throw new GoogleReauthError();
    const s = status(e);
    const message = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(`Google Calendar ${what} failed${s ? ` (${s})` : ''}: ${message.slice(0, 300)}`), { status: s });
  }
}

export function googleCalendarApi(refreshToken: string): CalendarApi {
  const auth = oauth();
  auth.setCredentials({ refresh_token: refreshToken });
  const cal = google.calendar({ version: 'v3', auth });

  return {
    async listEvents(calendarId) {
      const out: RemoteEvent[] = [];
      let pageToken: string | undefined;
      do {
        const res = await call('list', () =>
          cal.events.list({
            calendarId,
            maxResults: 2500,
            pageToken,
            showDeleted: false,
            fields: 'nextPageToken,items(id,extendedProperties)',
          }),
        ).catch((e: { status?: number }) => {
          if (e.status === 404) throw new CalendarGoneError('The Runway calendar no longer exists.');
          throw e;
        });
        for (const ev of res.data.items ?? []) {
          if (!ev.id) continue;
          const p = ev.extendedProperties?.private ?? {};
          out.push({
            id: ev.id,
            runwayId: p.runwayId ?? null,
            runwayHash: p.runwayHash ?? null,
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async insertEvent(calendarId, body: GoogleEventBody) {
      const res = await call('insert', () => cal.events.insert({ calendarId, requestBody: body, fields: 'id' }));
      if (!res.data.id) throw new Error('Google Calendar insert returned no event id.');
      return res.data.id;
    },
    async updateEvent(calendarId, eventId, body: GoogleEventBody) {
      await call('update', () =>
        cal.events.update({
          calendarId,
          eventId,
          requestBody: body,
          fields: 'id',
        }),
      );
    },
    async deleteEvent(calendarId, eventId) {
      await call('delete', () => cal.events.delete({ calendarId, eventId })).catch((e: { status?: number }) => {
        // Already gone counts as deleted.
        if (e.status !== 404 && e.status !== 410) throw e;
      });
    },
    async createCalendar(name, timeZone) {
      const res = await call('create calendar', () =>
        cal.calendars.insert({
          requestBody: { summary: name, timeZone },
          fields: 'id',
        }),
      );
      if (!res.data.id) throw new Error('Google Calendar returned no calendar id.');
      return res.data.id;
    },
  };
}
