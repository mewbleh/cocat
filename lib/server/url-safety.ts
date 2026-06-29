import dns from "node:dns/promises";
import net from "node:net";

import { CoCatError } from "@/lib/server/errors";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
export type ResolveHostname = (hostname: string) => Promise<string[]>;

export type UrlSafetyOptions = {
  resolveHostname?: ResolveHostname;
};

export type PublicUrlResolution = {
  url: URL;
  address: string;
  family: 4 | 6;
};

const blockedAddresses = createBlockedAddressList();

export async function validatePublicUrl(input: string, options: UrlSafetyOptions = {}) {
  const resolution = await resolvePublicUrl(input, options);
  return resolution.url;
}

export async function resolvePublicUrl(input: string, options: UrlSafetyOptions = {}): Promise<PublicUrlResolution> {
  let url: URL;

  try {
    url = new URL(input);
  } catch (error) {
    throw new CoCatError("INVALID_URL", "Enter a complete public URL.", error);
  }

  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new CoCatError("INVALID_URL", "Only http and https URLs are supported.");
  }

  if (url.username || url.password) {
    throw new CoCatError("INVALID_URL", "URLs with embedded credentials are not supported.");
  }

  if (!url.hostname) {
    throw new CoCatError("INVALID_URL", "The URL is missing a hostname.");
  }

  const address = await resolvePublicHostname(url.hostname, options.resolveHostname);
  const family = net.isIP(address);

  if (family !== 4 && family !== 6) {
    throw new CoCatError("PRIVATE_NETWORK_BLOCKED", "CoCat only accepts public web URLs.");
  }

  return { url, address, family };
}

async function resolvePublicHostname(hostname: string, resolveHostname = defaultResolveHostname) {
  const decodedHostname = normalizeHostname(hostname);
  const directIpVersion = net.isIP(decodedHostname);
  const addresses = directIpVersion ? [decodedHostname] : await resolveHostname(decodedHostname);

  if (addresses.length === 0 || addresses.some((address) => isBlockedIpAddress(address))) {
    throw new CoCatError("PRIVATE_NETWORK_BLOCKED", "CoCat only accepts public web URLs.");
  }

  return addresses[0];
}

async function defaultResolveHostname(hostname: string) {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch (error) {
    throw new CoCatError("INVALID_URL", "The hostname could not be resolved.", error);
  }
}

export function isBlockedIpAddress(address: string) {
  const normalizedAddress = normalizeHostname(address);
  const ipVersion = net.isIP(normalizedAddress);

  if (ipVersion !== 4 && ipVersion !== 6) {
    return true;
  }

  return blockedAddresses.check(normalizedAddress, ipVersion === 4 ? "ipv4" : "ipv6");
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function createBlockedAddressList() {
  const blockList = new net.BlockList();

  blockList.addSubnet("0.0.0.0", 8, "ipv4");
  blockList.addSubnet("10.0.0.0", 8, "ipv4");
  blockList.addSubnet("100.64.0.0", 10, "ipv4");
  blockList.addSubnet("127.0.0.0", 8, "ipv4");
  blockList.addSubnet("169.254.0.0", 16, "ipv4");
  blockList.addSubnet("172.16.0.0", 12, "ipv4");
  blockList.addSubnet("192.0.0.0", 24, "ipv4");
  blockList.addSubnet("192.0.2.0", 24, "ipv4");
  blockList.addSubnet("192.88.99.0", 24, "ipv4");
  blockList.addSubnet("192.168.0.0", 16, "ipv4");
  blockList.addSubnet("198.18.0.0", 15, "ipv4");
  blockList.addSubnet("198.51.100.0", 24, "ipv4");
  blockList.addSubnet("203.0.113.0", 24, "ipv4");
  blockList.addSubnet("224.0.0.0", 4, "ipv4");
  blockList.addSubnet("240.0.0.0", 4, "ipv4");
  blockList.addAddress("255.255.255.255", "ipv4");

  blockList.addAddress("::", "ipv6");
  blockList.addAddress("::1", "ipv6");
  blockList.addSubnet("64:ff9b::", 96, "ipv6");
  blockList.addSubnet("100::", 64, "ipv6");
  blockList.addSubnet("2001::", 32, "ipv6");
  blockList.addSubnet("2001:db8::", 32, "ipv6");
  blockList.addSubnet("2002::", 16, "ipv6");
  blockList.addSubnet("fc00::", 7, "ipv6");
  blockList.addSubnet("fe80::", 10, "ipv6");
  blockList.addSubnet("ff00::", 8, "ipv6");

  return blockList;
}
