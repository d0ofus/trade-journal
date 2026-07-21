export const PATH_RULES = Object.freeze([
  {
    id: "local-environment-file",
    test: (filePath) =>
      /(^|\/)\.env(?:\.[^/]+)?$/i.test(filePath) && !/(^|\/)\.env\.example$/i.test(filePath),
  },
  {
    id: "private-credential-file",
    test: (filePath) => /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(filePath),
  },
  {
    id: "opaque-archive",
    test: (filePath) => /\.(?:zip|7z|rar|tar|tgz|gz|bz2|xz|zst)$/i.test(filePath),
  },
  {
    id: "database-artifact",
    test: (filePath) =>
      /\.(?:(?:db|sqlite|sqlite3)(?:-(?:shm|wal|journal))?|dump|sql\.gz|bak|backup)$/i.test(filePath) ||
      (/\.sql$/i.test(filePath) && !/^prisma\/migrations\/[^/]+\/migration\.sql$/i.test(filePath)),
  },
  {
    id: "financial-export-file",
    test: (filePath) => /\.(?:csv|tsv|xls|xlsx)$/i.test(filePath),
  },
  {
    id: "generated-private-output",
    test: (filePath) =>
      /(^|\/)(?:backups|exports|screenshots|artifacts|test-results|playwright-report|blob-report|coverage|journal-screenshots)(\/|$)/i.test(
        filePath,
      ) || /(?:^|\/)(?:junit[^/]*\.xml|[^/]+\.har|[^/]+\.trace\.zip)$/i.test(filePath),
  },
  {
    id: "editor-private-state",
    test: (filePath) => /(^|\/)(?:\.vscode|\.idea)(\/|$)/i.test(filePath),
  },
  {
    id: "application-backup-export",
    test: (filePath) => /(^|\/)trade-journal-backup-[^/]+\.json$/i.test(filePath),
  },
]);

export const CONTENT_RULES = Object.freeze([
  {
    id: "brokerage-account-id",
    pattern: /\b(?:DU|U|F|D|M|I|H)\d{6,12}\b/g,
  },
  {
    id: "private-key-block",
    pattern: /-----BEGIN (?:[A-Z0-9]+(?: [A-Z0-9]+)* )?PRIVATE KEY-----/g,
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "provider-secret-token",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "jwt-token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "bearer-credential",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
  },
  {
    id: "webhook-secret-url",
    pattern: /https?:\/\/(?:hooks\.slack\.com\/services|(?:canary\.)?discord(?:app)?\.com\/api\/webhooks)\/[^\s"'`<>]+/gi,
  },
  {
    id: "hardcoded-secret-assignment",
    pattern: /\b(?:aws_secret_access_key|r2_secret_access_key|client_secret|api[_-]?secret|api[_-]?token|access[_-]?token|password)\s*[:=]\s*["'][^"'\r\n]{12,}["']/gi,
    allowMatch: (value) => /(?:test|demo|fake|mock|example|placeholder|redacted|change[-_ ]?me)/i.test(value),
  },
  {
    id: "database-url",
    pattern: /\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/gi,
  },
  {
    id: "sensitive-query-parameter",
    pattern: /https?:\/\/[^\s"'`<>]+[?&](?:token|secret|signature|api[_-]?key|access[_-]?key)=[^&\s"'`<>]+/gi,
  },
  {
    id: "personal-user-path",
    pattern: /(?:[A-Za-z]:\\Users\\[^\\\s"'`<>]+|\/Users\/[^/\s"'`<>]+)/g,
  },
  {
    id: "private-document-url",
    pattern: /https?:\/\/(?:www\.)?(?:notion\.so|notion\.site|docs\.google\.com|drive\.google\.com|1drv\.ms|[^/\s]+\.sharepoint\.com)\/[^\s"'`<>]+/gi,
  },
  {
    id: "email-address",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    allowMatch: (value) =>
      /@(?:example\.(?:com|test)|example\.invalid|test\.invalid|(?:[A-Za-z0-9-]+\.)*example)$/i.test(value),
  },
]);

export const SECRET_ENVIRONMENT_NAME = /(?:SECRET|TOKEN|PASSWORD|PASSCODE|PRIVATE_KEY|ACCESS_KEY(?:_ID)?|API_KEY(?:_ID)?|CLIENT_SECRET)$/i;
