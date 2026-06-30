/**
 * Resolve a host that a *different device* (a customer's phone) can actually
 * reach. When the operator opened admin at localhost, the request host is
 * useless for a QR — swap in the machine's LAN IPv4, keeping the port.
 *
 * In production, set APP_BASE_URL (e.g. https://trade.myshop.com) and that
 * wins outright.
 */
import os from "node:os";

// Virtual adapters (WSL, Docker, Hyper-V, VPNs) hand out IPv4s a phone on the
// real wifi can't reach — push them to the back.
const VIRTUAL_IFACE = /wsl|hyper-?v|vethernet|docker|virtualbox|vmware|loopback|tailscale|zerotier/i;

/** Score an address: typical home-LAN ranges first, virtual ranges last. */
function score(name: string, addr: string): number {
  let s = 0;
  if (addr.startsWith("192.168.")) s += 100;
  else if (addr.startsWith("10.")) s += 80;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) s += 20; // often Docker/WSL
  else s += 40;
  if (VIRTUAL_IFACE.test(name)) s -= 1000;
  return s;
}

function firstLanIPv4(): string | null {
  const candidates: { name: string; addr: string }[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal) {
        candidates.push({ name, addr: ni.address });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => score(b.name, b.addr) - score(a.name, a.addr));
  return candidates[0].addr;
}

/** A base URL reachable from another device, or null if none can be formed. */
export function reachableBaseUrl(
  requestHost: string | null,
  proto: string,
): string | null {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (!requestHost) return null;

  const [hostname, port] = requestHost.split(":");
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `${proto}://${requestHost}`;
  }
  const ip = firstLanIPv4();
  if (!ip) return null; // localhost only — no LAN address to offer
  return `${proto}://${port ? `${ip}:${port}` : ip}`;
}
