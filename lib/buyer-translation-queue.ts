import type { TranslatedTurn, TranslationContextTurn } from "./translation";

export type TranslationJob={id:string;text:string;context?:TranslationContextTurn[];generation:number;scope:string;priority?:"live"|"background"};
export type Job=TranslationJob;
export type BuyerTranslationQueueOptions={
  translate:(jobs:TranslationJob[],signal:AbortSignal)=>Promise<TranslatedTurn[]>;
  onResult:(translations:TranslatedTurn[],jobs:TranslationJob[])=>void;
  onError:(jobs:TranslationJob[],error:unknown)=>void;
  onPending:(jobs:TranslationJob[])=>void;
  isCurrent:(job:TranslationJob)=>boolean;
  isEnabled:()=>boolean;
  /** Kept injectable so the timeout can be verified without a slow test. */
  requestTimeoutMs?:number;
};
type Lane="live"|"background";
type Active={jobs:TranslationJob[];controller:AbortController;lane:Lane;timer?:ReturnType<typeof setTimeout>};
const key=(job:TranslationJob)=>JSON.stringify([job.scope,job.generation,job.id,job.text]);
const row=(job:TranslationJob)=>JSON.stringify([job.scope,job.generation,job.id]);
const lane=(job:TranslationJob):Lane=>job.priority==="background" ? "background" : "live";

/** A dedicated single-row live lane keeps restored transcripts off the critical path. */
export class BuyerTranslationQueue {
  private readonly waiting=new Map<string,TranslationJob>();
  private readonly attempted=new Set<string>();
  private readonly active=new Map<Lane,Active>();
  private disposed=false;
  private readonly options:BuyerTranslationQueueOptions;
  constructor(options:BuyerTranslationQueueOptions){this.options=options;}

  enqueue(jobs:TranslationJob[]) {
    if(this.disposed)return;
    for(const supplied of jobs) {
      const job={...supplied,context:supplied.context?.map(turn=>({...turn}))},identity=key(job),queued=this.waiting.get(identity);
      if(this.attempted.has(identity))continue;
      if(queued) {
        // A newly finalized line can promote background work, never demote it.
        if(lane(queued)==="background" && lane(job)==="live") {
          this.waiting.delete(identity);this.waiting.set(identity,job);
        }
        continue;
      }
      for(const [queuedKey,previous] of this.waiting)if(row(previous)===row(job))this.waiting.delete(queuedKey);
      this.waiting.set(identity,job);
    }
    this.pending();this.kick();
  }
  retry(job:TranslationJob) {
    if(this.disposed || [...this.active.values()].some(active=>active.jobs.some(item=>key(item)===key(job))))return;
    this.attempted.delete(key(job));this.enqueue([job]);
  }
  /** Saved calls continue in catch-up without occupying the next call's live lane. */
  backgroundScope(scope:string,generation:number) {
    if(this.disposed)return;
    const belongs=(job:TranslationJob)=>job.scope===scope && job.generation===generation;
    for(const [identity,job] of this.waiting)if(belongs(job))this.waiting.set(identity,{...job,priority:"background"});
    const active=this.active.get("live");
    if(active && active.jobs.every(belongs)) {
      this.active.delete("live");
      active.jobs=active.jobs.map(job=>({...job,priority:"background"}));
      if(!this.active.has("background")) {
        // The request keeps running, including its original promise and usage
        // callback. run() follows this lane change when settling it.
        active.lane="background";this.active.set("background",active);
      } else {
        // Both slots are occupied. Retire the saved request and catch it up
        // later rather than starting a third request or blocking the live call.
        active.controller.abort();if(active.timer)clearTimeout(active.timer);
        for(const job of active.jobs){this.attempted.delete(key(job));this.waiting.set(key(job),job);}
      }
    }
    this.kick();
  }
  kick() {
    if(this.disposed)return;
    for(const [identity,job] of this.waiting)if(!this.options.isCurrent(job))this.waiting.delete(identity);
    // Corrected/deleted lines must not keep a newer source version waiting.
    for(const [name,active] of this.active)if(active.jobs.every(job=>!this.options.isCurrent(job))) {
      this.active.delete(name);active.controller.abort();if(active.timer)clearTimeout(active.timer);
      for(const job of active.jobs)this.attempted.delete(key(job));
    }
    if(!this.options.isEnabled()){this.pending();return;}
    this.start("live");this.start("background");this.pending();
  }
  dispose() {
    if(this.disposed)return;
    this.disposed=true;for(const active of this.active.values()){active.controller.abort();if(active.timer)clearTimeout(active.timer);}
    this.active.clear();this.waiting.clear();this.attempted.clear();
  }
  private start(name:Lane) {
    if(this.disposed||this.active.has(name))return;
    const newest=[...this.waiting.values()].filter(job=>lane(job)===name).reverse(),first=newest[0];
    if(!first)return;
    const jobs:TranslationJob[]=[];let characters=0;
    for(const job of newest) {
      if(job.scope!==first.scope||job.generation!==first.generation)continue;
      if(!job.text.trim()||job.text.length>6000||!job.id||job.id.length>200) {
        this.waiting.delete(key(job));this.attempted.add(key(job));
        this.error([job],new Error("This transcript line exceeds the translation limits."));continue;
      }
      // Live rows return independently. Background catch-up stays small, rather
      // than making one 24K-character response hold up every translated line.
      if(jobs.length && (name==="live" || jobs.length===2 || characters+job.text.length>2000))continue;
      jobs.push(job);characters+=job.text.length;
    }
    if(!jobs.length) {
      if([...this.waiting.values()].some(job=>lane(job)===name))this.start(name);
      return;
    }
    for(const job of jobs){this.waiting.delete(key(job));this.attempted.add(key(job));}
    const active:Active={jobs,controller:new AbortController(),lane:name};this.active.set(name,active);
    void this.run(active);
  }
  private async run(active:Active) {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const timeout=new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{
          reject(new Error("Translation took too long. Retry this transcript line."));active.controller.abort();
        },this.options.requestTimeoutMs??15_000);active.timer=timer;
      });
      const translations=await Promise.race([this.options.translate(active.jobs,active.controller.signal),timeout]);
      if(!this.disposed && this.active.get(active.lane)===active) {
        for(const job of active.jobs)if(!this.options.isCurrent(job))this.attempted.delete(key(job));
        this.options.onResult(translations,active.jobs);
      }
    }catch(error){if(!this.disposed && this.active.get(active.lane)===active)this.error(active.jobs,error);}
    finally {
      if(timer)clearTimeout(timer);
      if(!this.disposed&&this.active.get(active.lane)===active){this.active.delete(active.lane);this.kick();}
    }
  }
  private pending() {
    if(this.disposed)return;
    this.options.onPending([...this.active.values()].flatMap(active=>active.jobs).concat([...this.waiting.values()]));
  }
  private error(jobs:TranslationJob[],error:unknown) {
    if(this.disposed)return;
    try{this.options.onError(jobs,error);}catch{/* A failed UI callback must not strand later rows. */}
  }
}
