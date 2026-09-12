import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import ui from './translations.json';
import story from './story-translations.json';
import extra from './extra-translations.json';

export type Language = 'en' | 'zh' | 'mn';
export const languageLocales = { en: 'en-AU', zh: 'zh-CN', mn: 'mn-MN' } as const;
export function isLanguage(value: unknown): value is Language { return value === 'en' || value === 'zh' || value === 'mn'; }
export const catalog: Record<string, string[]> = { ...ui, ...story, ...extra };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const folded = new Map(Object.keys(catalog).map(key => [key.toLowerCase(), key]));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrases = new RegExp('(?<![A-Za-z0-9_])(?:' + Object.keys(catalog).sort((a,b) => b.length-a.length).map(escape).join('|') + ')(?![A-Za-z0-9_])', 'gi');

// Translate presentation strings only. Scene IDs, saved state, media URLs and API payloads stay unchanged.
export function translate(text: string, language: Language): string {
  if (language === 'en') return text;
  const normalized = normalize(text);
  if (!normalized) return text;
  const key = Object.hasOwn(catalog, normalized) ? normalized : folded.get(normalized.toLowerCase());
  const index = language === 'zh' ? 0 : 1;
  const result = key ? catalog[key][index] : normalized.replace(phrases, match => catalog[folded.get(match.toLowerCase())!][index]);
  return (text.match(/^\s+/)?.[0] ?? '') + result + (text.match(/\s+$/)?.[0] ?? '');
}

// A pure React render transform, not DOM mutation or machine translation. Keys, refs and event handlers are preserved.
// Each page passes its own rendered view; components with private labels (the language picker) localize those themselves.
export function localizeView(node: ReactNode, language: Language): ReactNode {
  if (typeof node === 'string') return translate(node, language);
  if (Array.isArray(node)) return node.map((child, index) => {
    const translated = localizeView(child, language);
    return isValidElement(translated) && translated.key === null ? cloneElement(translated, {key:'localized-position-'+index}) : translated;
  });
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (['code','script','style'].includes(String(element.type)) || element.props['data-no-translate']) return element;
  const props: Record<string, unknown> = {};
  for (const key of ['aria-label','alt','title','placeholder']) if (typeof element.props[key] === 'string') props[key] = translate(element.props[key] as string, language);
  if ('children' in element.props) props.children = localizeView(element.props.children as ReactNode, language);
  return cloneElement(element, props);
}
