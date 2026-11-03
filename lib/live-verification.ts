type Entry<T>={say:string;epoch:number;controller:AbortController;promise:Promise<T>};

/** One main-line check per exact reply/epoch; superseded checks never publish a stale result. */
export class LiveVerification<T> {
  private entry:Entry<T>|null=null;
  private latestEpoch=-Infinity;
  private readonly options:{verify:(say:string,signal:AbortSignal,epoch:number)=>Promise<T>};
  constructor(options:{verify:(say:string,signal:AbortSignal,epoch:number)=>Promise<T>}){this.options=options;}

  verify(say:string,epoch:number):Promise<T> {
    if(epoch<this.latestEpoch)return Promise.reject(new DOMException("The live reply was superseded.","AbortError"));
    this.latestEpoch=epoch;
    if(this.entry?.say===say&&this.entry.epoch===epoch)return this.entry.promise;
    this.invalidate();
    const controller=new AbortController();
    const entry:Entry<T>={say,epoch,controller,promise:null as unknown as Promise<T>};
    this.entry=entry;
    entry.promise=new Promise<T>((resolve,reject)=>{
      let settled=false;
      const finish=(error:unknown,value?:T)=>{
        if(settled)return;settled=true;controller.signal.removeEventListener("abort",aborted);
        if(error){if(this.entry===entry)this.entry=null;reject(error);}else resolve(value as T);
      };
      const aborted=()=>finish(new DOMException("The live reply was superseded.","AbortError"));
      controller.signal.addEventListener("abort",aborted,{once:true});
      Promise.resolve().then(()=>{
        if(controller.signal.aborted)throw new DOMException("The live reply was superseded.","AbortError");
        return this.options.verify(say,controller.signal,epoch);
      }).then(value=>{
        if(controller.signal.aborted||this.entry!==entry)aborted();else finish(null,value);
      },error=>finish(error));
    });
    return entry.promise;
  }

  invalidate():void {
    const entry=this.entry;this.entry=null;entry?.controller.abort();
  }
}
