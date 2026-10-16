import { describe, expect, it } from "vitest";
import { encodeEvent, parseCommand } from "./protocol.js";

describe("serve protocol", () => {
  it("encodes one JSON object per line", () => {
    expect(encodeEvent({ type: "hello", version: "0.1.6" })).toBe('{"type":"hello","version":"0.1.6"}\n');
  });

  it("parses known commands and rejects the rest", () => {
    expect(parseCommand('{"type":"rerun","repo":"/r","pipelineId":"1"}')).toEqual({ type: "rerun", repo: "/r", pipelineId: "1" });
    expect(parseCommand("not json")).toBeNull();
    expect(parseCommand('{"type":"explode"}')).toBeNull();
    expect(parseCommand('{"type":"rerun","repo":"/r"}')).toBeNull(); // missing pipelineId
  });
});
