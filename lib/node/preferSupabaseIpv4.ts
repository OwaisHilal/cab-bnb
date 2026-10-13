import dns from "node:dns";

const SUPABASE_HOST_SUFFIX = ".supabase.co";
const PUBLIC_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"];
const PUBLIC_DNS_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 60_000;
const PATCH_FLAG = Symbol.for("kmr.preferSupabaseIpv4");

let applied = false;
const ipv4Cache = new Map<string, { addresses: string[]; expiresAt: number }>();
const originalLookup = dns.lookup.bind(dns) as (...args: unknown[]) => void;
const publicResolver = new dns.Resolver();
publicResolver.setServers(PUBLIC_DNS_SERVERS);

// `dns.lookup`'s real type is a union of several incompatible overloads
// (bare family number, options object, bare callback, etc. — see
// node_modules/@types/node/dns.d.ts). Modeling our single implementation
// against that whole union defeats TypeScript's overload checking, so we
// deliberately keep the implementation loosely typed and only assert the
// final exported shape against `typeof dns.lookup` once, at the patch site.
type LoadingLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

const finishLookup = (options: dns.LookupOptions, callback: LoadingLookupCallback, addresses: string[]) => {
  if (options.all) {
    callback(
      null,
      addresses.map((address) => ({ address, family: 4 })),
    );
    return;
  }
  callback(null, addresses[0], 4);
};

const resolvePublicIpv4 = (hostname: string, callback: (addresses: string[] | null) => void) => {
  const cached = ipv4Cache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    callback(cached.addresses);
    return;
  }

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    publicResolver.cancel();
    callback(null);
  }, PUBLIC_DNS_TIMEOUT_MS);

  publicResolver.resolve4(hostname, (error, addresses) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error || !addresses?.length) {
      callback(null);
      return;
    }
    ipv4Cache.set(hostname, { addresses, expiresAt: Date.now() + CACHE_TTL_MS });
    callback(addresses);
  });
};

/**
 * Node's `fetch` (undici) can fail with `TypeError: fetch failed` on Windows
 * networks that only return DNS64/NAT64 AAAA records for `*.supabase.co`
 * (common on phone hotspots). OS IPv4 lookups time out; public resolvers
 * still return A records, and connecting to those IPv4 addresses works.
 *
 * Scoped to Supabase hosts so other DNS is unchanged. Falls back to the
 * original lookup if public DNS fails, and ignores the rare bare-`family`
 * or no-options call shapes (ours is the only caller that matters here —
 * undici always calls with an options object).
 */
export const preferSupabaseIpv4 = (): void => {
  if (applied || PATCH_FLAG in dns.lookup) {
    applied = true;
    return;
  }
  applied = true;

  const patchedLookup = (hostname: unknown, optionsOrCallback: unknown, maybeCallback?: unknown): void => {
    const isOptionsObject = typeof optionsOrCallback === "object" && optionsOrCallback !== null;
    const options: dns.LookupOptions = isOptionsObject ? (optionsOrCallback as dns.LookupOptions) : {};
    const callback = (
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
    ) as LoadingLookupCallback | undefined;

    if (typeof hostname !== "string" || !hostname.endsWith(SUPABASE_HOST_SUFFIX) || typeof callback !== "function") {
      originalLookup(hostname, optionsOrCallback, maybeCallback);
      return;
    }

    resolvePublicIpv4(hostname, (addresses) => {
      if (!addresses?.length) {
        originalLookup(hostname, optionsOrCallback, maybeCallback);
        return;
      }
      finishLookup(options, callback, addresses);
    });
  };

  Object.defineProperty(patchedLookup, PATCH_FLAG, { value: true });
  dns.lookup = patchedLookup as unknown as typeof dns.lookup;
};
