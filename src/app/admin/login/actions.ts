"use server";

import { redirect } from "next/navigation";
import { setSessionCookie, verifyCredentials } from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/admin");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  const session = await verifyCredentials(email, password);
  if (!session) {
    return { error: "Invalid email or password." };
  }
  await setSessionCookie(session);
  redirect(from.startsWith("/admin") ? from : "/admin");
}
