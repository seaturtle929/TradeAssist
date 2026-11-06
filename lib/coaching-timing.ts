/** Durations use one monotonic clock per process. Provider fields include
 * transport/queue time; they are not claims about the provider's internal CPU. */
export type CoachingPhaseTiming={
 /** Legacy click-to-provider time includes queueing. */
 preparationMs?:number;
 /** CPU work before dispatch, separately from listening/transcription wait. */
 dispatchPreparationMs?:number; queueWaitMs?:number; providerSlotWaitMs?:number; continuedDrafts?:number;
 speculativeGenerations?:number; discardedSpeculations?:number; speculationEligibleAtMs?:number; speculationOverlapMs?:number;
 providerFirstDeltaMs?:number; providerRawWordingMs?:number; providerWordingMs?:number; providerCompleteMs?:number;
 /** Exact candidate/context assessment reuse, separate from full move checks. */
 replyAssessmentRuns?:number;replyAssessmentCacheHits?:number;replyAssessmentMs?:number;
 validationMs?:number; verificationDurationMs?:number; repairMs?:number; repairCount:number;
 firstUsableMs?:number; stableSuggestionMs?:number; requestCharacters?:number;
};
/** A token fragment is not necessarily something the rep can say. Count the
 * first substantive completed sentence; a finished short acknowledgment is
 * usable too. This observes display and never delays streaming. */
export function isUsableCoachingWording(say:string,complete=false):boolean {
 if(!say.trim())return false;
 if(complete)return true;
 return say.split(/(?<=[.!?])(?:\s+|$)/).some(sentence=>/[.!?]$/.test(sentence.trim())&&sentence.trim().split(/\s+/).length>=4);
}
export class CoachingPhaseClock {
 readonly phases:CoachingPhaseTiming={repairCount:0,validationMs:0};
 private dispatchAt?:number;private providerAt?:number;private verificationAt?:number;private repairAt?:number;
 readonly startedAt:number;private readonly now:()=>number;
 constructor(startedAt=performance.now(),now=()=>performance.now()){this.startedAt=startedAt;this.now=now;}
 prepared(preparationMs:number,queueWaitMs:number,continuedDrafts:number,providerSlotWaitMs=0){this.dispatchAt=this.now();this.phases.dispatchPreparationMs=Math.max(0,preparationMs);this.phases.queueWaitMs=Math.max(0,queueWaitMs);this.phases.providerSlotWaitMs=Math.max(0,providerSlotWaitMs);this.phases.continuedDrafts=continuedDrafts;}
 providerStarted(characters:number){const now=this.now();if(this.providerAt===undefined&&this.dispatchAt!==undefined)this.phases.dispatchPreparationMs=(this.phases.dispatchPreparationMs||0)+now-this.dispatchAt;this.providerAt??=now;this.phases.preparationMs??=this.providerAt-this.startedAt;this.phases.requestCharacters=characters;}
 firstDelta(){if(this.providerAt!==undefined)this.phases.providerFirstDeltaMs??=this.now()-this.providerAt;}
 rawWordingComplete(){if(this.providerAt!==undefined)this.phases.providerRawWordingMs=this.now()-this.providerAt;}
 wordingComplete(){if(this.providerAt!==undefined)this.phases.providerWordingMs=this.now()-this.providerAt;}
 providerComplete(){if(this.providerAt!==undefined)this.phases.providerCompleteMs=this.now()-this.providerAt;}
 validate<T>(run:()=>T):T{const start=this.now();try{return run();}finally{this.phases.validationMs=(this.phases.validationMs||0)+this.now()-start;}}
 verifyStarted(){this.verificationAt=this.now();}
 verifyComplete(){if(this.verificationAt!==undefined){this.phases.verificationDurationMs=(this.phases.verificationDurationMs||0)+this.now()-this.verificationAt;this.verificationAt=undefined;}}
 repairStarted(){this.phases.repairCount++;this.repairAt??=this.now();}
 display(say:string,complete:boolean,stable=false){const now=this.now();if(isUsableCoachingWording(say,complete))this.phases.firstUsableMs??=now-this.startedAt;if(stable){this.phases.stableSuggestionMs??=now-this.startedAt;if(this.repairAt!==undefined){this.phases.repairMs=now-this.repairAt;this.repairAt=undefined;}}}
 snapshot():CoachingPhaseTiming{return {...this.phases};}
}
