import { type AIResponse, AppError, authorize, errorResponse, openAI, outputText } from "../../../lib/ai-server";
import { TranslationInput, TRANSLATION_INSTRUCTIONS, translationSchema, resolveTranslations, buildTranslationModelInput } from "../../../lib/translation";
import { responseCharge } from "../../../lib/usage-server";
import type { UsageEntry } from "../../../lib/costs";

export async function POST(request:Request) {
  const charges:UsageEntry[]=[];
  try {
    await authorize(request);
    const parsed=TranslationInput.safeParse(await request.json());
    if(!parsed.success)throw new AppError("Provide up to 8 transcript turns, 6,000 characters per turn and 24,000 characters total, with unique identifiers.");
    const input=parsed.data,model=process.env.OPENAI_TEXT_MODEL||"gpt-4.1-mini";
    const characters=input.turns.reduce((sum,turn)=>sum+turn.text.length,0);
    const response=await openAI("responses",{
      model,store:false,instructions:TRANSLATION_INSTRUCTIONS,input:JSON.stringify(buildTranslationModelInput(input)),
      max_output_tokens:Math.min(24_000,Math.max(800,Math.ceil(characters*1.1)+input.turns.length*60)),
      text:{format:{type:"json_schema",name:"buyer_mandarin_translation",strict:true,schema:translationSchema}},
    },false,12_000,request.signal);
    const result=await response.json() as AIResponse;
    charges.push(responseCharge(result,"coach",model));
    const text=outputText(result);
    if(result.status!=="completed"||!text)throw new AppError("The translation was incomplete. Retry this transcript line.",502);
    let translations;
    try {translations=resolveTranslations(input,JSON.parse(text));}
    catch {throw new AppError("The translation could not be matched to the transcript. Retry this line.",502);}
    return Response.json({translations,_charges:charges},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const response=errorResponse(error);
    return Response.json({...await response.json() as Record<string,unknown>,_charges:charges},{status:response.status,headers:{"Cache-Control":"no-store"}});
  }
}
