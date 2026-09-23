import type { MeetingJson } from '@/lib/sources/quest';

// Proposal payloads. Syncs (Phase 2) write create_item as {source, source_ref, item}
// and update_item as {source, source_ref, title, changes}; pastes use the same
// shapes with source 'paste', so the review queue renders and applies both.

export type ProposalKind = 'create_item' | 'update_item' | 'course_info' | 'link' | 'meeting' | 'grade' | 'other';

/** Item columns a proposal may set. */
export interface ItemFields {
  course_id?: string | null;
  kind?: string;
  title?: string;
  description?: string | null;
  due_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  all_day?: boolean;
  time_known?: boolean;
  location?: string | null;
  seat?: string | null;
  weight_percent?: number | null;
  source_url?: string | null;
  flags?: string[];
}

export interface CreateItemPayload {
  source: string;
  source_ref?: string;
  item: ItemFields;
}

export interface UpdateItemPayload {
  source: string;
  source_ref?: string;
  /** The target item's title when the proposal was made. */
  title: string;
  changes: ItemFields;
  /** The target's values for the changed fields, for the before and after view. */
  before?: ItemFields;
}

export const COURSE_INFO_FIELDS = [
  'late_policy', 'remark_policy', 'ai_policy', 'submission_platforms', 'info_notes', 'grading_scheme', 'staff', 'office_hours',
] as const;
export type CourseInfoField = (typeof COURSE_INFO_FIELDS)[number];

export interface GradeComponent {
  component: string;
  weight_percent: number | null;
  notes: string | null;
}

export interface StaffEntry {
  name: string;
  role: string;
  email: string | null;
  office: string | null;
  notes: string | null;
}

export interface OfficeHoursEntry {
  who: string;
  when: string;
  where: string | null;
}

export type CourseInfoPayload =
  | { field: 'late_policy' | 'remark_policy' | 'ai_policy'; value: string }
  | { field: 'submission_platforms'; value: string[] }
  /** Appended to courses.info_notes under the heading. */
  | { field: 'info_notes'; heading: string; value: string }
  | { field: 'grading_scheme'; value: GradeComponent[] }
  | { field: 'staff'; value: StaffEntry[] }
  | { field: 'office_hours'; value: OfficeHoursEntry[] };

export interface MeetingPayload {
  course_code: string;
  meetings: MeetingJson[];
}

export interface GradePayload {
  label: string;
  score: number | null;
  out_of: number | null;
  item_id: string | null;
}

export interface PlannedProposal {
  course_id: string | null;
  kind: ProposalKind;
  target_item_id: string | null;
  payload: CreateItemPayload | UpdateItemPayload | CourseInfoPayload | MeetingPayload | GradePayload;
  evidence: string | null;
  confidence: number | null;
}

/** What the planner knows about a course. */
export interface CourseCtx {
  id: string;
  slug: string;
  code: string;
  title: string;
  ai_allowed: boolean;
  meetings: unknown;
}

/** What the planner knows about an existing item. */
export interface ItemCtx {
  id: string;
  course_id: string | null;
  kind: string;
  title: string;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  time_known: boolean;
  location: string | null;
  seat: string | null;
  weight_percent: number | null;
  state: string;
}
