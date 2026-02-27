import fs from "node:fs";
import path from "node:path";
import { parseCsvWithMapping, previewCsv } from "@/lib/import/ibkr-parser";

describe("IBKR parser", () => {
  it("detects and parses execution csv", () => {
    const csv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-executions.csv"), "utf-8");
    const preview = previewCsv("sample-ibkr-executions.csv", csv);

    expect(preview.kind).toBe("executions");
    expect(preview.errors).toHaveLength(0);

    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);
    expect(parsed.executions).toHaveLength(5);
    expect(parsed.executions[0].symbol).toBe("SPY");
  });

  it("parses positions and snapshots", () => {
    const posCsv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-positions.csv"), "utf-8");
    const snapCsv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-snapshots.csv"), "utf-8");

    const posPreview = previewCsv("sample-ibkr-positions.csv", posCsv);
    const snapPreview = previewCsv("sample-ibkr-snapshots.csv", snapCsv);

    const positions = parseCsvWithMapping("positions", posCsv, posPreview.mapping);
    const snapshots = parseCsvWithMapping("snapshots", snapCsv, snapPreview.mapping);

    expect(positions.positions[0].symbol).toBe("TSLA");
    expect(snapshots.snapshots).toHaveLength(3);
  });
});
