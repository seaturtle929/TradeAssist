import { priceTextUsage, type UsageEntry } from "./costs";
export function responseCharge(result:{id?:string;usage?:unknown;model?:string;service_tier?:string},kind:UsageEntry["kind"],fallbackModel:string,searchCalls=0):UsageEntry {
  const model=result.model || fallbackModel;
  const price=priceTextUsage(result.usage,model,searchCalls),fastLuna=model==="gpt-6-luna"&&["fast","priority"].includes(result.service_tier||"");
  return {id:result.id || crypto.randomUUID(),at:Date.now(),kind,model,...price,usd:price.usd*(fastLuna?2:1),...(result.service_tier?{serviceTier:result.service_tier}:{})};
}
