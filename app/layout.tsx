import type { Metadata } from 'next';
import './globals.css';
import './game.css';
import './drowned.css';
import { LanguageProvider } from '@/components/language-provider';
export const metadata: Metadata = { title: 'OddFrame — The Drowned Thirteenth Floor', description: 'A short interactive cosmic-horror story. A hotel beneath the surface. Three ways to leave.' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className="dark"><body><LanguageProvider>{children}</LanguageProvider></body></html>}
