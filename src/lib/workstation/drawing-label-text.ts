/** Word wrapping with character breaks for notes containing long unbroken strings. */
export function createDrawingTextCache(limit = 256) {
  const cache = new Map<string, string[]>();
  return (text: string, width: number, font: string, measure: (text: string) => number) => {
    const key = JSON.stringify([font, width, text]);
    let lines = cache.get(key);
    if (!lines) { lines = wrapDrawingText(text, width, measure); cache.set(key, lines); if (cache.size > limit) cache.delete(cache.keys().next().value!); }
    // Callers truncate labels to available height; never mutate cached lines.
    return lines.slice();
  };
}

export function wrapDrawingText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.trim().split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const character of word) {
        if (line && measure(line + character) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function ellipsizeDrawingText(text: string, width: number, measure: (text: string) => number): string {
  const characters = Array.from(text);
  while (characters.length && measure(characters.join("") + "…") > width) characters.pop();
  return characters.join("") + "…";
}
