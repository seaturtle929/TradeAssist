export type Source = { id: string; title: string; text: string; addedAt: string; originUrl?: string; originKind?: "google-drive"; syncedAt?: string };
export type BuyerBrief = { company:string; website:string; summary:string; facts:{text:string;sourceUrl:string}[]; hypotheses:{painPoint:string;reason:string;question:string}[]; sources:{title:string;url:string}[]; researchedAt:string };
export type Manufacturer = { id: string; name: string; products: string; introduction: string; sources: Source[] };
export type Turn = { id: string; text: string; role: "buyer" | "you" | "conversation"; at: number };
export type Guidance = { say: string; ask: string; intent: string; nextStep: string; caution: string; evidence: { sourceId: string; quote: string }[]; missing: string[] };
export type CallRecord = {
  id: string; manufacturerId: string; manufacturerName: string; buyer: string; goal: string;
  startedAt: number; duration: number; turns: Turn[]; notes: string; outcome: string;
  summary?: { overview: string; requirements: string[]; objections: string[]; commitments: string[]; nextSteps: string[]; followUp: string };
  estimatedCostUsd?: number; buyerBrief?: BuyerBrief | null;
};
export const GOALS = ["Confirm interest and agree a next step", "Get requirements for a quotation", "Arrange samples", "Schedule a follow-up conversation"];
export function knowledgeFor(m: Manufacturer) {
  return [...(m.introduction ? [{ id: "company-profile", title: "Company profile", text: m.introduction }] : []), ...m.sources.map(s => ({ id: s.id, title: s.title, text: s.text }))];
}
