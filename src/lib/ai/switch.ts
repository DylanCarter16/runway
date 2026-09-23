// The course AI switch (CLAUDE.md, AI rules). CS 245, CS 246, and CS 251 ban
// generative AI, so nothing from those courses may reach Claude. callClaude()
// only accepts an AiClearance, and assertAiAllowed() is the only way to get one.

export class AiNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiNotAllowedError';
  }
}

declare const clearanceBrand: unique symbol;

export interface AiClearance {
  readonly courseId: string;
  readonly courseCode: string;
  readonly [clearanceBrand]: true;
}

export interface CourseSwitch {
  id: string;
  code: string;
  ai_allowed: boolean;
}

export type CourseLookup = (courseId: string) => Promise<CourseSwitch | null>;

/**
 * Throws unless the course exists and its AI switch is on. Content with no
 * course waits until Dylan picks one, so a null course throws too.
 */
export async function assertAiAllowed(lookup: CourseLookup, courseId: string | null | undefined): Promise<AiClearance> {
  if (!courseId) throw new AiNotAllowedError('This content has no course, so it is not sent to Claude.');
  const course = await lookup(courseId);
  if (!course) throw new AiNotAllowedError('Unknown course.');
  if (!course.ai_allowed) {
    throw new AiNotAllowedError(`${course.code} has AI turned off, so its content is not sent to Claude.`);
  }
  return { courseId: course.id, courseCode: course.code } as AiClearance;
}

/** Same check without throwing, for code paths that store instead of extracting. */
export async function aiAllowed(lookup: CourseLookup, courseId: string | null | undefined): Promise<AiClearance | null> {
  try {
    return await assertAiAllowed(lookup, courseId);
  } catch (e) {
    if (e instanceof AiNotAllowedError) return null;
    throw e;
  }
}
