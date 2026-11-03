import { type AIResponse, AppError, authorize, errorResponse, openAI, outputText } from "../../../lib/ai-server";
import { PacketInput, PACKET_INSTRUCTIONS, packetSchema, PACKET_REVIEW_INSTRUCTIONS, packetReviewSchema, buildDecisionPacket, emptyDecisionPacket, confirmationOnly } from "../../../lib/decision-packet";
import { responseCharge } from "../../../lib/usage-server";
import type { UsageEntry } from "../../../lib/costs";

export async function POST(request:Request) {
  const charges:UsageEntry[]=[];
  try {
    await authorize(request);
    const parsed=PacketInput.safeParse(await request.json());
    if(!parsed.success)throw new AppError("The saved call could not be read. Check its transcript and selected company materials.");
    const {call,language,sources,manufacturer,brain,conversationState,clientContext}=parsed.data;
    if(sources.reduce((n,source)=>n+source.text.length,0)>160_000)throw new AppError("The packet supports 160,000 characters of company reference material.");
    if(call.turns.reduce((n,turn)=>n+turn.text.length,0)>400_000)throw new AppError("This transcript is too large for one decision packet.");
    if(new Set(call.turns.map(turn=>turn.id)).size!==call.turns.length)throw new AppError("Transcript turn identifiers must be unique before generating evidence links.");
    if(!call.turns.length)return Response.json({...emptyDecisionPacket(call,language),_charges:[]},{headers:{"Cache-Control":"no-store"}});
    const model=process.env.OPENAI_TEXT_MODEL||"gpt-4.1-mini";
    const response=await openAI("responses",{
      model,store:false,instructions:PACKET_INSTRUCTIONS+'\nCompany Brain and conversationState describe company policy, remembered context and the current plan. They are not evidence of words spoken on this call. Learning examples never establish buyer commitments or authorize company facts.',
      input:JSON.stringify({language,call,manufacturer,sources,brain,conversationState,clientContext}),max_output_tokens:4200,
      text:{format:{type:"json_schema",name:"manager_decision_packet",strict:true,schema:packetSchema}},
    });
    const result=await response.json() as AIResponse;
    charges.push(responseCharge(result,"coach",model));
    const output=outputText(result);
    if(!output||result.status==="incomplete")throw new AppError("The decision packet was incomplete. Try generating it again.",502);
    const draft=JSON.parse(output);
    let packet=buildDecisionPacket(draft,call,language,sources);
    const reviewResponse=await openAI("responses",{
      model,store:false,instructions:PACKET_REVIEW_INSTRUCTIONS,input:JSON.stringify({packet,call,sources,brain,conversationState,clientContext}),max_output_tokens:600,
      text:{format:{type:"json_schema",name:"packet_factual_support",strict:true,schema:packetReviewSchema}},
    });
    const reviewed=await reviewResponse.json() as AIResponse;
    charges.push(responseCharge(reviewed,"coach",model));
    const reviewText=outputText(reviewed);
    if(!reviewText||reviewed.status==="incomplete")throw new AppError("The packet's factual review was incomplete. Please try again.",502);
    const verdict=JSON.parse(reviewText) as {summarySupported:boolean;decisionsSupported:boolean;followUpSupported:boolean;riskyTurnIds:string[];reason:string};
    const withheld=verdict.summarySupported!==true||verdict.decisionsSupported!==true||verdict.followUpSupported!==true;
    packet={...packet,
      summary:verdict.summarySupported===true?packet.summary:buildDecisionPacket({...draft,summary:[]},call,language,sources).summary,
      decisionsNeeded:verdict.decisionsSupported===true?packet.decisionsNeeded:buildDecisionPacket({decisionsNeeded:[]},call,language,sources).decisionsNeeded,
      followUp:verdict.followUpSupported===true?packet.followUp:"[Review the actual transcript and confirm the buyer’s next step before preparing the email. The generated draft did not pass factual review.]",
      commitments:packet.commitments.map(commitment=>commitment.speaker==="you"&&!confirmationOnly(commitment.quote)&&verdict.riskyTurnIds.includes(commitment.turnId)?{...commitment,risky:true,reason:[commitment.reason,verdict.reason.slice(0,300)].filter(Boolean).join(" ")}:commitment),
      notCaptured:withheld?[...packet.notCaptured,language==="zh"?"部分生成内容未通过事实核对，已替换或省略；请对照原文审核。":"Some generated statements failed factual review and were replaced or omitted; review the source transcript."]:packet.notCaptured,
    };
    return Response.json({...packet,_charges:charges},{headers:{"Cache-Control":"no-store"}});
  }catch(error){const response=errorResponse(error);return Response.json({...await response.json() as Record<string,unknown>,_charges:charges},{status:response.status});}
}
