/**
 * Session token logic — edge-safe (jose only, no DB imports) so it can be
 * used from middleware.ts as well as server components/actions.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "pt_admin_session";
export const SESSION_HOURS = 24 * 7;

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (16+ chars)");
  }
  return new TextEncoder().encode(secret);
}

export type AdminSession = {
  userId: string;
  email: string;
  name: string;
};

export async function createSessionToken(
  session: AdminSession,
): Promise<string> {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    return {
      userId: payload.userId,
      email: payload.email as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}
