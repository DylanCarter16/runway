// A made-up term so a fresh clone has something to load: fictional courses, staff, rooms,
// and dates (shaped like a Waterloo Fall 2026 term). No real Piazza ids, emails, or sections.
// Copy this file to src/config/term.local.ts to start your own (see term.template.ts).

import { COURSE_PALETTE, type SeedItem, type SeedTerm } from './term.template';

const TUTORIAL_ROOM = 'Room 105';
const TUTORIAL = `section 102, Fridays 2:30 to 3:20 pm, ${TUTORIAL_ROOM}`;

function workshop(n: number, date: string): SeedItem {
  return {
    sourceRef: `outline:math101:W${n}`,
    kind: 'tutorial',
    title: `Workshop ${n}`,
    date,
    time: '14:30',
    durationMinutes: 50,
    location: TUTORIAL_ROOM,
    description: `In your Friday tutorial: ${TUTORIAL}. Hand in the worksheet at the end.`,
  };
}

function quiz(n: number, date: string): SeedItem {
  return {
    sourceRef: `outline:math101:Q${n}`,
    kind: 'quiz',
    title: `Quiz ${n}`,
    date,
    time: '14:30',
    durationMinutes: 50,
    location: TUTORIAL_ROOM,
    weightPercent: 5,
    description: `Closed book, in your Friday tutorial: ${TUTORIAL}. Best 3 of 4 count.`,
  };
}

export const TERM_EXAMPLE: SeedTerm = {
  code: '1269',
  name: 'Fall 2026 (example)',
  startsOn: '2026-09-09',
  endsOn: '2026-12-23',
  timezone: 'America/Toronto',
  courses: [
    {
      code: 'MATH 101',
      slug: 'math101',
      title: 'Example Calculus',
      ...COURSE_PALETTE.teal,
      siteUrl: 'https://example.edu/math101',
      outlineUrl: null,
      submissionPlatforms: ['Crowdmark'],
      latePolicy: 'Late work is not accepted.',
      remarkPolicy: 'Ask for a remark within one week of the marks being returned.',
      aiPolicy: 'Generative AI may be used as a study aid. Work you hand in must be your own.',
      aiAllowed: true,
      gradingScheme: [
        { component: 'Workshops', weightPercent: 5 },
        { component: 'Quizzes (best 3 of 4)', weightPercent: 15 },
        { component: 'Midterm', weightPercent: 30 },
        { component: 'Final exam', weightPercent: 50 },
      ],
      staff: [{ name: 'Ada Example', role: 'Instructor', email: 'ada@example.edu', office: 'Room 210' }],
      officeHours: [{ who: 'Ada Example', when: 'Tuesdays 1:00 to 2:00 pm', where: 'Room 210' }],
      meetings: [
        { component: 'LEC', section: '001', classNumber: '1001', days: ['Mon', 'Wed'], startTime: '10:00', endTime: '11:20', location: 'Room 101', instructor: 'Ada Example', startsOn: '2026-09-09', endsOn: '2026-12-08' },
        { component: 'TUT', section: '102', classNumber: '1002', days: ['Fri'], startTime: '14:30', endTime: '15:20', location: TUTORIAL_ROOM, instructor: 'Ada Example', startsOn: '2026-09-09', endsOn: '2026-12-08' },
      ],
      checklist: ['Bring a calculator to quizzes and exams.'],
      infoNotes: 'Announcements are on LEARN.',
      learnNames: ['MATH 101', 'MATH101'],
      links: [
        { label: 'Course site', url: 'https://example.edu/math101', category: 'course_site', pinned: true },
        { label: 'Crowdmark', url: 'https://app.crowdmark.com/', category: 'submission' },
      ],
      watchedPages: [],
      seedItems: [
        workshop(1, '2026-09-18'),
        quiz(1, '2026-09-25'),
        { sourceRef: 'outline:math101:A1', kind: 'assignment', title: 'Assignment 1', date: '2026-10-02', time: '23:59', weightPercent: 0, description: 'Practice set, submitted on Crowdmark.' },
        {
          sourceRef: 'outline:math101:M1',
          kind: 'midterm',
          title: 'Midterm',
          date: '2026-10-08',
          time: '16:30',
          durationMinutes: 110,
          weightPercent: 30,
          description: 'Rooms and seats appear in Odyssey a few days before.',
        },
        quiz(2, '2026-10-30'),
        workshop(5, '2026-11-27'),
        { sourceRef: 'outline:math101:final', kind: 'final', title: 'Final exam', date: null, time: null, weightPercent: 50, flags: ['date_tba'] },
      ],
    },
    {
      code: 'CS 100',
      slug: 'cs100',
      title: 'Example Programming',
      ...COURSE_PALETTE.violet,
      siteUrl: 'https://example.edu/cs100',
      outlineUrl: null,
      submissionPlatforms: ['Marmoset'],
      latePolicy: 'Late work is not accepted.',
      remarkPolicy: null,
      aiPolicy: 'Generative AI is not permitted in this course, including running course materials through it.',
      aiAllowed: false,
      gradingScheme: [
        { component: 'Assignments', weightPercent: 40 },
        { component: 'Midterm', weightPercent: 20 },
        { component: 'Final exam', weightPercent: 40 },
      ],
      staff: [{ name: 'Grace Sample', role: 'Instructor', email: 'grace@example.edu' }],
      officeHours: [{ who: 'Course staff', when: 'Posted on the course site' }],
      meetings: [{ component: 'LEC', section: '001', classNumber: '2001', days: ['Tue', 'Thu'], startTime: '13:00', endTime: '14:20', location: 'Room 202', instructor: 'Grace Sample', startsOn: '2026-09-09', endsOn: '2026-12-08' }],
      checklist: [],
      infoNotes: null,
      learnNames: ['CS 100', 'CS100'],
      links: [{ label: 'Course site', url: 'https://example.edu/cs100', category: 'course_site', pinned: true }],
      watchedPages: [],
      seedItems: [
        { sourceRef: 'outline:cs100:A1', kind: 'assignment', title: 'A1', date: '2026-09-30', time: '17:00', weightPercent: 10 },
        { sourceRef: 'outline:cs100:A2', kind: 'assignment', title: 'A2', date: '2026-10-21', time: '17:00', weightPercent: 10 },
        { sourceRef: 'outline:cs100:midterm', kind: 'midterm', title: 'Midterm', date: '2026-11-10', time: '18:30', durationMinutes: 110, weightPercent: 20 },
        { sourceRef: 'outline:cs100:final', kind: 'final', title: 'Final exam', date: null, time: null, weightPercent: 40, flags: ['date_tba'] },
      ],
    },
    {
      code: 'PHYS 110',
      slug: 'phys110',
      title: 'Example Mechanics',
      ...COURSE_PALETTE.green,
      siteUrl: null,
      outlineUrl: null,
      submissionPlatforms: [],
      latePolicy: null,
      remarkPolicy: null,
      aiPolicy: 'The outline says nothing about generative AI, so it stays off until you decide.',
      aiAllowed: false,
      gradingScheme: [
        { component: 'Labs', weightPercent: 25 },
        { component: 'Final exam', weightPercent: 75 },
      ],
      staff: [],
      officeHours: [],
      meetings: [],
      checklist: [],
      infoNotes: null,
      learnNames: ['PHYS 110'],
      links: [],
      watchedPages: [],
      seedItems: [{ sourceRef: 'outline:phys110:lab1', kind: 'lab', title: 'Lab 1 report', date: '2026-10-05', time: '23:59', weightPercent: 5 }],
    },
  ],
  termItems: [
    { sourceRef: 'term:1269:reading-week', kind: 'break', title: 'Reading week', date: '2026-10-12', endDate: '2026-10-16', time: null },
    { sourceRef: 'term:1269:classes-end', kind: 'admin', title: 'Last day of classes', date: '2026-12-08', time: null },
  ],
  globalLinks: [
    {
      label: 'Odyssey exam schedule and seats',
      url: 'https://odyssey.uwaterloo.ca/teaching/schedule',
      category: 'exam',
      pinned: true,
      whereToFind: 'Seats appear a few days before each exam.',
    },
    { label: 'LEARN', url: 'https://learn.uwaterloo.ca/', category: 'lms' },
    { label: 'Quest', url: 'https://quest.pecs.uwaterloo.ca/', category: 'other' },
  ],
  piazzaClasses: [],
};
