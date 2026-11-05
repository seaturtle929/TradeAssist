export type AcceptedBuyerTurn={id:string;text:string;at:number;transcriptionUncertainty?:{reason:string;message:string}};
export type LiveReplyTicket={revision:number;turn:AcceptedBuyerTurn};
export type LiveTurnCoordinatorOptions={
  onRequest:(ticket:LiveReplyTicket,continuation?:boolean)=>void;
  onSupersede:()=>void;
  onCancel:(responseId?:string)=>void;
  /** A missing cancellation acknowledgment cannot strand an explicit request. */
  cancelAckTimeoutMs?:number;
};
type ServerSlot={ticket:LiveReplyTicket;id?:string;cancelTimer?:ReturnType<typeof setTimeout>};

/** Owns explicit coaching requests. Audio state is observation, never a trigger
 * or a publication gate; a request keeps the snapshot it had at the click. */
export class LiveTurnCoordinator {
  private revision=0;
  private latest:LiveReplyTicket|null=null;
  private answeredRevision=0;
  private processing:LiveReplyTicket|null=null;
  private server:ServerSlot|null=null;
  private continuation:LiveReplyTicket|null=null;
  private remoteSpeaking=false;
  private remotePending=false;
  private representativeSpeaking=false;
  private representativePending=false;
  private paused=false;
  private draining=false;
  private drainAgain=false;
  private readonly options:LiveTurnCoordinatorOptions;

  constructor(options:LiveTurnCoordinatorOptions){this.options=options;}

  /** Kept as a transcription observer for callers migrating from turn-based
   * coaching. It must never create, replace or retire an explicit request. */
  acceptBuyer(turn:AcceptedBuyerTurn):null {void turn;return null;}

  requestNextMove(turn:AcceptedBuyerTurn):LiveReplyTicket|null {
    if(!turn.id || typeof turn.text!=="string" || !Number.isFinite(turn.at))return null;
    const snapshot=Object.freeze({id:turn.id,text:turn.text.trim(),at:turn.at});
    const ticket=Object.freeze({revision:++this.revision,turn:snapshot});
    this.latest=ticket;this.processing=null;this.continuation=null;
    this.options.onSupersede();
    // Realtime permits one active response. Cancel its obsolete slot, then
    // dispatch the latest request on acknowledgment (or a bounded timeout).
    if(this.server)this.cancel(this.server);
    this.drain();return ticket;
  }

  buyerSpeech(active:boolean):void {this.remoteSpeaking=active;}
  buyerPending(active:boolean):void {this.remotePending=active;}
  repSpeech(active:boolean):void {this.representativeSpeaking=active;}
  repPending(active:boolean):void {this.representativePending=active;}
  pause(active:boolean):void {this.paused=active;}
  representativeTurn(at:number):null {void at;return null;}
  /** Unclear subsequent audio does not invalidate an already pinned request. */
  invalidateBuyer():void {}

  /** Explicit Used/Ignored action, rather than observed representative speech. */
  retireCurrent():LiveReplyTicket|null {
    const ticket=this.latest;if(!ticket)return null;
    this.latest=null;this.processing=null;this.continuation=null;
    this.answeredRevision=ticket.revision;
    if(this.server)this.cancel(this.server);
    return ticket;
  }

  responseCreated(id:string,revision:number):boolean {
    if(!id || !this.server || this.server.ticket.revision!==revision || (this.server.id && this.server.id!==id)) {
      if(id)this.options.onCancel(id);
      return false;
    }
    this.server.id=id;
    if(!this.isCurrent(this.server.ticket)){this.cancel(this.server);return false;}
    return true;
  }
  responseDone(id:string):void {
    if(!this.server || this.server.id!==id)return;
    if(this.server.cancelTimer)clearTimeout(this.server.cancelTimer);
    this.server=null;this.drain();
  }
  abandonResponse(ticket:LiveReplyTicket,cancel=true):boolean {
    if(!this.server || this.server.ticket.revision!==ticket.revision)return false;
    const id=this.server.id;if(this.server.cancelTimer)clearTimeout(this.server.cancelTimer);this.server=null;
    if(cancel)this.options.onCancel(id);
    this.drain();return true;
  }
  continueResponse(ticket:LiveReplyTicket):boolean {
    if(!this.isCurrent(ticket) || this.server || this.continuation || this.answeredRevision===ticket.revision)return false;
    this.processing=ticket;this.continuation=ticket;this.drain();return true;
  }
  /** A rejected spoken candidate does not need the rest of its metadata.
   * Keep the same snapshot, but wait for cancellation acknowledgment before
   * dispatching its one repair on the single-response Realtime connection. */
  replaceResponse(ticket:LiveReplyTicket):boolean {
    if(!this.isCurrent(ticket) || this.continuation || this.answeredRevision===ticket.revision)return false;
    this.processing=ticket;this.continuation=ticket;
    if(this.server)this.cancel(this.server,true);
    this.drain();return true;
  }
  deferPublish(ticket:LiveReplyTicket,publish:()=>void):boolean {
    if(!this.isCurrent(ticket))return false;
    publish();return true;
  }
  markAnswered(ticket:LiveReplyTicket):void {
    if(!this.isCurrent(ticket))return;
    this.answeredRevision=ticket.revision;
    if(this.processing?.revision===ticket.revision)this.processing=null;
    if(this.continuation?.revision===ticket.revision)this.continuation=null;
    this.drain();
  }
  markSkipped(ticket:LiveReplyTicket):void {this.markAnswered(ticket);}
  retry(ticket:LiveReplyTicket):boolean {
    if(!this.isCurrent(ticket) || this.server || this.answeredRevision===ticket.revision)return false;
    this.processing=null;this.continuation=null;this.drain();return true;
  }
  isCurrent(ticket:LiveReplyTicket):boolean {
    return !!this.latest && this.latest.revision===ticket.revision && this.latest.turn.id===ticket.turn.id;
  }
  reset():void {
    const responseId=this.server?.id,hadServer=!!this.server;
    if(this.server?.cancelTimer)clearTimeout(this.server.cancelTimer);
    this.latest=null;this.processing=null;this.server=null;this.continuation=null;
    this.remoteSpeaking=false;this.remotePending=false;this.representativeSpeaking=false;this.representativePending=false;this.paused=false;
    this.options.onSupersede();if(hadServer)this.options.onCancel(responseId);
    // Revision stays monotonic so old async results cannot revive after reset.
  }
  get state() {
    return {repSpeaking:this.representativeSpeaking,repPending:this.representativePending,buyerSpeaking:this.remoteSpeaking,buyerPending:this.remotePending,paused:this.paused,
      responseActive:!!(this.server || this.processing || this.continuation),serverBusy:!!this.server,
      pendingBuyer:this.latest && this.answeredRevision!==this.latest.revision ? this.latest.turn.id : null};
  }
  private cancel(slot:ServerSlot,replaceCurrent=false):void {
    this.options.onCancel(slot.id);
    if(this.server!==slot || (!replaceCurrent&&this.isCurrent(slot.ticket)) || slot.cancelTimer)return;
    slot.cancelTimer=setTimeout(()=>{
      if(this.server!==slot || (!replaceCurrent&&this.isCurrent(slot.ticket)))return;
      this.server=null;slot.cancelTimer=undefined;this.drain();
    },this.options.cancelAckTimeoutMs??300);
  }
  private drain():void {
    if(this.draining){this.drainAgain=true;return;}
    this.draining=true;
    try {
      do {
        this.drainAgain=false;
        if(this.server)continue;
        const continued=this.continuation;
        const ticket=continued || (!this.processing && this.latest && this.answeredRevision!==this.latest.revision ? this.latest : null);
        if(!ticket || !this.isCurrent(ticket))continue;
        this.continuation=null;this.processing=ticket;
        const slot:ServerSlot={ticket};this.server=slot;
        try {this.options.onRequest(ticket,!!continued);}
        catch(error){if(this.server===slot)this.server=null;if(this.processing===ticket)this.processing=null;throw error;}
      }while(this.drainAgain);
    } finally {this.draining=false;}
  }
}
