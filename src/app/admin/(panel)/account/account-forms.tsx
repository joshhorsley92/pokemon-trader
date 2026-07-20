"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword, updateProfile, type AccountState } from "./actions";

function Notice({ state }: { state: AccountState }) {
  if (state.error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        {state.success}
      </p>
    );
  }
  return null;
}

export function ProfileForm({
  email,
  name,
}: {
  email: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(
    updateProfile,
    {},
  );
  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Email &amp; name</h2>
            <p className="text-xs text-neutral-500">
              The email you sign in with.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={email}
              required
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" name="name" defaultValue={name} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profileCurrent">Current password</Label>
            <Input
              id="profileCurrent"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
            <p className="text-xs text-neutral-500">
              Required to confirm it&apos;s you.
            </p>
          </div>
          <Notice state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(
    updatePassword,
    {},
  );
  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Password</h2>
            <p className="text-xs text-neutral-500">
              At least 10 characters. You stay signed in on this device.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pwCurrent">Current password</Label>
            <Input
              id="pwCurrent"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pwNew">New password</Label>
            <Input
              id="pwNew"
              name="newPassword"
              type="password"
              minLength={10}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pwConfirm">Confirm new password</Label>
            <Input
              id="pwConfirm"
              name="confirmPassword"
              type="password"
              minLength={10}
              required
              autoComplete="new-password"
            />
          </div>
          <Notice state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
