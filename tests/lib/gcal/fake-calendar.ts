import type { CalendarApi, GoogleEventBody, RemoteEvent } from '@/lib/gcal/sync';

/** An in-memory Google Calendar that counts writes. */
export class FakeCalendar implements CalendarApi {
  events = new Map<string, GoogleEventBody | { summary: string; extendedProperties?: undefined }>();
  writes: string[] = [];
  calendars: string[] = [];
  private next = 1;

  async listEvents(): Promise<RemoteEvent[]> {
    return [...this.events.entries()].map(([id, e]) => ({
      id,
      runwayId: e.extendedProperties?.private.runwayId ?? null,
      runwayHash: e.extendedProperties?.private.runwayHash ?? null,
    }));
  }
  async insertEvent(_c: string, body: GoogleEventBody) {
    const id = `ev${this.next++}`;
    this.events.set(id, structuredClone(body));
    this.writes.push(`insert ${body.extendedProperties.private.runwayId}`);
    return id;
  }
  async updateEvent(_c: string, id: string, body: GoogleEventBody) {
    this.events.set(id, structuredClone(body));
    this.writes.push(`update ${body.extendedProperties.private.runwayId}`);
  }
  async deleteEvent(_c: string, id: string) {
    this.events.delete(id);
    this.writes.push(`delete ${id}`);
  }
  async createCalendar(name: string) {
    this.calendars.push(name);
    return `cal${this.calendars.length}`;
  }
  byRunwayId(runwayId: string): GoogleEventBody | undefined {
    for (const e of this.events.values()) {
      if (e.extendedProperties?.private.runwayId === runwayId) return e as GoogleEventBody;
    }
    return undefined;
  }
}
