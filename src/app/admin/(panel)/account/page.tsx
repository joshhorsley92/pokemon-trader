import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PasswordForm, ProfileForm } from "./account-forms";

export const metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-neutral-500">
          Your sign-in details. Changes take effect immediately.
        </p>
      </div>
      <ProfileForm email={session.email} name={session.name} />
      <PasswordForm />
    </div>
  );
}
