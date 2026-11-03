/** Durations use one monotonic clock per process. Provider fields include
 * transport/queue time; they are not claims about the provider's internal CPU. */
export type CoachingPhaseTiming={
 preparationMs?:number; providerFirstDeltaMs?:number; providerWordingMs?:number; providerCompleteMs?:number;
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
 private providerAt?:number;private verificationAt?:number;private repairAt?:number;
 readonly startedAt:number;private readonly now:()=>number;
 constructor(startedAt=performance.now(),now=()=>performance.now()){this.startedAt=startedAt;this.now=now;}
 providerStarted(characters:number){this.providerAt??=this.now();this.phases.preparationMs??=this.providerAt-this.startedAt;this.phases.requestCharacters=characters;}
 firstDelta(){if(this.providerAt!==undefined)this.phases.providerFirstDeltaMs??=this.now()-this.providerAt;}
 wordingComplete(){if(this.providerAt!==undefined)this.phases.providerWordingMs=this.now()-this.providerAt;}
 providerComplete(){if(this.providerAt!==undefined)this.phases.providerCompleteMs=this.now()-this.providerAt;}
 validate<T>(run:()=>T):T{const start=this.now();try{return run();}finally{this.phases.validationMs=(this.phases.validationMs||0)+this.now()-start;}}
 verifyStarted(){this.verificationAt=this.now();}
 verifyComplete(){if(this.verificationAt!==undefined){this.phases.verificationDurationMs=(this.phases.verificationDurationMs||0)+this.now()-this.verificationAt;this.verificationAt=undefined;}}
 repairStarted(){this.phases.repairCount++;this.repairAt??=this.now();}
 display(say:string,complete:boolean,stable=false){const now=this.now();if(isUsableCoachingWording(say,complete))this.phases.firstUsableMs??=now-this.startedAt;if(stable){this.phases.stableSuggestionMs??=now-this.startedAt;if(this.repairAt!==undefined){this.phases.repairMs=now-this.repairAt;this.repairAt=undefined;}}}
 snapshot():CoachingPhaseTiming{return {...this.phases};}
}
