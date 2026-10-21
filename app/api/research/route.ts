import { AppError, authorize, errorResponse, openAI, outputText } from "../../../lib/ai-server";
import { aggregateResearchUsage, buyerBriefSchema, groundedBuyerBrief, publicResearchUrl, RESEARCH_INSTRUCTIONS, ResearchInput, researchSources, STRUCTURE_RESEARCH_INSTRUCTIONS, type ResearchAIResponse } from "../../../lib/buyer-research";
import { responseCharge } from "../../../lib/usage-server";
import type { UsageEntry } from "../../../lib/costs";

export async function POST(request: Request) {
  const charges:UsageEntry[]=[];
  try {
    await authorize(request);
    const parsed = ResearchInput.safeParse(await request.json());
    if (!parsed.success) throw new AppError("Add the buyer’s company name and public company website before researching.");
    const input = {...parsed.data,website:publicResearchUrl(parsed.data.website,true)!};
    const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
    const searchResponse = await openAI("responses",{
      model,store:false,instructions:RESEARCH_INSTRUCTIONS,input:JSON.stringify(input),max_output_tokens:2400,
      tools:[{type:"web_search",search_context_size:"medium"}],tool_choice:"required",include:["web_search_call.action.sources"],
    },false,60_000);
    const researched = await searchResponse.json() as ResearchAIResponse;
    const report = outputText(researched), sources = researchSources(researched);
    const searchCalls = (researched.output || []).filter(item => item.type === "web_search_call").length;
    charges.push(responseCharge(researched,"research",model,searchCalls));
    if (researched.status === "incomplete" || !report || !searchCalls || !sources.length) throw new AppError("Research did not return enough cited company information. Check the company website and try again.",502,"research_unavailable");
    const formatResponse = await openAI("responses",{
      model,store:false,instructions:STRUCTURE_RESEARCH_INSTRUCTIONS,
      input:JSON.stringify({company:input.company,website:input.website,products:input.products,report,allowedSources:sources}),max_output_tokens:2200,
      text:{format:{type:"json_schema",name:"buyer_brief",strict:true,schema:buyerBriefSchema}},
    },false,40_000);
    const formatted = await formatResponse.json() as ResearchAIResponse;
    charges.push(responseCharge(formatted,"research",model));
    let content: unknown;
    try { content=JSON.parse(outputText(formatted)); } catch { throw new AppError("The research brief could not be read. Please try again.",502,"research_unavailable"); }
    const brief = formatted.status !== "incomplete" && groundedBuyerBrief(content,input,sources);
    if (!brief) throw new AppError("No company facts could be matched to the research sources. Check the website or try a more specific company name.",502,"research_unavailable");
    return Response.json({brief,usage:aggregateResearchUsage([researched,formatted]),usageCalls:[{model:researched.model || model,usage:researched.usage,searchCalls},{model:formatted.model || model,usage:formatted.usage,searchCalls:0}],searchCalls,model,_charges:charges},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { const response=errorResponse(error); const data=await response.json() as Record<string,unknown>; return Response.json({...data,_charges:charges},{status:response.status,headers:{"Cache-Control":"private, no-store"}}); }
}
