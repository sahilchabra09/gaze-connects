"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, KeyRound, LoaderCircle } from "lucide-react";
import { GazeCoreWidget } from "@workspace/ui/components/gaze-core-widget";

import { NecessitySetupPanel } from "@/components/necessity/necessity-setup-panel";
import { toBackendURL } from "@/lib/telegram/api-base";
import { authBaseURL, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type SetupTab = "patient" | "features" | "necessities" | "calibration" | "hardware";

type ApiErrorPayload = {
	error?: string;
	message?: string;
};

const SETUP_TABS: Array<{ key: SetupTab; label: string }> = [
	{ key: "patient", label: "Patient & Contacts" },
	{ key: "features", label: "Customize Features" },
	{ key: "necessities", label: "Necessities" },
	{ key: "calibration", label: "Eye Tracker Calibration" },
	{ key: "hardware", label: "Hardware Password" },
];

function LabeledInput({ label, placeholder }: { label: string; placeholder?: string }) {
	return (
		<label className="flex flex-col gap-2 text-sm">
			<span className="text-zinc-200">{label}</span>
			<input
				placeholder={placeholder}
				className="h-11 rounded-xl border border-zinc-700/70 bg-zinc-900/80 px-3 text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
			/>
		</label>
	);
}

function resolveGazeConnectBackendUrl() {
	const explicitUrl = process.env.NEXT_PUBLIC_GAZE_CONNECT_BACKEND_URL?.trim();
	if (explicitUrl) {
		return explicitUrl.replace(/\/+$/g, "");
	}

	return authBaseURL ?? "";
}

export default function SetupPage() {
	const searchParams = useSearchParams();
	const [activeTab, setActiveTab] = useState<SetupTab>("patient");
	const { data: session, isPending: sessionPending } = useSession();
	const gazeConnectBackendUrl = resolveGazeConnectBackendUrl();
	const [hardwarePassword, setHardwarePassword] = useState("");
	const [hardwarePasswordConfirm, setHardwarePasswordConfirm] = useState("");
	const [hardwareIsSet, setHardwareIsSet] = useState<boolean | null>(null);
	const [hardwareStatusLoaded, setHardwareStatusLoaded] = useState(false);
	const [hardwareChecking, setHardwareChecking] = useState(false);
	const [hardwareSaving, setHardwareSaving] = useState(false);
	const [hardwareError, setHardwareError] = useState("");
	const [hardwareMessage, setHardwareMessage] = useState("");

	useEffect(() => {
		const tabParam = searchParams.get("tab")?.trim().toLowerCase();
		if (tabParam === "calibration") {
			setActiveTab("calibration");
		}
	}, [searchParams]);

	useEffect(() => {
		if (activeTab !== "hardware" || hardwareStatusLoaded) {
			return;
		}

		async function loadHardwarePasswordStatus() {
			setHardwareChecking(true);
			setHardwareError("");

			try {
				const response = await fetch(toBackendURL("/api/users/me/hardware-password"), {
					method: "GET",
					credentials: "include",
					headers: {
						Accept: "application/json",
					},
				});

				const payload = (await response.json().catch(() => null)) as { isSet?: boolean; message?: string } | null;
				if (!response.ok) {
					setHardwareError(payload?.message ?? "Could not load hardware password status.");
					return;
				}

				setHardwareIsSet(Boolean(payload?.isSet));
			} catch {
				setHardwareError("Could not load hardware password status.");
			} finally {
				setHardwareChecking(false);
				setHardwareStatusLoaded(true);
			}
		}

		void loadHardwarePasswordStatus();
	}, [activeTab, hardwareStatusLoaded]);

	async function handleHardwarePasswordSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setHardwareError("");
		setHardwareMessage("");

		if (!hardwarePassword.trim()) {
			setHardwareError("Hardware password is required.");
			return;
		}

		if (hardwarePassword.length < 6) {
			setHardwareError("Hardware password must be at least 6 characters.");
			return;
		}

		if (hardwarePassword !== hardwarePasswordConfirm) {
			setHardwareError("Passwords do not match.");
			return;
		}

		setHardwareSaving(true);

		try {
			const response = await fetch(toBackendURL("/api/users/me/hardware-password"), {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					password: hardwarePassword,
				}),
			});

			const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
			if (!response.ok) {
				setHardwareError(payload?.message ?? "Could not save hardware password.");
				return;
			}

			setHardwareIsSet(true);
			setHardwarePassword("");
			setHardwarePasswordConfirm("");
			setHardwareMessage("Hardware password saved successfully.");
		} catch {
			setHardwareError("Could not save hardware password.");
		} finally {
			setHardwareSaving(false);
		}
	}

	let content: React.ReactNode;

	if (activeTab === "patient") {
		content = (
			<div className="space-y-8">
				<section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
					<h2 className="text-2xl font-semibold text-zinc-100">Patient & Contact Details</h2>
					<LabeledInput label="Patient Name" placeholder="Enter full name" />
					<LabeledInput label="Patient Telegram Phone" placeholder="+91-XXXXXXXXXX" />
				</section>

				<section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
					<h3 className="text-xl font-semibold text-zinc-100">Caretaker</h3>
					<div className="grid gap-4 md:grid-cols-3">
						<LabeledInput label="Name" />
						<LabeledInput label="Phone" />
						<LabeledInput label="Relation" />
					</div>
				</section>

				<section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
					<h3 className="text-xl font-semibold text-zinc-100">Emergency Contact 1</h3>
					<div className="grid gap-4 md:grid-cols-3">
						<LabeledInput label="Name" />
						<LabeledInput label="Phone" />
						<LabeledInput label="Relation" />
					</div>
				</section>
			</div>
		);
	} else if (activeTab === "features") {
		content = (
			<section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
				<h2 className="text-2xl font-semibold text-zinc-100">Customize Features</h2>
				<p className="text-sm text-zinc-400">Temporary placeholders until backend integration is ready.</p>
				<div className="grid gap-4 md:grid-cols-2">
					{["Option 1", "Option 2", "Option 3", "Option 4"].map((option) => (
						<button
							key={option}
							className="group rounded-xl border border-zinc-700/80 bg-zinc-900/75 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900"
						>
							<span className="font-medium text-zinc-100 transition-colors group-hover:text-zinc-50">
								{option}
							</span>
						</button>
					))}
				</div>
			</section>
		);
	} else if (activeTab === "necessities") {
		content = <NecessitySetupPanel />;
	} else if (activeTab === "calibration") {
		content = (
			<div className="space-y-5">
				{!gazeConnectBackendUrl ? (
					<section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
						Set <code>NEXT_PUBLIC_GAZE_CONNECT_BACKEND_URL</code> or <code>NEXT_PUBLIC_BETTER_AUTH_URL</code> so the widget can reach the GazeConnect backend.
					</section>
				) : sessionPending ? (
					<section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 text-sm text-zinc-300">
						Checking your GazeConnect session before loading calibration...
					</section>
				) : !session ? (
					<section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 text-sm text-zinc-300">
						<p className="mb-4">
							Sign in first so the widget can request a token from the GazeConnect backend on calibration start.
						</p>
						<Link
							href="/auth"
							className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 font-medium text-zinc-100 transition-all hover:border-zinc-500 hover:text-white"
						>
							Open Sign In
						</Link>
					</section>
				) : (
					<div className="dark overflow-hidden rounded-2xl border border-zinc-800/80 bg-background text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
						<GazeCoreWidget backendBaseUrl={gazeConnectBackendUrl} />
					</div>
				)}
			</div>
		);
	} else {
		content = (
			<section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="text-2xl font-semibold text-zinc-100">Hardware Password</h2>
						<p className="mt-2 max-w-2xl text-sm text-zinc-400">
							Set the password used by your hardware device when it requests UUID validation with email and password.
						</p>
					</div>
					<span className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
						{hardwareChecking ? "Checking" : hardwareIsSet ? "Configured" : "Not set"}
					</span>
				</div>

				{hardwareIsSet ? (
					<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
						<div className="inline-flex items-center gap-2">
							<CheckCircle2 className="size-4" />
							Hardware password is configured. Submitting a new value will replace it.
						</div>
					</div>
				) : null}

				<form className="space-y-4" onSubmit={(event) => void handleHardwarePasswordSubmit(event)}>
					<label className="flex flex-col gap-2 text-sm">
						<span className="text-zinc-200">New Hardware Password</span>
						<div className="relative">
							<KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
							<input
								type="password"
								value={hardwarePassword}
								onChange={(event) => setHardwarePassword(event.target.value)}
								placeholder="Minimum 6 characters"
								className="h-11 w-full rounded-xl border border-zinc-700/70 bg-zinc-900/80 pl-10 pr-3 text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
								disabled={hardwareSaving}
							/>
						</div>
					</label>

					<label className="flex flex-col gap-2 text-sm">
						<span className="text-zinc-200">Confirm Hardware Password</span>
						<div className="relative">
							<KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
							<input
								type="password"
								value={hardwarePasswordConfirm}
								onChange={(event) => setHardwarePasswordConfirm(event.target.value)}
								placeholder="Re-enter the password"
								className="h-11 w-full rounded-xl border border-zinc-700/70 bg-zinc-900/80 pl-10 pr-3 text-zinc-100 outline-none transition-all placeholder:text-zinc-500 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-300/20"
								disabled={hardwareSaving}
							/>
						</div>
					</label>

					<div className="flex flex-wrap items-center gap-3">
						<button
							type="submit"
							disabled={hardwareSaving}
							className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-5 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-60"
						>
							{hardwareSaving ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
							Save Hardware Password
						</button>
						<p className="text-xs text-zinc-500">This updates your signed-in account only.</p>
					</div>
				</form>

				{hardwareError ? (
					<div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
						{hardwareError}
					</div>
				) : null}

				{hardwareMessage ? (
					<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
						{hardwareMessage}
					</div>
				) : null}
			</section>
		);
	}

	return (
		<main className="min-h-screen bg-black px-4 py-6 text-zinc-100 md:px-8 md:py-8">
			<div className="mx-auto w-full ">
				<header className="mb-6 flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-4xl font-semibold tracking-tight text-zinc-100">GazeConnect Setup</h1>
					<Link
						href="/"
						className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 transition-all hover:border-zinc-500 hover:text-white"
					>
						<ArrowLeft className="size-4" />
						Back to Home
					</Link>
				</header>

				<div className="mb-6 flex flex-wrap gap-3 border-b border-zinc-800 pb-5">
					{SETUP_TABS.map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => setActiveTab(tab.key)}
							className={cn(
								"rounded-xl border px-5 py-2 text-sm font-semibold transition-all",
								activeTab === tab.key
									? "border-zinc-200 bg-zinc-100 text-black shadow-[0_0_20px_rgba(255,255,255,0.25)]"
									: "border-zinc-700 bg-zinc-950/85 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900 hover:text-white"
							)}
						>
							{tab.label}
						</button>
					))}
				</div>

				{content}
			</div>
		</main>
	);
}
