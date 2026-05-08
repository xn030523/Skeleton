import type { ToolDef } from "../types.js";
import type { HonchoUserModel } from "./honcho.js";

export function honchoTools(model: HonchoUserModel): ToolDef[] {
  return [honchoObserveTool(model), honchoQueryTool(model), honchoReconcileTool(model)];
}

function honchoObserveTool(model: HonchoUserModel): ToolDef {
  return {
    name: "honcho_observe",
    description:
      "Record an observation about the user (preference, behavior, expertise level). " +
      "The system maintains competing hypotheses and adjusts confidence. " +
      "Use when you notice a pattern in how the user interacts or what they prefer.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Category (e.g., coding_style, output_format, expertise, language_preference, tool_preference).",
        },
        claim: {
          type: "string",
          description: "The hypothesis claim (e.g., 'User prefers step-by-step explanations').",
        },
        supporting: {
          type: "boolean",
          description: "Whether this observation supports (true) or contradicts (false) the claim.",
        },
      },
      required: ["category", "claim", "supporting"],
    },
    execute: async (args) => {
      const hyp = model.addObservation(
        String(args.category),
        String(args.claim),
        Boolean(args.supporting),
      );
      return `Hypothesis recorded: [${hyp.category}] "${hyp.claim}" (confidence: ${hyp.confidence.toFixed(2)})${hyp.contradictIds.length > 0 ? ` — contradicts ${hyp.contradictIds.length} other hypothesis(es)` : ""}`;
    },
  };
}

function honchoQueryTool(model: HonchoUserModel): ToolDef {
  return {
    name: "honcho_query",
    description:
      "Query the dialectical user model. Returns current hypotheses sorted by confidence. " +
      "Use before making assumptions about user preferences.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional category filter. If omitted, returns all hypotheses.",
        },
      },
    },
    execute: async (args) => {
      const category = args.category ? String(args.category) : undefined;
      const hyps = model.getHypotheses(category);

      if (hyps.length === 0) {
        return category ? `No hypotheses for '${category}'.` : "No user hypotheses recorded yet.";
      }

      return hyps
        .map((h) => {
          const conf = h.confidence >= 0.7 ? "STRONG" : h.confidence >= 0.4 ? "MODERATE" : "WEAK";
          const contra = h.contradictIds.length > 0 ? ` [contradicts ${h.contradictIds.length}]` : "";
          return `[${h.category}] ${h.claim} (${conf}, ${h.confidence.toFixed(2)})${contra}`;
        })
        .join("\n");
    },
  };
}

function honchoReconcileTool(model: HonchoUserModel): ToolDef {
  return {
    name: "honcho_reconcile",
    description:
      "Reconcile contradictory hypotheses by keeping higher-confidence ones. " +
      "Run periodically or when you detect conflicting user preferences.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const removed = model.reconcile();
      const card = model.updatePeerCard();
      return removed > 0
        ? `Reconciled: removed ${removed} contradictory hypotheses.\nUpdated peer card:\n${card}`
        : "No contradictions to reconcile.";
    },
  };
}
