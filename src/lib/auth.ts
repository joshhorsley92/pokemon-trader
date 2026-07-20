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

/** Re-check the signed-in user's own password (guards credential changes). */
export async function verifyOwnPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const [user] = await db
    .select({ passwordHash: tables.adminUsers.passwordHash })
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.id, userId));
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export type CredentialUpdate = { email?: string; name?: string; password?: string };

/**
 * Update the signed-in admin's own credentials. Returns the refreshed session
 * so the caller can re-issue the cookie (the JWT carries email/name).
 */
export async function updateOwnCredentials(
  userId: string,
  update: CredentialUpdate,
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  const set: Partial<typeof tables.adminUsers.$inferInsert> = {};
  if (update.email !== undefined) set.email = update.email.toLowerCase().trim();
  if (update.name !== undefined) set.name = update.name.trim();
  if (update.password !== undefined) {
    set.passwordHash = await bcrypt.hash(update.password, 12);
  }
  if (Object.keys(set).length === 0) {
    return { ok: false, error: "Nothing to change" };
  }

  // Email is unique — surface a friendly message instead of a 23505 crash.
  if (set.email) {
    const [taken] = await db
      .select({ id: tables.adminUsers.id })
      .from(tables.adminUsers)
      .where(eq(tables.adminUsers.email, set.email));
    if (taken && taken.id !== userId) {
      return { ok: false, error: "That email is already used by another admin" };
    }
  }

  const [updated] = await db
    .update(tables.adminUsers)
    .set(set)
    .where(eq(tables.adminUsers.id, userId))
    .returning({
      id: tables.adminUsers.id,
      email: tables.adminUsers.email,
      name: tables.adminUsers.name,
    });
  if (!updated) return { ok: false, error: "Account not found" };
  return {
    ok: true,
    session: { userId: updated.id, email: updated.email, name: updated.name },
  };
}
