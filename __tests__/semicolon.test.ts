import { parseAiMarkers } from "../src/parser";

describe("semicolon inline comments", () => {
  it("detects semicolon comments that are separated by whitespace after code", () => {
    const src = "(foo) ; explain AI?\n";
    const markers = parseAiMarkers(src);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ action: "ask", line: 1 });
  });

  it("does not treat semicolons glued to code as comments", () => {
    const src = "foo;notacomment AI?\n";
    const markers = parseAiMarkers(src);
    expect(markers).toHaveLength(0);
  });
});
