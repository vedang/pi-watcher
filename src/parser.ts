export type AiMarkerAction = "edit" | "ask" | "context";

export interface AiMarkerBlock {
  startLine: number;
  endLine: number;
  lines: string[];
}

export interface ParsedAiMarker {
  action: AiMarkerAction;
  block: AiMarkerBlock;
  commentPrefix: string;
  instruction: string;
  line: number;
  markerIntentInput: string;
  markerContextInput: string;
  markerText: string;
  normalizedBlock: string;
  path: string;
}

export interface ParseAiMarkersOptions {
  marker?: string;
  path?: string;
}

interface ParsedCommentLine {
  commentPrefix: string;
  commentPrefixKind: string;
  start: number;
  text: string;
}

const DEFAULT_MARKER = "AI";

function buildMarkerRegex(marker: string): RegExp {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)(${escaped}(?:[!?]|\.))(?=$|[^A-Za-z0-9_])`, "gi");
}

function normalizeCommentPrefix(prefix: string): string {
  return prefix.startsWith(";") ? ";" : prefix;
}

function makeParsedCommentLine(
  prefix: string,
  start: number,
  text: string,
): ParsedCommentLine {
  return {
    commentPrefix: prefix,
    commentPrefixKind: normalizeCommentPrefix(prefix),
    start,
    text: text.trim(),
  };
}

// [tag:line_comment_parsing] Cleanup mirrors these line-comment rules when
// removing handled watcher trigger comments after a run completes.
export function findLineComment(line: string): ParsedCommentLine | null {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "#") {
      return makeParsedCommentLine("#", i, line.slice(i + 1));
    }

    if (char === "/" && line[i + 1] === "/") {
      return makeParsedCommentLine("//", i, line.slice(i + 2));
    }

    if (char === "-" && line[i + 1] === "-") {
      return makeParsedCommentLine("--", i, line.slice(i + 2));
    }

    if (char === ";") {
      const prefixStart = i;
      let j = i;
      while (j < line.length && line[j] === ";") {
        j += 1;
      }

      const preceding = line.slice(0, prefixStart);
      // Allow semicolons when there is whitespace before them (e.g. "(foo) ; comment").
      // Only skip when the semicolons immediately follow non-whitespace with no separating space.
      if (preceding.trim() !== "" && !/\s$/.test(preceding)) {
        continue;
      }

      return makeParsedCommentLine(line.slice(i, j), i, line.slice(j));
    }
  }

  return null;
}

function markerActionFromText(markerText: string): AiMarkerAction {
  if (markerText.endsWith("!")) {
    return "edit";
  }

  if (markerText.endsWith("?")) {
    return "ask";
  }

  return "context";
}

function parseMarkerToken(
  text: string,
  markerPattern: RegExp,
): { markerText: string; action: AiMarkerAction } | null {
  const trimmedText = text.trim();
  let selectedMatch: RegExpExecArray | null = null;

  for (const match of trimmedText.matchAll(markerPattern)) {
    if (match.index === 0) {
      selectedMatch = match;
      break;
    }

    if (match.index + match[0].length === trimmedText.length) {
      selectedMatch = match;
    }
  }

  if (!selectedMatch) {
    return null;
  }

  const markerText = selectedMatch[2];
  return { markerText, action: markerActionFromText(markerText) };
}

export function parseAiMarkers(
  source: string,
  options: ParseAiMarkersOptions = {},
): ParsedAiMarker[] {
  const path = options.path ?? "";
  const markerPattern = buildMarkerRegex(options.marker ?? DEFAULT_MARKER);
  const lines = source.split(/\r\n|\n|\r/);
  const parsedLines = lines.map(findLineComment);

  const markers: ParsedAiMarker[] = [];

  for (let i = 0; i < parsedLines.length; i += 1) {
    const current = parsedLines[i];
    if (!current) {
      continue;
    }

    const markerResult = parseMarkerToken(current.text, markerPattern);
    if (!markerResult) {
      continue;
    }

    const { markerText, action } = markerResult;

    let start = i;
    while (
      start > 0 &&
      parsedLines[start - 1]?.commentPrefixKind === current.commentPrefixKind
    ) {
      start -= 1;
    }

    let end = i;
    while (
      end + 1 < parsedLines.length &&
      parsedLines[end + 1]?.commentPrefixKind === current.commentPrefixKind
    ) {
      end += 1;
    }

    const blockLines: string[] = [];
    for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
      const parsedLine = parsedLines[lineIndex];
      if (parsedLine) {
        blockLines.push(parsedLine.text);
      }
    }

    const instruction = current.text;
    const normalizedBlock = blockLines
      .map((value) => value.toLowerCase())
      .join("\n");
    const block: AiMarkerBlock = {
      startLine: start + 1,
      endLine: end + 1,
      lines: blockLines,
    };

    const markerIntentInput = `${path}\n${normalizedBlock}`;

    const contextSnippet = lines
      .slice(start, Math.min(lines.length, end + 2))
      .map((line) => line.trim())
      .join("\n");

    const markerContextInput = contextSnippet
      ? `${markerIntentInput}\n${contextSnippet}`
      : markerIntentInput;

    markers.push({
      action,
      block,
      commentPrefix: current.commentPrefix,
      instruction,
      line: i + 1,
      markerIntentInput,
      markerContextInput,
      markerText,
      normalizedBlock,
      path,
    });
  }

  return markers;
}
