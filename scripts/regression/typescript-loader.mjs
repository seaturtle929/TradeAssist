import {readFileSync,existsSync} from 'node:fs';
import ts from 'typescript';

// Only transpiles local source. No app server, credentials or API requests.
export function resolve(specifier,context,next){
  if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){
    const url=new URL(specifier,context.parentURL);
    if(!/\.[a-z]+$/i.test(url.pathname))for(const suffix of ['.ts','.tsx','/index.ts','/index.tsx']){
      if(existsSync(new URL(url.href+suffix)))return {url:url.href+suffix,shortCircuit:true};
    }
  }
  return next(specifier,context);
}
export function load(url,context,next){
  if(url.startsWith('file:')&&/\.tsx?$/.test(new URL(url).pathname))return {
    format:'module',shortCircuit:true,
    source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{fileName:new URL(url).pathname,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  };
  return next(url,context);
}
