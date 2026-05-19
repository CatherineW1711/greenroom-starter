"use server";

import Anthropic from "@anthropic-ai/sdk";

export interface ParsedDealTerms {
  guarantee: number | null;
  percentage: number | null;
  /** Stored as decimal, e.g. 0.80 for 80% */
  percentageDecimal: number | null;
  basis: "net" | "gross" | null;
  expense_cap: number | null;
  hospitality_cap: number | null;
  ambiguity_flags: string[];
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a music venue settlement assistant. Your job is to read a deal memo or notes field from a booking contract and extract structured deal terms.

Extract exactly these fields:
- guarantee: the artist's guaranteed payment in dollars (integer or null if not present)
- percentage: the artist's backend percentage as a whole number, e.g. 80 for 80% (null if not present)
- percentageDecimal: the same percentage expressed as a decimal, e.g. 0.80 (null if percentage is null)
- basis: whether the percentage applies to "net" (after expenses) or "gross" (before expenses) — null if unclear or no percentage
- expense_cap: maximum total expenses that can be deducted, in dollars (null if no cap stated)
- hospitality_cap: maximum hospitality expenses that can be deducted, in dollars (null if no cap stated)
- ambiguity_flags: array of plain-English strings describing terms that are present but ambiguous, contradictory, or could be interpreted multiple ways. Empty array if the deal is unambiguous.

Rules:
- If a term is absent, return null — do not guess.
- Percentages in the notes may say "80/20" meaning artist gets 80%; extract 80 as the percentage.
- "vs" or "versus" in deal notes typically means guarantee vs percentage, whichever is greater.
- Only flag genuine ambiguity — things a booker and tour manager might disagree about at settlement.
- Return valid JSON only, no commentary.`;

export async function parseDealTerms(
  notesText: string,
): Promise<ParsedDealTerms> {
  if (!notesText?.trim()) {
    return {
      guarantee: null,
      percentage: null,
      percentageDecimal: null,
      basis: null,
      expense_cap: null,
      hospitality_cap: null,
      ambiguity_flags: ["No deal notes provided — all terms must be entered manually."],
    };
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Parse the following deal notes and return a JSON object with the fields described:\n\n${notesText}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            guarantee: { anyOf: [{ type: "number" }, { type: "null" }] },
            percentage: { anyOf: [{ type: "number" }, { type: "null" }] },
            percentageDecimal: { anyOf: [{ type: "number" }, { type: "null" }] },
            basis: { anyOf: [{ type: "string", enum: ["net", "gross"] }, { type: "null" }] },
            expense_cap: { anyOf: [{ type: "number" }, { type: "null" }] },
            hospitality_cap: { anyOf: [{ type: "number" }, { type: "null" }] },
            ambiguity_flags: { type: "array", items: { type: "string" } },
          },
          required: [
            "guarantee",
            "percentage",
            "percentageDecimal",
            "basis",
            "expense_cap",
            "hospitality_cap",
            "ambiguity_flags",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Unexpected response format from Anthropic API");
  }

  return JSON.parse(textBlock.text) as ParsedDealTerms;
}
