import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Admin Login" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <Suspense>
        <LoginForm from={from ?? "/admin"} />
      </Suspense>
    </div>
  );
}
