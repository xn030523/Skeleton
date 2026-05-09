/**
 * Interrupt Signaling — per-session tool cancellation mechanism.
 *
 * Tools check isInterrupted() to detect cancellation.
 * Set by user action (Ctrl+C) or session timeout.
 *
 * Inspired by Hermes interrupt.py (simplified — Node.js single-thread).
 */

let interrupted = false;
let interruptReason = "";

/** Signal that the current operation should be interrupted */
export function setInterrupt(reason: string = "user_cancelled"): void {
  interrupted = true;
  interruptReason = reason;
}

/** Check if an interrupt has been signaled */
export function isInterrupted(): boolean {
  return interrupted;
}

/** Get the interrupt reason */
export function getInterruptReason(): string {
  return interruptReason;
}

/** Clear the interrupt signal (call after handling) */
export function clearInterrupt(): void {
  interrupted = false;
  interruptReason = "";
}

/** Run a function with interrupt checking — throws if interrupted */
export function checkInterrupt(): void {
  if (interrupted) {
    throw new Error(`Interrupted: ${interruptReason}`);
  }
}
