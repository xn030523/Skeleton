/**
 * Session Mirroring — cross-session message delivery mirroring.
 * Appends delivery-mirror records to target session transcripts
 * so the receiving-side agent has context about what was sent.
 *
 * Inspired by Hermes gateway/mirror.py.
 */

import type { SessionDB } from "./index.js";

export interface MirrorRecord {
  type: "delivery-mirror";
  sourceSessionId: string;
  targetSessionId: string;
  direction: "sent" | "received";
  content: string;
  timestamp: number;
}

/** Mirror a message to a target session's transcript */
export async function mirrorToSession(
  sessionDb: SessionDB,
  sourceSessionId: string,
  targetSessionId: string,
  content: string,
  direction: "sent" | "received" = "sent",
): Promise<void> {
  const mirrorRecord: MirrorRecord = {
    type: "delivery-mirror",
    sourceSessionId,
    targetSessionId,
    direction,
    content: content.slice(0, 2000), // Cap mirror content
    timestamp: Date.now(),
  };

  sessionDb.saveMessage(targetSessionId, {
    role: "system",
    content: `[Mirror from ${sourceSessionId}]\n${JSON.stringify(mirrorRecord)}`,
  });
}
