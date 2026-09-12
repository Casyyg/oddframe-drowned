'use client';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Globe } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { isLanguage, languageLocales, localizeView, translate, type Language } from '@/lib/localization';

export const languageStorageKey = 'oddframe-language-v1';
const LanguageContext = createContext<{language: Language; select: (value: Language) => void}>({language:'en', select:() => {}});
let volatileLanguage: Language = 'en';
const languageChanged = 'oddframe-language-changed';
function readLanguage(): Language {
  try { const saved = localStorage.getItem(languageStorageKey); return isLanguage(saved) ? saved : volatileLanguage; }
  catch { return volatileLanguage; }
}
function subscribeLanguage(notify: () => void) {
  const sync = (event: StorageEvent) => { if (event.key === languageStorageKey || event.key === null) { volatileLanguage = 'en'; notify(); } };
  window.addEventListener('storage', sync);
  window.addEventListener(languageChanged, notify);
  return () => { window.removeEventListener('storage', sync); window.removeEventListener(languageChanged, notify); };
}
export function LanguageProvider({children}: {children: ReactNode}) {
  const language = useSyncExternalStore(subscribeLanguage, readLanguage, () => 'en' as Language);
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
    document.title = 'OddFrame — ' + translate('The Drowned Thirteenth Floor', language);
  }, [language]);
  const value = useMemo(() => ({language, select(next: Language) {
    volatileLanguage = next;
    try { localStorage.setItem(languageStorageKey, next); } catch { /* Device-local preference; not authoritative story data. */ }
    window.dispatchEvent(new Event(languageChanged));
  }}), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() {
  const context = useContext(LanguageContext);
  return {...context, locale:languageLocales[context.language], t:(text:string) => translate(text,context.language), view:(node:ReactNode) => localizeView(node,context.language)};
}
export function LanguagePicker() {
  const {language,select,t} = useLanguage();
  const items = [{value:'en',label:'English'},{value:'zh',label:'中文'},{value:'mn',label:'Монгол'}];
  return <div className="language-control"><Select items={items} value={language} onValueChange={value => { if(isLanguage(value)) select(value); }}><SelectTrigger className="language-trigger" aria-label={t('Language')}><Globe size={16}/><SelectValue/></SelectTrigger><SelectContent className="language-menu" align="end">{items.map(item => <SelectItem key={item.value} value={item.value} className="language-option"><span lang={item.value}>{item.label}</span></SelectItem>)}</SelectContent></Select></div>;
}
