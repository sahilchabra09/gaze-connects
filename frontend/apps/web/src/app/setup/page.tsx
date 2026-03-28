"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

type SetupTab = "patient" | "features" | "calibration";

const SETUP_TABS: Array<{ key: SetupTab; label: string }> = [
	{ key: "patient", label: "Patient & Contacts" },
	{ key: "features", label: "Customize Features" },
	{ key: "calibration", label: "Eye Tracker Calibration" },
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

export default function SetupPage() {
	const [activeTab, setActiveTab] = useState<SetupTab>("patient");

	const content = useMemo(() => {
		if (activeTab === "patient") {
			return (
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
		}

		if (activeTab === "features") {
			return (
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
		}

		return (
			<section className="space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/55 p-5 transition-colors hover:border-zinc-700/85 md:p-6">
				<h2 className="text-2xl font-semibold text-zinc-100">Eye Tracker Calibration</h2>
				<p className="text-sm text-zinc-400">
					Calibration controls are mocked for now. You can later wire these with live device APIs.
				</p>
				<div className="grid gap-4 md:grid-cols-2">
					{["Start Calibration", "Recenter Eyes", "Sensitivity", "Save Profile"].map((item) => (
						<button
							key={item}
							className="rounded-xl border border-zinc-700/80 bg-zinc-900/75 p-4 text-left font-medium text-zinc-100 transition-all hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900"
						>
							{item}
						</button>
					))}
				</div>
			</section>
		);
	}, [activeTab]);

	return (
		<main className="min-h-screen bg-black px-4 py-6 text-zinc-100 md:px-8 md:py-8">
			<div className="mx-auto w-full max-w-6xl">
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

