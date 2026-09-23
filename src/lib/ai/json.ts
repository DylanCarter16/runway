/** JSON.parse for model text that may be wrapped in a Markdown code fence. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}
