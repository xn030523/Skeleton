/**
 * ACP (Agent Client Protocol) adapter for Skeleton Agent.
 */

export { SkeletonACPAgent } from "./agent.js";
export { SessionManager, type SessionState } from "./session.js";
export { detectProvider, hasProvider } from "./auth.js";
export { makeToolProgressCb, makeThinkingCb, makeStepCb, makeMessageCb } from "./events.js";
export { makeApprovalCallback } from "./permissions.js";
export {
  getToolKind,
  makeToolCallId,
  buildToolStart,
  buildToolComplete,
  buildToolTitle,
  extractLocations,
} from "./tools.js";
export { CopilotACPClient } from "./copilot-client.js";
export { runAcpServer } from "./entry.js";
