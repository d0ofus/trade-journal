import { afterEach, describe, expect, it, vi } from "vitest";
import { readFingerprint, written, type VerificationState } from "./notion-block-verification";
import { jsonHash, NotionError, type RemoteBlock } from "./notion-client";

const remote = vi.hoisted(() => ({ request: vi.fn(), children: vi.fn() }));
vi.mock("./notion-client", async original => ({ ...await original<typeof import("./notion-client")>(), notionRequest: remote.request, notionChildren: remote.children }));
const node = (id: string, children = false): RemoteBlock => ({ id, type: "paragraph", paragraph: { rich_text: [{ text: { content: id } }] }, has_children: children });
afterEach(() => vi.clearAllMocks());

describe("durable subtree verification", () => {
  it("resumes inside a subtree after a bounded pause and preserves the original fingerprint format", async () => {
    const root = node("root", true), first = node("first", true), leaf = node("leaf"), nested = node("nested");
    remote.request.mockResolvedValue(root);
    let paused = false;
    remote.children.mockImplementation(async (id: string) => {
      if (id === "root") return [first, leaf];
      if (!paused) { paused = true; throw new NotionError("Budget pause", 429, undefined, false, "budget"); }
      return [nested];
    });
    let cursors: VerificationState = {};
    await expect(readFingerprint("root", true, cursors)).rejects.toMatchObject({ reason: "budget" });
    cursors = JSON.parse(JSON.stringify(cursors));
    const fingerprint = await readFingerprint("root", true, cursors);
    expect(fingerprint).toBe(jsonHash({ ...written(root), children: [{ ...written(first), children: [written(nested)] }, written(leaf)] }));
    expect(remote.request).toHaveBeenCalledTimes(1);
    expect(remote.children.mock.calls.filter(([id]) => id === "root")).toHaveLength(1);
  });
  it("ignores signed file query strings but detects a different image identity", async () => {
    const image = { id: "image", type: "image", image: { caption: [], file: { url: "https://files.notion.so/original.png?v=one" } } };
    remote.request.mockResolvedValue(image);
    const first = await readFingerprint("image", true);
    image.image.file.url = "https://files.notion.so/original.png?v=two";
    expect(await readFingerprint("image", true)).toBe(first);
    image.image.file.url = "https://files.notion.so/replacement.png?v=two";
    expect(await readFingerprint("image", true)).not.toBe(first);
  });
});
