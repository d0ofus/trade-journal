export const REPOSITORY_SAFETY_ALLOWLIST = Object.freeze([
  {
    ruleId: "financial-export-file",
    path: "fixtures/sample-ibkr-executions.csv",
    fileSha256: "f26371f050a43399c74e4175aface42e93cc1da010a74e04964db8ba749e8ded",
    reason: "Reviewed deterministic execution parser fixture.",
  },
  {
    ruleId: "financial-export-file",
    path: "fixtures/sample-ibkr-flex.csv",
    fileSha256: "584536724de696122e86a1258dff2d4c8a5e9aebbe8f2f2af6f33134fc987b9e",
    reason: "Reviewed deterministic sectioned Flex parser fixture.",
  },
  {
    ruleId: "financial-export-file",
    path: "fixtures/sample-ibkr-full-statement.csv",
    fileSha256: "b51347df6aec1879daecd9ffb283e3e08dbf7a8fedbce0e72de6d554935664a5",
    reason: "Reviewed deterministic BOS/HEADER/DATA Flex parser fixture.",
  },
  {
    ruleId: "financial-export-file",
    path: "fixtures/sample-ibkr-positions.csv",
    fileSha256: "0878db421da53485fd6e27218a7b7b17632252b2bda07b11f4af21563295c849",
    reason: "Reviewed deterministic position parser fixture.",
  },
  {
    ruleId: "financial-export-file",
    path: "fixtures/sample-ibkr-snapshots.csv",
    fileSha256: "1dddb57a64129ff50d6a7478b7c4a7b561bd11e3a0341a2a52e8fd936c75e5ba",
    reason: "Reviewed deterministic account snapshot parser fixture.",
  },
  {
    ruleId: "database-url",
    path: "src/lib/demo-seed-safety.test.ts",
    fileSha256: "2a2f98f5760b5c625e4e98cf5579b7c2f1baa731821a22e994927a61b5c85796",
    reason: "Reviewed reserved-host isolated-schema test URLs.",
  },
  {
    ruleId: "database-url",
    path: "src/lib/server/closed-trade-review-lock.test.ts",
    fileSha256: "566b7e90915474c2d5b738d7b4f3fd8d368c37e11d0c140d4979c13293e0a63a",
    reason: "Reviewed reserved-host lock test URLs.",
  },
  {
    ruleId: "database-url",
    path: "src/lib/server/execution-analytics-materialized.test.ts",
    fileSha256: "5e8bffbbb7589a5e6c245ad82f2f650455a47da285d26159ffcfb4c414530d79",
    reason: "Reviewed loopback and reserved-host materialization test URLs.",
  },
  {
    ruleId: "database-url",
    path: "src/lib/server/position-import-lock.test.ts",
    fileSha256: "42c4c401f534342d2bbca72cd4756744d8b22453da93ff28fad9a73db0a9cde7",
    reason: "Reviewed reserved-host import lock test URLs.",
  },
  {
    ruleId: "database-url",
    path: "src/lib/test-database-safety.test.ts",
    fileSha256: "b0ddacce0bb65a9a8d1c01d940feede1787db8282b83c79864fba2d1c6728e68",
    reason: "Reviewed database target validation fixtures.",
  },
  {
    ruleId: "opaque-binary-object",
    path: "src/app/favicon.ico",
    fileSha256: "2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932",
    reason: "Reviewed 32x32 application favicon.",
  },
]);
