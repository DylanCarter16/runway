import { formatListDate, formatWhen } from '@/lib/time';
import { sourceLabel } from './labels';

export interface ChangeLine {
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string | null;
}

const DATE_FIELDS = new Set(['due_at', 'starts_at', 'ends_at']);

/** "CS 251 A2 moved from Fri, Oct 23 to Mon, Oct 26, from CS 251 schedule page". */
export function describeChange(name: string, c: ChangeLine): string {
  const from = c.source ? `, from ${sourceLabel(c.source)}` : '';
  if (DATE_FIELDS.has(c.field)) {
    const verb = c.field === 'due_at' ? 'moved' : c.field === 'starts_at' ? 'start moved' : 'end moved';
    if (!c.old_value) return `${name} got a date: ${c.new_value ? formatListDate(new Date(c.new_value)) : 'none'}${from}`;
    if (!c.new_value) return `${name} lost its date${from}`;
    return `${name} ${verb} from ${formatWhen(new Date(c.old_value), true)} to ${formatWhen(new Date(c.new_value), true)}${from}`;
  }
  if (c.field === 'state') return `${name} ${c.new_value === 'dismissed' ? 'was dismissed' : 'was restored'}${from}`;
  if (c.field === 'progress') return `${name} marked ${c.new_value}${from}`;
  if (c.field === 'source_missing_at') {
    return c.new_value ? `${name} no longer appears on its source${from}` : `${name} is back on its source${from}`;
  }
  const label = c.field.replace(/_/g, ' ').replace(' percent', '');
  return `${name} ${label} changed from ${c.old_value ?? 'none'} to ${c.new_value ?? 'none'}${from}`;
}
