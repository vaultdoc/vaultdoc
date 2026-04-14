/**
 * Check if an IPv4 address is within a CIDR range or exactly matches a plain IP.
 */
export function isInSubnet(ip: string, cidrOrIp: string): boolean {
  if (!cidrOrIp.includes("/")) return ip === cidrOrIp;

  const [range, bits] = cidrOrIp.split("/");
  const prefixLen = parseInt(bits, 10);
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;

  const ipNum = ipToInt(ip);
  const rangeNum = ipToInt(range);
  if (ipNum === null || rangeNum === null) return false;

  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
