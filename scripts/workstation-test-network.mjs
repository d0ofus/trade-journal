// Used only by the disposable authenticated browser-test server.
// Keep its provider requests offline; NextAuth may call its own loopback endpoint.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("External HTTP is disabled for isolated workstation validation");
  }
  return originalFetch(input, init);
};
