export interface ConnectionSecurityInfo {
  isTls: boolean;
  isLanHost: boolean;
  showTransportRiskWarning: boolean;
}

interface LocationLike {
  protocol: string;
  hostname: string;
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

export function getConnectionSecurityInfo(
  locationLike: LocationLike = window.location,
): ConnectionSecurityInfo {
  const isTls = locationLike.protocol === "https:";
  const lanHost = isLanHost(locationLike.hostname);

  return {
    isTls,
    isLanHost: lanHost,
    showTransportRiskWarning: lanHost && !isTls,
  };
}
