export type Source = { id: string; title: string; text: string; addedAt: string; originUrl?: string; originKind?: "google-drive"; syncedAt?: string };
export type BuyerBrief = { company:string; website:string; summary:string; facts:{text:string;sourceUrl:string}[]; hypotheses:{painPoint:string;reason:string;question:string}[]; sources:{title:string;url:string}[]; researchedAt:string };
export type Manufacturer = { brain?:import("./company-brain").CompanyBrainRecord; id: string; name: string; products: string; introduction: string; sources: Source[];stageMap?:import("./call-purpose").StageDefinition[];exampleLines?:import("./call-purpose").ExampleLine[] };
export type Turn = { transcriptionUncertainty?:{reason:string;message:string}; id: string; text: string; role: "buyer" | "you" | "conversation"; at: number; translationZh?:string; corrections?:{originalText:string;originalRole:Turn['role'];text:string;role:Turn['role'];reason:string;at:number;source:'manager_review'}[] };
export type Guidance = { verificationStatus?:'not_required'|'pending'|'verified'|'rejected'|'unavailable'; learningAttribution?:import("./generation-foundation").LearningAttribution; say: string; ask: string; intent: string; nextStep: string; caution: string; evidence: { sourceId: string; quote: string }[]; missing: string[]; stageId?:string; stage?:string; moment?:string; move?:string; backup?:string; why?:string; buyerIntent?:string; verified?:boolean;phase?:"bridge"|"answer"|"landing";questionEcho?:string;analysisReady?:boolean;scriptComplete?:boolean };
export type CallRecord = {
  transcriptionDiagnostics?:{sessions:unknown[];turns:Record<string,unknown>[]};
  derivedReviewStale?:boolean;
  wrapUp?:import('./client-workflow').CallWrapUp;
  wrapUpAssociation?:{sourceClientId:string;sourceContactId?:string;targetClientId:string;targetContactId?:string;reviewedAt:number};
  clientId?:string;contactId?:string;reachViaContactId?:string;preparation?:import('./client-records').CallPreparationSnapshot;legacyClientAssociation?:import('./client-records').LegacyClientAssociation;
  id: string; manufacturerId: string; manufacturerName: string; buyer: string; goal: string;
  startedAt: number; duration: number; turns: Turn[]; notes: string; outcome: string;
  summary?: { overview: string; requirements: string[]; objections: string[]; commitments: string[]; nextSteps: string[]; followUp: string };
  estimatedCostUsd?: number; packetCostUsd?:number; buyerBrief?: BuyerBrief | null;
  captureWarnings?:string[];
  buyerQuestionLog?:import("./live-coaching-session").LiveQuestionQueueEvent[];
  callType?:import("./phase1-types").CallType; bilingual?:boolean;
  stageHistory?:import("./phase1-types").StageEvent[]; suggestions?:import("./phase1-types").SuggestionRecord[];
  missingKnowledge?:import("./phase1-types").MissingKnowledge[]; nextStepAt?:string;
  packets?:{en?:import("./phase1-types").DecisionPacket;zh?:import("./phase1-types").DecisionPacket};
  decisionsNeeded?:import("./phase1-types").DecisionItem[];
  callContext?:import("./call-purpose").CallContext;
  companyConfiguration?:import("./company-configuration").CallConfigurationBinding;
  stageMapSnapshot?:import("./call-purpose").StageDefinition[];
};
export const GOALS = ["Confirm interest and agree a next step", "Get requirements for a quotation", "Arrange samples", "Schedule a follow-up conversation"];
export function knowledgeFor(m: Manufacturer) {
  return [...(m.introduction ? [{ id: "company-profile", title: "Company profile", text: m.introduction }] : []), ...m.sources.map(s => ({ id: s.id, title: s.title, text: s.text }))];
}
