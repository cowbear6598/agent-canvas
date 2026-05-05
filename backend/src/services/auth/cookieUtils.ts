export function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawName, ...rawValueParts] = pair.split("=");
    const name = rawName.trim();
    if (!name) {
      continue;
    }

    const rawValue = rawValueParts.join("=").trim();
    cookies.set(name, decodeURIComponent(rawValue));
  }

  return cookies;
}
