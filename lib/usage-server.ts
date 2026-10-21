import { priceTextUsage, type UsageEntry } from "./costs";
export function responseCharge(result:{id?:string;usage?:unknown;model?:string},kind:UsageEntry["kind"],fallbackModel:string,searchCalls=0):UsageEntry {
  const model=result.model || fallbackModel;
  return {id:result.id || crypto.randomUUID(),at:Date.now(),kind,model,...priceTextUsage(result.usage,model,searchCalls)};
}
