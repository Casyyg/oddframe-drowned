'use client';
/* oxlint-disable next/no-html-link-for-pages, next/no-img-element -- This static Node-served export uses full page navigation and local images without a Next image optimisation service. */
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { LanguagePicker, useLanguage } from '@/components/language-provider';
export default function Home() {
  const {view} = useLanguage();
  return view(
    <div className="drowned-shell">
      <header className="drowned-nav">
        <a className="drowned-brand" href="/">
          ODDFRAME <span>Interactive stories</span>
        </a>
        <a href="/insights/">
          Session insights <ArrowUpRight size={15} />
        </a>
        <LanguagePicker/>
      </header>
      <main className="drowned-home">
        <section>
          <p className="drowned-kicker">COSMIC HORROR</p>
          <h1>
            The Drowned
            <br />
            Thirteenth Floor
          </h1>
          <p className="drowned-lead">
            Your building has twelve floors.
            <br />
            Tonight, the lift offers one more.
          </p>
          <p className="drowned-muted">
            Step into a hotel that remembers you. Follow the clues, choose your
            way out, and discover one of three endings.
          </p>
          <a className="drowned-button" href="/drowned/">
            Enter the lift <ArrowRight size={18} />
          </a>
        </section>
        <figure className="drowned-cover">
          <img
            src="/media/drowned/corridor.jpeg"
            width={720}
            height={1280}
            alt="An open brass lift facing a flooded hotel corridor and a motionless attendant"
          />
          <figcaption>B13 · THE HOTEL BELOW</figcaption>
        </figure>
      </main>
    </div>
  );
}
