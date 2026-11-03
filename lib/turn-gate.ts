export type GateAction = {cancel:boolean;ready:string|null};

/** Coordinates two source-labelled channels without treating our own words as buyer turns. */
export class TurnGate {
  private representativeSpeaking=false;
  private representativePending=false;
  private remoteSpeaking=false;
  private responding=false;
  private paused=false;
  private pendingBuyer:string|null=null;
  private latestBuyerAt=-Infinity;

  private action(cancel=false):GateAction {
    if (!this.paused && !this.representativeSpeaking && !this.representativePending && !this.remoteSpeaking && !this.responding && this.pendingBuyer) {
      const ready=this.pendingBuyer;this.pendingBuyer=null;this.responding=true;
      return {cancel,ready};
    }
    return {cancel,ready:null};
  }
  repSpeech(active:boolean):GateAction {
    this.representativeSpeaking=active;
    return this.action(active && this.responding);
  }
  repPending(active:boolean):GateAction { this.representativePending=active;return this.action(); }
  buyerSpeech(active:boolean,at?:number):GateAction {
    this.remoteSpeaking=active;
    // A newer buyer utterance supersedes any older queued reply.
    if(active){this.pendingBuyer=null;if(Number.isFinite(at))this.latestBuyerAt=Math.max(this.latestBuyerAt,at!);}
    return this.action(active && this.responding);
  }
  buyerTurn(id:string,at?:number):GateAction {
    if(Number.isFinite(at) && at! < this.latestBuyerAt)return this.action();
    if(Number.isFinite(at))this.latestBuyerAt=at!;
    if(!this.paused)this.pendingBuyer=id;return this.action();
  }
  responseStarted():GateAction { this.responding=true;return this.action(this.paused || this.representativeSpeaking || this.representativePending || this.remoteSpeaking); }
  responseDone():GateAction { this.responding=false;return this.action(); }
  pause(value:boolean):GateAction { this.paused=value;if(value)this.pendingBuyer=null;return this.action(value && this.responding); }
  reset():void { this.representativeSpeaking=false;this.representativePending=false;this.remoteSpeaking=false;this.responding=false;this.paused=false;this.pendingBuyer=null;this.latestBuyerAt=-Infinity; }
  get state() { return {repSpeaking:this.representativeSpeaking,repPending:this.representativePending,buyerSpeaking:this.remoteSpeaking,responseActive:this.responding,paused:this.paused,pendingBuyer:this.pendingBuyer}; }
}
