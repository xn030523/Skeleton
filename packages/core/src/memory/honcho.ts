import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { atomicWriteJsonSync } from "../atomic-write.js";

/**
 * Honcho-style dialectical user modeling.
 * Maintains competing hypotheses about user preferences,
 * revises confidence based on evidence, detects contradictions.
 * Inspired by Hermes's Honcho integration (depth 1-3 reasoning).
 */

export interface Hypothesis {
  id: string;
  category: string;         // e.g., "coding_style", "output_format", "expertise"
  claim: string;            // e.g., "User prefers detailed explanations"
  confidence: number;       // 0.0 - 1.0
  evidence: string[];       // observations supporting/contradicting
  contradictIds: string[];  // IDs of competing hypotheses
  lastUpdated: string;
}

export interface HonchoProfile {
  hypotheses: Hypothesis[];
  peerCard: string;         // concise user summary
  version: number;
}

export class HonchoUserModel {
  private filePath: string;
  private profile: HonchoProfile;
  private peerCardDirty = true;

  constructor(profilePath?: string) {
    this.filePath = profilePath ?? path.join(os.homedir(), ".skeleton", "honcho.json");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.profile = this.loadDisk();
  }

  /** Add a new hypothesis or update existing one */
  addObservation(category: string, claim: string, supporting: boolean): Hypothesis {
    const existing = this.profile.hypotheses.find(
      (h) => h.category === category && h.claim.toLowerCase() === claim.toLowerCase(),
    );

    if (existing) {
      // Update confidence
      const delta = supporting ? 0.1 : -0.15;
      existing.confidence = Math.max(0, Math.min(1, existing.confidence + delta));
      existing.evidence.push(supporting ? `+${new Date().toISOString().slice(0, 10)}` : `-${new Date().toISOString().slice(0, 10)}`);
      existing.lastUpdated = new Date().toISOString();
      this.peerCardDirty = true;
      this.saveDisk();
      return existing;
    }

    // New hypothesis
    const id = `hyp_${Date.now().toString(36)}`;
    const hypothesis: Hypothesis = {
      id,
      category,
      claim,
      confidence: supporting ? 0.6 : 0.3,
      evidence: [supporting ? `+${new Date().toISOString().slice(0, 10)}` : `-${new Date().toISOString().slice(0, 10)}`],
      contradictIds: [],
      lastUpdated: new Date().toISOString(),
    };

    // Check for contradictions with existing hypotheses in same category
    for (const h of this.profile.hypotheses) {
      if (h.category === category && this.isContradictory(h.claim, claim)) {
        h.contradictIds.push(id);
        hypothesis.contradictIds.push(h.id);
      }
    }

    this.profile.hypotheses.push(hypothesis);
    this.peerCardDirty = true;
    this.saveDisk();
    return hypothesis;
  }

  /** Get top hypotheses for a category, sorted by confidence */
  getHypotheses(category?: string): Hypothesis[] {
    const filtered = category
      ? this.profile.hypotheses.filter((h) => h.category === category)
      : this.profile.hypotheses;
    return filtered.sort((a, b) => b.confidence - a.confidence);
  }

  /** Reconcile contradictions — keep the higher-confidence hypothesis */
  reconcile(): number {
    let removed = 0;
    const toRemove = new Set<string>();

    for (const h of this.profile.hypotheses) {
      if (toRemove.has(h.id)) continue;
      for (const cid of h.contradictIds) {
        const competitor = this.profile.hypotheses.find((x) => x.id === cid);
        if (!competitor || toRemove.has(cid)) continue;

        // Keep the one with higher confidence
        if (h.confidence >= competitor.confidence) {
          toRemove.add(cid);
          removed++;
        } else {
          toRemove.add(h.id);
          removed++;
          break;
        }
      }
    }

    this.profile.hypotheses = this.profile.hypotheses.filter((h) => !toRemove.has(h.id));
    // Clean up contradictIds
    for (const h of this.profile.hypotheses) {
      h.contradictIds = h.contradictIds.filter((id) => !toRemove.has(id));
    }

    if (removed > 0) {
      this.peerCardDirty = true;
      this.saveDisk();
    }
    return removed;
  }

  /** Update the peer card (concise user summary) */
  updatePeerCard(): string {
    const topByCategory = new Map<string, Hypothesis>();
    for (const h of this.profile.hypotheses) {
      const existing = topByCategory.get(h.category);
      if (!existing || h.confidence > existing.confidence) {
        topByCategory.set(h.category, h);
      }
    }

    const lines: string[] = [];
    for (const [cat, h] of topByCategory) {
      const conf = h.confidence >= 0.7 ? "strong" : h.confidence >= 0.4 ? "moderate" : "weak";
      lines.push(`${cat}: ${h.claim} [${conf}]`);
    }

    this.profile.peerCard = lines.join("\n");
    this.saveDisk();
    return this.profile.peerCard;
  }

  /** Build context for system prompt */
  buildContext(maxTokens = 500): string {
    if (this.profile.hypotheses.length === 0) return "";

    // Only regenerate peer card when hypotheses have changed
    if (this.peerCardDirty || !this.profile.peerCard) {
      this.updatePeerCard();
      this.peerCardDirty = false;
    }

    const card = this.profile.peerCard;
    if (!card) return "";

    return `## User Model (dialectical)\n${card}`;
  }

  /** Get the full profile as JSON for the honcho_reasoning tool */
  getProfile(): HonchoProfile {
    return { ...this.profile };
  }

  private isContradictory(claim1: string, claim2: string): boolean {
    // Simple contradiction detection based on negation patterns
    const pairs: Array<[RegExp, RegExp]> = [
      [/prefer detailed/i, /prefer (brief|concise|short)/i],
      [/prefer (brief|concise|short)/i, /prefer detailed/i],
      [/expert|advanced/i, /beginner|novice/i],
      [/beginner|novice/i, /expert|advanced/i],
      [/chinese/i, /english/i],
      [/english/i, /chinese/i],
    ];
    for (const [a, b] of pairs) {
      if ((a.test(claim1) && b.test(claim2)) || (b.test(claim1) && a.test(claim2))) {
        return true;
      }
    }
    return false;
  }

  private loadDisk(): HonchoProfile {
    if (!fs.existsSync(this.filePath)) {
      return { hypotheses: [], peerCard: "", version: 1 };
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as HonchoProfile;
    } catch {
      return { hypotheses: [], peerCard: "", version: 1 };
    }
  }

  private saveDisk(): void {
    atomicWriteJsonSync(this.filePath, this.profile, { mode: 0o600 });
  }
}
