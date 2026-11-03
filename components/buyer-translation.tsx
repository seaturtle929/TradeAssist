import type { Turn } from "../lib/trade";
import { canTranslateTurn } from "../lib/transcript-translations";

export function BuyerTranslation({turn,pending=false,error,onRetry}:{turn:Turn;pending?:boolean;error?:string;onRetry?:()=>void}) {
  if(!canTranslateTurn(turn))return null;
  if(turn.translationZh)return <div className="buyer-translation" lang="zh-CN" aria-label="Mandarin translation"><span className="translation-language">中文</span><p>{turn.translationZh}</p></div>;
  if(pending)return <div className="buyer-translation translation-pending" lang="zh-CN" role="status">正在翻译…</div>;
  if(error)return <div className="buyer-translation translation-error" lang="zh-CN"><span title={error}>翻译暂不可用</span>{onRetry&&<button type="button" className="text-button" aria-label="Retry Mandarin translation" title={error} onClick={onRetry}>重试</button>}</div>;
  return null;
}
