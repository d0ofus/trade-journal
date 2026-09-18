/** Word wrapping with character breaks for notes containing long unbroken strings. */
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
