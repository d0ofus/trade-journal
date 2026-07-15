export const DEMO_ACCOUNT_ID = "demo-account-workstation";
export const DEMO_ACCOUNT_CODE = "DEMO-WORKSTATION";
export const DEMO_SYMBOLS = ["DEMOA", "DEMOB", "DEMOC"] as const;

export function isE2eDemoOnlyWritesEnabled() {
  return process.env.E2E_DEMO_ONLY_WRITES === "1";
}

export function isDemoAccountCode(value: string | null | undefined) {
  return value === DEMO_ACCOUNT_CODE;
}
