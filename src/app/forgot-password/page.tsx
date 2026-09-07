import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const s = await getSession();
  if (s) redirect("/settings");
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--color-bg)] px-4 py-16">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37, 99, 235, 0.08), transparent), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(15, 23, 42, 0.04), transparent)",
        }}
        aria-hidden
      />
      <ForgotPasswordForm />
    </div>
  );
}
