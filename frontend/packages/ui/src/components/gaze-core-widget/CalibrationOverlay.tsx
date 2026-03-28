import { createPortal } from "react-dom"
import { useEffect } from "react"
import { Button } from "@workspace/ui/components/button"
import type { GazeCoreWidgetState } from "./types"

export function CalibrationOverlay({ state }: { state: GazeCoreWidgetState }) {
  const calibPoint = state.calibPoint
  const isVisible = state.calibrating && Boolean(calibPoint)

  useEffect(() => {
    if (!isVisible || typeof document === "undefined") return

    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow

    html.style.overflow = "hidden"
    body.style.overflow = "hidden"

    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [isVisible])

  if (!isVisible || typeof document === "undefined" || !calibPoint) return null

  return createPortal(
    <div className="fixed inset-0 z-90 overflow-hidden select-none bg-black/70 backdrop-blur-[1px]" style={{ cursor: "none" }}>
      <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
        <p>Point {state.calibIndex + 1} / 9</p>
        <p className="text-xs text-white/60">
          {state.calibrationStatusText || (state.captureActive ? "Capturing..." : "Press Space to capture, Esc to cancel")}
        </p>
        {state.calibrationError && <p className="mt-1 text-xs text-red-300">{state.calibrationError}</p>}
      </div>

      {state.captureActive && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20">
          <div className="h-full bg-green-400 transition-none" style={{ width: `${state.captureProgress}%` }} />
        </div>
      )}

      <div
        className="absolute h-5 w-5 rounded-full border-4 border-yellow-400 bg-yellow-300"
        style={{
          left: calibPoint[0],
          top: calibPoint[1],
          transform: state.calibrationTargetTransform,
        }}
      />

      <div className="absolute right-4 top-4 flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.localStorage.setItem("gaze-connect-mock-mode", "false")
              window.location.assign("/")
            }
          }}
        >
          Home
        </Button>
        <Button variant="secondary" onClick={state.stopCalibration}>
          Cancel calibration
        </Button>
      </div>
    </div>,
    document.body,
  )
}


