/** UI labels never change stored wording or historical evidence. */
const moves:Record<string,string>={cold_call_gate:"Explain the call’s purpose and reach the appropriate person.",intro:"Introduce yourself and the reason for calling.",needs_discovery:"Clarify the buyer’s relevant needs.",interest_narrowed:"Build on the buyer’s selected interest.",next_step_agreed:"Confirm the agreed next step.",pending_research:"Give room for review and clarify what would help.",trust_objection:"Address the buyer’s concern with supported information.",price_spec_stall:"Answer supported facts and clarify the unresolved detail.",email_close:"Confirm the destination and agreed materials.",follow_up:"Reconnect to the prior conversation and next step.",transfer_wait:"Acknowledge the transfer and keep its status unconfirmed.",negotiation:"Clarify the commercial constraint.",refusal:"Respect the decision and close politely."};
export function readableCoachingMove(value:string|undefined,bilingual=false):string {
 const line=value?.trim()||"";if(moves[line])return moves[line];
 if(/^[a-z]+(?:_[a-z]+)+$/.test(line))return line.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase())+".";
 return line||(bilingual?"查看建议话术。":"Review the suggested wording.");
}
