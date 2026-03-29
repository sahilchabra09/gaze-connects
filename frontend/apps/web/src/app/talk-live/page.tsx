"use client";

import { testEyeTrackerStorage } from "@workspace/ui/lib/gaze-core-widget-storage";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import Link from "next/link";
import { BadgeCheck, ArrowLeft, Check, LoaderCircle, Mic, RefreshCw, TriangleAlert } from "lucide-react";

import { useMockMode } from "@/hooks/use-mock-mode";
import { useSession } from "@/lib/auth-client";
import { fetchTalkOptions, transcribeTalkAudio } from "@/lib/talk-live/api";

type TranscriptEntry = {
	id: string;
	text: string;
	timestamp: string;
};

function readCalibrationReady() {
	try {
		const record = testEyeTrackerStorage.readCalibrationRecord();
		return Boolean(record?.calibration);
	} catch {
		return false;
	}
}

export default function TalkLivePage() {
	const { data: session } = useSession();
	const { mockEnabled, requiresCalibration, setMockModeState } = useMockMode();

	const [isRecording, setIsRecording] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [isFetchingOptions, setIsFetchingOptions] = useState(false);
	const [isSpeaking, setIsSpeaking] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [speechError, setSpeechError] = useState<string | null>(null);
	const [optionsError, setOptionsError] = useState<string | null>(null);
	const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
	const [lastTranscript, setLastTranscript] = useState("");
	const [options, setOptions] = useState<string[]>([]);
	const [showOptions, setShowOptions] = useState(false);
	const [selectedOption, setSelectedOption] = useState<number | null>(null);
	const [calibrationReady, setCalibrationReady] = useState(readCalibrationReady);
	const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);

	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const shouldUploadRef = useRef(true);

	const supportsMediaRecorder = typeof window !== "undefined" && "MediaRecorder" in window;
	const supportsSpeechSynthesis = typeof window !== "undefined" && "speechSynthesis" in window;

	const cleanupStream = () => {
		if (mediaStreamRef.current) {
			mediaStreamRef.current.getTracks().forEach((track) => track.stop());
			mediaStreamRef.current = null;
		}
	};

	const fetchOptions = async (message?: string) => {
		const source = (message ?? lastTranscript).trim();
		if (!source) {
			setShowOptions(false);
			setOptions([]);
			setOptionsError(null);
			return;
		}

		setShowOptions(true);
		setIsFetchingOptions(true);
		setSelectedOption(null);
		setSpeechError(null);
		setOptionsError(null);

		try {
			const response = await fetchTalkOptions(source);
			const nextOptions = response.options.slice(0, 4);
			if (nextOptions.length === 0) {
				setOptions([]);
				setOptionsError("No AI options available right now.");
				return;
			}

			setOptions(nextOptions);
		} catch (error) {
			const messageText = error instanceof Error ? error.message : "Unable to fetch AI options.";
			setOptions([]);
			setOptionsError(messageText);
		} finally {
			setIsFetchingOptions(false);
		}
	};

	const uploadAudio = async (blob: Blob) => {
		if (blob.size === 0) {
			setErrorMessage("No audio captured. Please try again.");
			return;
		}

		setIsUploading(true);
		setErrorMessage(null);

		try {
			const audioFile = new File([blob], `recording-${Date.now()}.webm`, {
				type: blob.type || "audio/webm",
			});

			const text = await transcribeTalkAudio(audioFile);
			const trimmed = text.trim();

			if (!trimmed) {
				setErrorMessage("No speech detected. Please try again.");
				return;
			}

			setTranscripts((previous) => [
				{
					id: `${Date.now()}`,
					text: trimmed,
					timestamp: new Date().toISOString(),
				},
				...previous,
			]);
			setLastTranscript(trimmed);
			await fetchOptions(trimmed);
		} catch (error) {
			const messageText = error instanceof Error ? error.message : "Unable to transcribe audio right now.";
			setErrorMessage(messageText);
		} finally {
			setIsUploading(false);
		}
	};

	const startRecording = async () => {
		if (isRecording || isUploading) {
			return;
		}

		if (!supportsMediaRecorder || typeof navigator === "undefined") {
			setErrorMessage("Recording is not supported in this browser.");
			return;
		}

		if (!navigator.mediaDevices?.getUserMedia) {
			setErrorMessage("Microphone access is unavailable on this device.");
			return;
		}

		setErrorMessage(null);

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			mediaStreamRef.current = stream;

			const options: MediaRecorderOptions = {};
			if (typeof MediaRecorder !== "undefined" && "isTypeSupported" in MediaRecorder) {
				if (MediaRecorder.isTypeSupported("audio/webm")) {
					options.mimeType = "audio/webm";
				}
			}

			const recorder = new MediaRecorder(stream, options);
			mediaRecorderRef.current = recorder;
			chunksRef.current = [];
			shouldUploadRef.current = true;

			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			};

			recorder.onstop = async () => {
				cleanupStream();

				const blob = new Blob(chunksRef.current, {
					type: recorder.mimeType || "audio/webm",
				});
				chunksRef.current = [];

				if (!shouldUploadRef.current) {
					return;
				}

				await uploadAudio(blob);
			};

			recorder.start();
			setIsRecording(true);
		} catch (error) {
			cleanupStream();
			const messageText = error instanceof Error ? error.message : "Unable to access microphone.";
			setErrorMessage(messageText);
			setIsRecording(false);
			mediaRecorderRef.current = null;
		}
	};

	const stopRecording = (upload = true) => {
		shouldUploadRef.current = upload;

		const recorder = mediaRecorderRef.current;
		if (!recorder) {
			cleanupStream();
			return;
		}

		if (recorder.state !== "inactive") {
			setIsRecording(false);
			recorder.stop();
		}

		mediaRecorderRef.current = null;
	};

	const speakText = (text: string) => {
		if (!supportsSpeechSynthesis) {
			setSpeechError("Text-to-speech is not supported in this browser.");
			return;
		}

		try {
			setSpeechError(null);
			setIsSpeaking(true);
			window.speechSynthesis.cancel();

			const utterance = new SpeechSynthesisUtterance(text);
			utterance.onend = () => {
				setIsSpeaking(false);
				handleOptionsBack();
			};
			utterance.onerror = () => {
				setIsSpeaking(false);
				setSpeechError("Unable to play speech right now.");
			};

			window.speechSynthesis.speak(utterance);
		} catch {
			setIsSpeaking(false);
			setSpeechError("Unable to play speech right now.");
		}
	};

	const handleOptionClick = (text: string | undefined, index: number) => {
		const trimmed = text?.trim();
		if (!trimmed) {
			return;
		}

		setSelectedOption(index);
		speakText(trimmed);
	};

	const handleRetry = () => {
		if (!lastTranscript.trim()) {
			setShowOptions(false);
			setOptions([]);
			setOptionsError(null);
			return;
		}

		setSelectedOption(null);
		setSpeechError(null);
		setOptionsError(null);
		setIsSpeaking(false);
		void fetchOptions(lastTranscript);
	};

	const handleOptionsBack = () => {
		if (supportsSpeechSynthesis) {
			window.speechSynthesis.cancel();
		}

		setShowOptions(false);
		setSelectedOption(null);
		setSpeechError(null);
		setOptionsError(null);
		setIsSpeaking(false);
	};

	useEffect(() => {
		return () => {
			shouldUploadRef.current = false;
			stopRecording(false);
			cleanupStream();

			if (typeof window !== "undefined" && "speechSynthesis" in window) {
				window.speechSynthesis.cancel();
			}
		};
	}, []);

	useEffect(() => {
		const syncCalibrationReady = () => {
			setCalibrationReady(readCalibrationReady());
		};

		syncCalibrationReady();
		window.addEventListener("storage", syncCalibrationReady);
		window.addEventListener("focus", syncCalibrationReady);

		return () => {
			window.removeEventListener("storage", syncCalibrationReady);
			window.removeEventListener("focus", syncCalibrationReady);
		};
	}, []);

	useEffect(() => {
		if (calibrationReady) {
			return;
		}

		setMockModeState({
			mockEnabled: true,
			requiresCalibration: false,
		});
	}, [calibrationReady, setMockModeState]);

	const handleToggleMockMode = () => {
		if (mockEnabled) {
			if (requiresCalibration || !calibrationReady) {
				setShowCalibrationAlert(true);
				return;
			}

			setMockModeState({
				mockEnabled: false,
				requiresCalibration: false,
			});
			return;
		}

		setMockModeState({
			mockEnabled: true,
			requiresCalibration: true,
		});
	};

	const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		void startRecording();
	};

	const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		stopRecording(true);
	};

	const onPointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
		if (event.buttons === 0) {
			return;
		}
		event.preventDefault();
		stopRecording(true);
	};

	const onPointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		stopRecording(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.repeat) {
			return;
		}

		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			void startRecording();
		}
	};

	const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			stopRecording(true);
		}
	};

	const renderOptionCard = (text: string | undefined, index: number) => {
		if (!text) {
			return (
				<div
					key={`option-${index}`}
					className="relative flex flex-col items-center justify-center border border-zinc-800/70"
				>
					<div className="absolute inset-0 m-5 rounded-2xl border border-dashed border-zinc-700" />
				</div>
			);
		}

		return (
			<button
				key={`option-${index}`}
				onClick={() => handleOptionClick(text, index)}
				data-gaze-activate
				className="relative flex h-full w-full cursor-pointer flex-col items-center justify-center border border-zinc-800/70"
			>
				<div
					className={`absolute inset-0 m-5 rounded-3xl border bg-zinc-950 p-6 text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900 ${selectedOption === index ? "border-zinc-300 bg-zinc-900 shadow-[0_0_24px_rgba(255,255,255,0.15)]" : "border-zinc-700/70"}`}
				>
					<div className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-500 bg-zinc-800 text-xl font-semibold text-zinc-100">
						{index + 1}
					</div>

					{selectedOption === index ? (
						<span className="absolute inset-0 flex items-center justify-center">
							<span className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-100 text-black">
								<Check className="h-10 w-10" />
							</span>
						</span>
					) : null}

					<div className="flex h-full items-center justify-center text-center text-xl font-semibold leading-relaxed md:text-2xl">
						{text}
					</div>
				</div>
			</button>
		);
	};

	const footerControls = (
		<div className="pointer-events-none fixed inset-x-0 bottom-6 z-60 flex justify-center">
			<div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-zinc-700/70 bg-black/70 p-2 shadow-xl backdrop-blur-sm">
				<Link
					href="/setup?tab=calibration"
					className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
				>
					Setup
				</Link>

				<Link
					href="/auth"
					className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
				>
					<BadgeCheck className="size-4" />
					{session?.user?.name || "Auth"}
				</Link>

				<button
					type="button"
					onClick={handleToggleMockMode}
					className={`inline-flex min-w-28 items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold transition-all ${mockEnabled ? "border border-zinc-300 bg-zinc-100 text-black shadow-[0_0_20px_rgba(255,255,255,0.25)]" : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"}`}
				>
					Mock: {mockEnabled ? "ON" : "OFF"}
				</button>
			</div>
		</div>
	);

	if (!supportsMediaRecorder) {
		return (
			<main className="relative h-screen w-screen overflow-hidden bg-black text-zinc-100">
				<div className="flex h-[calc(100vh-106px)] w-full items-center justify-center px-4">
				<div className="max-w-md space-y-2 text-center">
					<p className="text-lg font-semibold">Audio recording is not supported on this device.</p>
					<p className="text-sm text-zinc-400">Use a browser that supports the MediaRecorder API.</p>
				</div>
				</div>
				{footerControls}
			</main>
		);
	}

	return (
		<main className="relative h-screen w-screen overflow-hidden bg-black text-zinc-100">
			<div className="flex h-[calc(100vh-106px)] w-full">
				<Link
					href="/"
					data-gaze-activate
					className="group relative flex h-full w-1/2 flex-col items-center justify-center border-r border-zinc-800/70 bg-zinc-950 transition-all duration-300 hover:bg-zinc-900"
				>
					<div className="absolute inset-0 m-5 flex flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/60 bg-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all group-hover:-translate-y-0.5 group-hover:border-zinc-400/85 group-hover:bg-zinc-900">
						<ArrowLeft className="h-20 w-20" />
						<span className="text-5xl font-medium tracking-tight">Back</span>
					</div>
				</Link>

				<button
					type="button"
					data-gaze-activate
					disabled={isUploading}
					onPointerDown={onPointerDown}
					onPointerUp={onPointerUp}
					onPointerLeave={onPointerLeave}
					onPointerCancel={onPointerCancel}
					onKeyDown={onKeyDown}
					onKeyUp={onKeyUp}
					aria-pressed={isRecording}
					className={`group relative flex h-full w-1/2 flex-col items-center justify-center border-l border-zinc-800/70 bg-zinc-950 transition-all duration-300 hover:bg-zinc-900 ${isUploading ? "opacity-75" : "opacity-100"}`}
				>
					<div className={`absolute inset-0 m-5 flex flex-col items-center justify-center rounded-3xl border p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all ${isRecording ? "border-zinc-300 bg-zinc-900" : "border-zinc-700/60 bg-zinc-950 group-hover:-translate-y-0.5 group-hover:border-zinc-400/85 group-hover:bg-zinc-900"}`}>
						<Mic className={`mb-8 h-28 w-28 ${isRecording ? "animate-pulse" : ""}`} />
						<span className="mb-3 text-center text-5xl font-medium tracking-tight">{isRecording ? "Recording..." : "Hold to Talk"}</span>
						<p className="text-xl text-zinc-300">{isRecording ? "Release to transcribe" : "Press and hold to speak"}</p>

						{(isRecording || isUploading) ? (
							<div className="mt-8 flex items-center gap-3 text-lg text-zinc-200">
								<LoaderCircle className="h-6 w-6 animate-spin" />
								<span>{isRecording ? "Listening..." : "Sending audio for transcription..."}</span>
							</div>
						) : null}

						{errorMessage ? (
							<div className="mt-8 max-w-xl rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-3 text-center text-base text-red-300">
								{errorMessage}
							</div>
						) : null}

						{transcripts.length > 0 && !isRecording && !isUploading ? (
							<div className="absolute bottom-8 text-sm text-zinc-400">
								Last: {transcripts[0]?.text.slice(0, 70)}
								{(transcripts[0]?.text.length ?? 0) > 70 ? "..." : ""}
							</div>
						) : null}
					</div>
				</button>
			</div>

			{showOptions ? (
				<section className="fixed inset-x-0 top-0 z-50 flex h-[calc(100vh-106px)] flex-col bg-black">
					{lastTranscript ? (
						<div className="border-b border-zinc-800 bg-zinc-950 px-6 py-4">
							<p className="mb-1 text-xs uppercase tracking-[0.16em] text-zinc-400">Based on transcription</p>
							<p className="text-base text-zinc-200">“{lastTranscript}”</p>
							{isSpeaking ? (
								<div className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
									<LoaderCircle className="h-4 w-4 animate-spin" />
									<span>Speaking...</span>
								</div>
							) : null}
						</div>
					) : null}

					{isFetchingOptions ? (
						<div className="flex flex-1 items-center justify-center">
							<div className="text-center">
								<LoaderCircle className="mx-auto mb-4 h-12 w-12 animate-spin text-zinc-200" />
								<p className="text-zinc-300">Loading AI options...</p>
							</div>
						</div>
					) : (
						<div className="grid flex-1 grid-cols-3 grid-rows-2">
							<button
								type="button"
								onClick={handleOptionsBack}
								data-gaze-activate
								className="relative border border-zinc-800/70"
							>
								<div className="absolute inset-0 m-5 flex flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/60 bg-zinc-950 text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900">
									<ArrowLeft className="mb-4 h-16 w-16" />
									<span className="text-4xl font-medium tracking-tight">Back</span>
								</div>
							</button>

							{renderOptionCard(options[0], 0)}
							{renderOptionCard(options[1], 1)}
							{renderOptionCard(options[2], 2)}
							{renderOptionCard(options[3], 3)}

							<button
								type="button"
								onClick={handleRetry}
								data-gaze-activate
								className="relative border border-zinc-800/70"
							>
								<div className="absolute inset-0 m-5 flex flex-col items-center justify-center gap-5 rounded-3xl border border-zinc-700/60 bg-zinc-950 text-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-all hover:-translate-y-0.5 hover:border-zinc-400/85 hover:bg-zinc-900">
									<RefreshCw className="mb-4 h-16 w-16" />
									<span className="text-4xl font-medium tracking-tight">Retry</span>
								</div>
							</button>
						</div>
					)}

					{speechError ? <div className="px-6 py-3 text-sm text-red-400">{speechError}</div> : null}
					{optionsError && !speechError ? <div className="px-6 py-3 text-sm text-amber-300">{optionsError}</div> : null}
				</section>
			) : null}

			{footerControls}

			{showCalibrationAlert ? (
				<div className="fixed inset-0 z-90 flex items-center justify-center bg-black/60 px-4 backdrop-blur-[1px]">
					<div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
						<div className="mb-3 flex items-start gap-2 text-zinc-100">
							<TriangleAlert className="mt-0.5 size-5 text-amber-300" />
							<div>
								<p className="font-semibold">Calibration required</p>
								<p className="mt-1 text-sm text-zinc-300">
									You have to calibrate first before turning mock mode off and using eye-tracker navigation.
								</p>
							</div>
						</div>

						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setShowCalibrationAlert(false)}
								className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
							>
								Later
							</button>
							<Link
								href="/setup?tab=calibration"
								onClick={() => setShowCalibrationAlert(false)}
								className="rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white"
							>
								Open Calibration
							</Link>
						</div>
					</div>
				</div>
			) : null}
		</main>
	);
}

