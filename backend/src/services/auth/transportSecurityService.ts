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

class TransportSecurityService {
  getRequestInfo(req: Request): TransportSecurityInfo {
    const url = new URL(req.url);
    const headerProto =
      normalizeProto(req.headers.get("x-forwarded-proto")) ??
      normalizeProto(parseForwardedProto(req.headers.get("forwarded")));
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
