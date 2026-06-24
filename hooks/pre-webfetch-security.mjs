#!/usr/bin/env node
// PreToolUse hook (matcher: WebFetch) — SSRF protection for the research
// agent's web access. Parses the requested URL, resolves
// its hostname to IP address(es), and blocks the request if any resolved
// address falls in a private/link-local/loopback range or the cloud
// metadata address — without this, a `researcher` agent following a
// redirect or a crafted URL could reach internal services or
// 169.254.169.254 (AWS/GCP/Azure instance metadata) and exfiltrate
// credentials.
//
// This is a defense-in-depth check, not a full proxy: it only inspects the
// URL string handed to the WebFetch tool call, not what a redirect chain
// resolves to after the fact. DNS rebinding between this check and the
// actual fetch is a known residual risk; treat this as raising the bar, not
// eliminating it entirely.
//
// Respects RIGBENCH_DISABLED_HOOKS=pre-webfetch-security to skip entirely.
//
// Stdin: JSON with tool_name and tool_input.url
// Exit 0 = allow  |  Exit 2 = block (stdout shown to Claude as error)

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readStdinJson, repoRoot, block, allow, runHook } from './lib/hook-utils.mjs';

const HOOK_NAME = 'pre-webfetch-security';
const input = readStdinJson();
const root = repoRoot(import.meta.url);

// Private/reserved IPv4 ranges, plus the cloud metadata address. IPv6
// equivalents (loopback, unique-local, link-local) are included since
// Node's DNS lookup can return either family.
function isPrivateOrReservedIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — includes AWS/GCP/Azure metadata (169.254.169.254)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateOrReservedIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique-local
  if (normalized.startsWith('fe80')) return true; // fe80::/10 link-local
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — recheck the embedded IPv4 address.
    return isPrivateOrReservedIPv4(normalized.replace('::ffff:', ''));
  }
  return false;
}

function isPrivateOrReserved(ip) {
  return isIP(ip) === 6 ? isPrivateOrReservedIPv6(ip) : isPrivateOrReservedIPv4(ip);
}

runHook(HOOK_NAME, 'PreToolUse', root, input.tool_name, async () => {
  if (input.tool_name !== 'WebFetch') allow();

  const rawUrl = input.tool_input?.url || '';
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    block('by pre-webfetch-security hook: URL could not be parsed.', rawUrl);
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    block(`by pre-webfetch-security hook: protocol '${parsed.protocol}' is not allowed — only http/https.`, rawUrl);
    return;
  }

  const hostname = parsed.hostname;

  // A literal IP in the URL skips DNS entirely — check it directly.
  if (isIP(hostname)) {
    if (isPrivateOrReserved(hostname)) {
      block(`by pre-webfetch-security hook: '${hostname}' is a private/reserved IP address — blocked to prevent SSRF.`, rawUrl);
      return;
    }
    allow();
    return;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    block(`by pre-webfetch-security hook: could not resolve hostname '${hostname}'.`, rawUrl);
    return;
  }

  const blockedAddress = addresses.find((entry) => isPrivateOrReserved(entry.address));
  if (blockedAddress) {
    block(
      `by pre-webfetch-security hook: '${hostname}' resolves to ${blockedAddress.address}, a private/reserved IP address — blocked to prevent SSRF (includes cloud metadata endpoints like 169.254.169.254).`,
      rawUrl
    );
    return;
  }

  allow();
});
