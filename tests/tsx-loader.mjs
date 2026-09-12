// Read-only TypeScript/JSX loader for server-rendered tests; no browser or source output files.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
export async function resolve(specifier, context, next) {
  const requested = specifier.startsWith('@/') ? new URL(specifier.slice(2), root).href : specifier;
  try { return await next(requested, context); }
  catch (error) {
    if (requested.startsWith('.') || requested.startsWith('file:')) {
      for (const extension of ['.ts','.tsx']) {
        const candidate = new URL(requested + extension, context.parentURL);
        if (existsSync(candidate)) return {url:candidate.href,shortCircuit:true};
      }
    }
    throw error;
  }
}
export async function load(url, context, next) {
  if (url.startsWith(root.href) && /\.(ts|tsx)$/.test(url)) {
    return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{fileName:fileURLToPath(url),compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  }
  if (url.startsWith(new URL('lib/',root).href) && url.endsWith('.json')) return {format:'module',shortCircuit:true,source:'export default '+readFileSync(fileURLToPath(url),'utf8')};
  return next(url, context);
}
