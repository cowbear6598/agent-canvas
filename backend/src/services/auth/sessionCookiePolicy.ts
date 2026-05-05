import type { TransportSecurityInfo } from "./transportSecurityService.js";

export const SESSION_COOKIE_NAME = "ac_session";

export interface SessionCookiePolicy {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict";
  path: string;
  maxAgeSeconds: number;
}

function buildAttributes(policy: SessionCookiePolicy): string[] {
  const attributes = [
    `${policy.name}=`,
    `Path=${policy.path}`,
    `Max-Age=${policy.maxAgeSeconds}`,
    `SameSite=${policy.sameSite}`,
    "HttpOnly",
  ];

  if (policy.secure) {
    attributes.push("Secure");
  }

  return attributes;
}

class SessionCookiePolicyService {
  createPolicy(
    transportSecurity: TransportSecurityInfo,
    maxAgeSeconds: number = 60 * 60 * 24 * 7,
  ): SessionCookiePolicy {
    return {
      name: SESSION_COOKIE_NAME,
      secure: transportSecurity.isTls,
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAgeSeconds,
    };
  }

  serializeSessionCookie(
    sessionId: string,
    transportSecurity: TransportSecurityInfo,
    maxAgeSeconds?: number,
  ): string {
    const policy = this.createPolicy(transportSecurity, maxAgeSeconds);
    const attributes = buildAttributes(policy);
    attributes[0] = `${policy.name}=${encodeURIComponent(sessionId)}`;
    return attributes.join("; ");
  }

  serializeClearedCookie(transportSecurity: TransportSecurityInfo): string {
    const policy = this.createPolicy(transportSecurity, 0);
    return buildAttributes(policy).join("; ");
  }
}

export const sessionCookiePolicy = new SessionCookiePolicyService();
