export interface TransportSecurityInfo {
  isTls: boolean;
  isLanHost: boolean;
  showInsecureTransportWarning: boolean;
  protocol: string;
  host: string;
}

function parseForwardedProto(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const protoMatch = headerValue.match(/proto=([^;,\s]+)/i);
  return protoMatch?.[1]?.toLowerCase() ?? null;
}

function normalizeProto(proto: string | null): string | null {
  if (!proto) {
    return null;
  }

  const normalized = proto.toLowerCase();
  if (normalized === "https" || normalized === "wss") {
    return "https";
  }

  if (normalized === "http" || normalized === "ws") {
    return "http";
  }

  return null;
}

function isLanHost(hostname: string): boolean {
  if (hostname.startsWith("192.168.")) {
    return true;
  }

  if (hostname.startsWith("10.")) {
    return true;
  }

  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) {
    return false;
  }

  const segment = Number(match[1]);
  return Number.isInteger(segment) && segment >= 16 && segment <= 31;
}

/**
 * 將 IPv4 CIDR 字串解析成網路位址與遮罩的整數表示。
 * 格式：「a.b.c.d/prefix」或「a.b.c.d」（省略 prefix 視為 /32）。
 */
function parseCidr(cidr: string): { network: number; mask: number } | null {
  const [ipPart, prefixPart] = cidr.split("/");
  const prefix = prefixPart === undefined ? 32 : parseInt(prefixPart, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const segments = ipPart.split(".");
  if (segments.length !== 4) {
    return null;
  }

  let network = 0;
  for (const seg of segments) {
    const n = parseInt(seg, 10);
    if (isNaN(n) || n < 0 || n > 255) {
      return null;
    }
    network = (network << 8) | n;
  }

  // JavaScript 的位元運算為 32 位元有號整數，需轉成無號整數
  network = network >>> 0;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: network & mask, mask };
}

/**
 * 判斷 IPv4 字串是否落在指定 CIDR 範圍內。
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) {
    return false;
  }

  const segments = ip.split(".");
  if (segments.length !== 4) {
    return false;
  }

  let ipInt = 0;
  for (const seg of segments) {
    const n = parseInt(seg, 10);
    if (isNaN(n) || n < 0 || n > 255) {
      return false;
    }
    ipInt = (ipInt << 8) | n;
  }
  ipInt = ipInt >>> 0;

  return (ipInt & parsed.mask) === parsed.network;
}

/**
 * 讀取 TRUST_PROXY 環境變數，回傳以逗號分隔的 IP / CIDR 白名單陣列。
 * 預設空陣列（不信任任何代理）。
 */
function parseTrustProxyEnv(): string[] {
  const raw = process.env.TRUST_PROXY ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 判斷指定來源 IP 是否落在 TRUST_PROXY 白名單中。
 * ip 為 null（拿不到來源 IP）時視為不信任。
 * 此函式被獨立出來以利單元測試替換。
 */
export function isTrustedProxy(
  ip: string | null,
  trustedList: string[] = parseTrustProxyEnv(),
): boolean {
  if (!ip || trustedList.length === 0) {
    return false;
  }

  for (const entry of trustedList) {
    if (entry.includes("/")) {
      if (ipInCidr(ip, entry)) {
        return true;
      }
    } else {
      if (ip === entry) {
        return true;
      }
    }
  }

  return false;
}

class TransportSecurityService {
  getRequestInfo(
    req: Request,
    remoteIp?: string | null,
  ): TransportSecurityInfo {
    const url = new URL(req.url);

    // 只有當來源 IP 在 TRUST_PROXY 白名單內，才解析 forwarded headers
    let headerProto: string | null = null;
    if (isTrustedProxy(remoteIp ?? null)) {
      headerProto =
        normalizeProto(req.headers.get("x-forwarded-proto")) ??
        normalizeProto(parseForwardedProto(req.headers.get("forwarded")));
    }

    const urlProto = normalizeProto(url.protocol.replace(":", ""));
    const protocol = headerProto ?? urlProto ?? "http";
    const host = url.hostname;
    const isTls = protocol === "https";
    const lanHost = isLanHost(host);

    return {
      isTls,
      isLanHost: lanHost,
      showInsecureTransportWarning: lanHost && !isTls,
      protocol,
      host,
    };
  }
}

export const transportSecurityService = new TransportSecurityService();
