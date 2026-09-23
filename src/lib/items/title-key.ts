/** "Assignment 3", "A3", and "a3" compare equal; so do "Quiz 2" and "Q2". */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bassignments?\s*#?\s*(\d+)/g, 'a$1')
    .replace(/\bquiz(?:zes)?\s*#?\s*(\d+)/g, 'q$1')
    .replace(/\bmidterm\s*(?:exam|test)?\s*#?\s*(\d+)/g, 'mt$1')
    .replace(/\bmidterm(?:\s*(?:exam|test))?\b/g, 'mt')
    .replace(/\bfinal(?:\s*exam(?:ination)?)?\b/g, 'final')
    .replace(/\bworkshop\s*#?\s*(\d+)/g, 'w$1')
    .replace(/[^a-z0-9]+/g, '');
}
