"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowLeft, Eye, EyeOff, LogOut, Mail, LockKeyhole, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAuthErrorMessage } from "@/lib/auth-error";
import { signIn, signOut, signUp, useSession } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

function GoogleLogo() {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24">
      <path
        d="M21.8 12.23c0-.75-.07-1.46-.19-2.14H12v4.05h5.5a4.7 4.7 0 0 1-2.04 3.09v2.56h3.3c1.94-1.78 3.04-4.4 3.04-7.56Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.08-.91 6.77-2.47l-3.3-2.56c-.92.62-2.1.98-3.47.98-2.67 0-4.94-1.8-5.75-4.22H2.84v2.64A10.22 10.22 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.25 13.73A6.14 6.14 0 0 1 5.93 12c0-.6.11-1.18.32-1.73V7.63H2.84A10.04 10.04 0 0 0 1.75 12c0 1.61.38 3.13 1.09 4.37l3.41-2.64Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.05c1.5 0 2.84.52 3.9 1.53l2.92-2.92C17.07 3.02 14.75 2 12 2A10.22 10.22 0 0 0 2.84 7.63l3.41 2.64C7.06 7.85 9.33 6.05 12 6.05Z"
        fill="#EA4335"
      />
    </svg>
  );
}

type FieldProps = {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
};

function Field({ label, icon, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-zinc-300">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-zinc-500">
          {icon}
        </span>
        {children}
      </div>
    </label>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const { data: session, isPending, refetch } = useSession();

  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    if (mode === "sign-up") {
      if (!name.trim()) {
        setError("Name is required.");
        return;
      }

      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (mode === "sign-up") {
        await signUp.email({
          name,
          email,
          password,
        });

        setMessage("Check your email for the verification link, then come back here to sign in.");
        setMode("sign-in");
        setName("");
        setPassword("");
        setConfirmPassword("");
      } else {
        await signIn.email({
          email,
          password,
        });

        await refetch();
        router.replace("/");
        router.refresh();
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/`,
      });
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Google sign-in could not be started."));
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await signOut();
      await refetch();
      router.refresh();
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] px-4 py-8 text-zinc-100">
      <div className="absolute inset-0">
        <div className="absolute left-[-12%] top-[-10%] h-72 w-72 rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute bottom-[-14%] right-[-8%] h-80 w-80 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.07),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_38%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center justify-center">
        <div className="w-full  overflow-hidden rounded-[32px] border border-white/10 bg-white/3 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <section className="flex min-h-180 flex-col justify-center p-6 sm:p-8 md:p-10">
            <div className="mb-8 flex items-center justify-between md:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">GazeConnect</p>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="size-4" />
                Home
              </Link>
            </div>

            {session ? (
              <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-black/35 p-8 shadow-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Signed in</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">
                  {session.user.name || session.user.email}
                </h2>
                <p className="mt-3 text-sm text-zinc-400">{session.user.email}</p>

                <div className="mt-8 flex flex-col gap-3">
                  <Button
                    type="button"
                    size="lg"
                    className="h-12 rounded-2xl bg-white text-black hover:bg-zinc-200"
                    asChild
                  >
                    <Link href="/">Go to home</Link>
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="h-12 rounded-2xl border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    onClick={handleSignOut}
                    disabled={busy}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-md ">
                <div className="rounded-[28px] border border-white/10 bg-black/35 p-3 shadow-2xl">
                  <div className="grid grid-cols-2 gap-2 rounded-[22px] bg-white/[0.04] p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("sign-in");
                        setError("");
                        setMessage("");
                      }}
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                        mode === "sign-in"
                          ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.18)]"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("sign-up");
                        setError("");
                        setMessage("");
                      }}
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                        mode === "sign-up"
                          ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.18)]"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Create account
                    </button>
                  </div>

                  <div className="px-3 pb-3 pt-8">
                    <div className="mb-6">
                      <h2 className="text-3xl font-semibold tracking-tight text-white">
                        {mode === "sign-up" ? "Create account" : "Sign in"}
                      </h2>
                      <p className="mt-2 text-sm text-zinc-400">
                        {mode === "sign-up" ? "Use your email to get started." : "Use your email or continue with Google."}
                      </p>
                    </div>

                    <form className="space-y-4" onSubmit={handleSubmit}>
                      {mode === "sign-up" ? (
                        <Field label="Full name" icon={<UserRound className="size-4" />}>
                          <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:bg-white/[0.07]"
                            placeholder="Enter your name"
                          />
                        </Field>
                      ) : null}

                      <Field label="Email" icon={<Mail className="size-4" />}>
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:bg-white/[0.07]"
                          placeholder="you@example.com"
                        />
                      </Field>

                      <Field label="Password" icon={<LockKeyhole className="size-4" />}>
                        <>
                          <input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-11 pr-14 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:bg-white/[0.07]"
                            placeholder="Enter your password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((value) => !value)}
                            className="absolute inset-y-0 right-0 flex items-center pr-4 text-zinc-400 transition hover:text-white"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        </>
                      </Field>

                      {mode === "sign-up" ? (
                        <Field label="Confirm password" icon={<LockKeyhole className="size-4" />}>
                          <>
                            <input
                              type={showConfirmPassword ? "text" : "password"}
                              value={confirmPassword}
                              onChange={(event) => setConfirmPassword(event.target.value)}
                              className="h-14 w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-11 pr-14 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:bg-white/[0.07]"
                              placeholder="Re-enter your password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword((value) => !value)}
                              className="absolute inset-y-0 right-0 flex items-center pr-4 text-zinc-400 transition hover:text-white"
                              aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                            >
                              {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          </>
                        </Field>
                      ) : null}

                      {error ? (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                          {error}
                        </div>
                      ) : null}

                      {message ? (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                          {message}
                        </div>
                      ) : null}

                      <Button
                        type="submit"
                        size="lg"
                        disabled={busy || isPending}
                        className="h-14 w-full rounded-2xl bg-white text-base font-semibold text-black hover:bg-zinc-200"
                      >
                        {busy ? "Please wait..." : mode === "sign-up" ? "Create account" : "Sign in"}
                      </Button>
                    </form>

                    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.22em] text-zinc-600">
                      <span className="h-px flex-1 bg-white/10" />
                      Or continue with
                      <span className="h-px flex-1 bg-white/10" />
                    </div>

                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      onClick={handleGoogleSignIn}
                      disabled={busy}
                      className="h-14 w-full rounded-2xl border-white/12 bg-white text-base font-semibold text-zinc-950 hover:bg-zinc-100"
                    >
                      <GoogleLogo />
                      Continue with Google
                    </Button>

                    <div className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-500">
                      <span>{mode === "sign-up" ? "Already have an account?" : "Need an account?"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setMode(mode === "sign-up" ? "sign-in" : "sign-up");
                          setError("");
                          setMessage("");
                        }}
                        className="font-semibold text-white transition hover:text-cyan-300"
                      >
                        {mode === "sign-up" ? "Sign in" : "Create one"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
