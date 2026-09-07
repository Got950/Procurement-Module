"use client";

import { motion, MotionConfig } from "framer-motion";

export function LoginAtmosphere() {
  return (
    <MotionConfig reducedMotion="user">
      {/* Soft cool-blue atmospheric field */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 12% 35%, rgba(37, 99, 235, 0.07), transparent 60%), radial-gradient(ellipse 55% 45% at 88% 20%, rgba(59, 130, 246, 0.06), transparent 55%), radial-gradient(ellipse 50% 40% at 78% 85%, rgba(14, 165, 233, 0.05), transparent 50%), linear-gradient(165deg, #f8fafc 0%, #f1f5f9 45%, #eef4fb 100%)",
        }}
        aria-hidden
      />

      {/* Decorative pharmaceutical shapes — desktop/tablet */}
      <motion.div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      >
        <div className="login-float-slow absolute -right-16 top-[12%] h-72 w-72 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="login-float-slower absolute bottom-[8%] right-[18%] h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-[18%] left-[8%] hidden h-40 w-40 rounded-full bg-blue-600/5 blur-2xl lg:block" />

        <svg
          className="absolute right-[6%] top-[14%] hidden h-28 w-28 text-blue-600/15 lg:block"
          viewBox="0 0 96 96"
          fill="currentColor"
        >
          <rect x="36" y="12" width="24" height="72" rx="6" />
          <rect x="12" y="36" width="72" height="24" rx="6" />
        </svg>

        <svg
          className="absolute right-[22%] top-[48%] hidden h-14 w-14 text-blue-500/20 md:block"
          viewBox="0 0 96 96"
          fill="currentColor"
        >
          <rect x="36" y="12" width="24" height="72" rx="6" />
          <rect x="12" y="36" width="72" height="24" rx="6" />
        </svg>

        <svg
          className="absolute bottom-[16%] right-[8%] hidden h-24 w-12 -rotate-[28deg] text-blue-600/20 md:block"
          viewBox="0 0 40 96"
          fill="none"
        >
          <rect x="4" y="4" width="32" height="88" rx="16" fill="currentColor" opacity="0.55" />
          <path d="M4 48h32" stroke="white" strokeWidth="2" opacity="0.5" />
        </svg>

        <svg
          className="absolute -right-8 top-[58%] hidden h-64 w-64 text-blue-600/10 lg:block"
          viewBox="0 0 200 200"
          fill="none"
        >
          <circle cx="100" cy="100" r="78" stroke="currentColor" strokeWidth="18" />
        </svg>

        <svg
          className="absolute left-0 top-[20%] hidden h-80 w-80 text-blue-600/10 xl:block"
          viewBox="0 0 320 320"
          fill="none"
        >
          <path
            d="M40 280 C40 140, 140 40, 280 40"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M70 280 C70 160, 160 70, 280 70"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </motion.div>

      {/* Left branding — desktop */}
      <motion.div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden max-w-md flex-col justify-center pl-10 pr-6 lg:flex xl:w-[34%] xl:pl-16"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
      >
        <p className="text-[13px] font-semibold tracking-[0.14em] text-slate-800">
          MedFlow
        </p>
        <p className="mt-1 text-[12px] tracking-wide text-slate-500">
          Pharmaceutical Procurement
        </p>
        <h2 className="mt-10 max-w-[16ch] text-[2.15rem] font-semibold leading-[1.15] tracking-tight text-slate-900">
          Reliable supply.
          <br />
          Healthier tomorrow.
        </h2>
        <div className="mt-5 h-0.5 w-12 rounded-full bg-blue-600" aria-hidden />
        <p className="mt-5 max-w-[22ch] text-[15px] leading-relaxed text-slate-500">
          Streamlining pharmaceutical procurement for a healthier world.
        </p>
      </motion.div>
    </MotionConfig>
  );
}
