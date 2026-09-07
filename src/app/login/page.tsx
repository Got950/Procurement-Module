import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginAtmosphere } from "./login-atmosphere";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect("/dashboard");
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#f4f7fb]">
      <LoginAtmosphere />

      <div className="relative z-20 flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6 lg:items-center lg:justify-center lg:pl-[34%] lg:pr-[6%] xl:pl-[36%] xl:pr-[10%]">
        {/* Mobile / tablet branding above card — compact so the form fits */}
        <div className="mb-6 w-full max-w-[420px] text-center lg:hidden">
          <p className="text-[12px] font-semibold tracking-[0.14em] text-slate-800">
            MedFlow
          </p>
          <p className="mt-0.5 text-[11px] tracking-wide text-slate-500">
            Pharmaceutical Procurement
          </p>
          <h2 className="mt-3 text-[1.35rem] font-semibold leading-snug tracking-tight text-slate-900">
            Reliable supply. Healthier tomorrow.
          </h2>
          <div className="mx-auto mt-3 h-0.5 w-10 rounded-full bg-blue-600" />
          <p className="mx-auto mt-3 max-w-[30ch] text-[13px] leading-relaxed text-slate-500">
            Streamlining pharmaceutical procurement for a healthier world.
          </p>
        </div>

        <Suspense
          fallback={
            <div
              className="h-[28rem] w-full max-w-[420px] animate-pulse rounded-[16px] bg-white/70"
              aria-hidden
            />
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
