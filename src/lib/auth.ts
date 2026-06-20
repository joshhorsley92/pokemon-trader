import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_HOURS,
  verifySessionToken,
  type AdminSession,
} from "@/lib/session";

export type { AdminSession };

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AdminSession | null> {
  const [user] = await db
    .select()
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.email, email.toLowerCase().trim()));
  if (!user) {
    // Still hash to keep timing roughly constant for unknown emails
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinval");
    return null;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { userId: user.id, email: user.email, name: user.name };
}

export async function setSessionCookie(session: AdminSession): Promise<void> {
  const token = await createSessionToken(session);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/** Read the current admin session from cookies (server components/actions). */
export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Throw-style guard for server actions and admin API routes. */
export async function requireSession(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}
