"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireSession,
  setSessionCookie,
  updateOwnCredentials,
  verifyOwnPassword,
} from "@/lib/auth";

export type AccountState = { error?: string; success?: string };

const emailSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
  currentPassword: z.string().min(1),
});

/** Change your own email / display name. Requires the current password. */
export async function updateProfile(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await requireSession();
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email, name, and your current password." };
  }
  const { email, name, currentPassword } = parsed.data;

  if (!(await verifyOwnPassword(session.userId, currentPassword))) {
    return { error: "Current password is incorrect." };
  }

  const res = await updateOwnCredentials(session.userId, { email, name });
  if (!res.ok) return { error: res.error };

  // The session JWT carries email/name — re-issue it so the UI stays in sync.
  await setSessionCookie(res.session);
  revalidatePath("/admin/account");
  return { success: "Profile updated." };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(10).max(200),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords don't match",
  });

/** Change your own password. Requires the current password. */
export async function updatePassword(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const session = await requireSession();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "New password must be at least 10 characters.",
    };
  }
  const { currentPassword, newPassword } = parsed.data;

  if (!(await verifyOwnPassword(session.userId, currentPassword))) {
    return { error: "Current password is incorrect." };
  }
  if (newPassword === currentPassword) {
    return { error: "New password must be different from the current one." };
  }

  const res = await updateOwnCredentials(session.userId, {
    password: newPassword,
  });
  if (!res.ok) return { error: res.error };

  await setSessionCookie(res.session);
  revalidatePath("/admin/account");
  return { success: "Password changed." };
}
