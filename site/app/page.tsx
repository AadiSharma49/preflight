import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';
import { Terminal, Row, FileLine } from '@/components/terminal';

const GITHUB = 'https://github.com/AadiSharma49/preflight';

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2 text-fg">
          <Logo size={19} />
          <span className="font-mono text-[13px] tracking-tight">preflight</span>
        </span>
        <nav className="flex items-center gap-3">
          <a
            href={GITHUB}
            className="rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-fg"
          >
            GitHub
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6">
        <Hero />
        <HowItWorks />
        <Learned />
        <Status />
        <CallToAction />
      </main>

      <footer className="mx-auto max-w-3xl px-6 py-16">
        <p className="border-t border-border pt-8 font-mono text-[12px] text-faint">
          preflight — a static analysis tool for dependency upgrades.
        </p>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section className="pt-14 pb-20 sm:pt-20">
      <h1 className="max-w-2xl text-[2.1rem] leading-[1.12] font-medium tracking-[-0.02em] text-fg sm:text-5xl">
        See what breaks before you upgrade.
      </h1>

      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
        Your tools tell you an update is available. preflight tells you which lines of your
        code it breaks.
      </p>

      <div className="mt-9">
        <Terminal command="preflight framer-motion 12 --cwd ./">
          <span className="text-faint">{'  preflight v0.1.0   framer-motion → 12\n\n'}</span>
          <FileLine path="  src/components/ui/settle-text.tsx" />
          <Row loc="3:10" api="motion" kind="import" />
          <Row loc="3:18" api="Variants" kind="import · type-only" flagged />
          <Row loc="11:18" api="Variants" kind="type · type-only" flagged />
          <Row loc="18:20" api="Variants" kind="type · type-only" flagged />
          <Row loc="40:6" api="motion.p" kind="jsx" />
          <Row loc="50:12" api="motion.span" kind="jsx" />
          {'\n'}
          <FileLine path="  src/components/landing/hero.tsx" />
          <Row loc="7:10" api="motion" kind="import" />
          <Row loc="95:10" api="motion.div" kind="jsx" />
          <Row loc="101:11" api="motion.div" kind="jsx" />
          <span className="text-faint">{'    …\n\n'}</span>
          <span className="text-fg">
            {'  102 usages · 3 distinct APIs · 16 of 166 files\n'}
          </span>
          <span>{'  APIs in use: AnimatePresence, Variants, motion\n'}</span>
        </Terminal>
        <p className="mt-3 font-mono text-[12px] text-faint">
          Real output, run against a 166-file production Next.js repo.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Scans your code',
      body: 'Parses every source file into an AST and resolves each import back to its binding, so renamed imports, namespace access and shadowed variables all resolve correctly. Commented-out code and strings that look like imports are never counted.',
    },
    {
      n: '02',
      title: 'Reads the changelog',
      body: 'Works out the version you are actually on from your lockfile, then pulls the release notes for every version between that and the one you are moving to.',
    },
    {
      n: '03',
      title: 'Flags what is risky',
      body: 'Matches the APIs you actually use against what the changelog says changed, separating certain breaks from maybes. Certain breaks fail the check; maybes are flagged for review.',
    },
  ];

  return (
    <section className="border-t border-border py-20">
      <h2 className="text-sm font-medium tracking-tight text-fg">How it works</h2>

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {steps.map((step) => (
          <div key={step.n} className="bg-bg p-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-faint">{step.n}</span>
            </div>
            <h3 className="mt-3 text-[15px] font-medium text-fg">{step.title}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Learned() {
  const entries = [
    {
      title: 'TypeScript types were invisible',
      body: (
        <>
          Babel&apos;s scope resolution only tracks value references. So{' '}
          <code className="font-mono text-[13px] text-fg">
            import type &#123; Variants &#125;
          </code>{' '}
          showed up as an import and then vanished — every line that actually used the type
          was invisible to the scanner. On a TypeScript codebase that is not a small gap: a
          changed type signature breaks your build just as hard as a renamed function. It
          took a third resolution pass, walking TS type positions separately and resolving
          each one back to its binding, before those lines showed up at all. A fixture test
          caught it before it shipped.
        </>
      ),
    },
    {
      title: 'Not every package publishes releases',
      body: (
        <>
          I built the changelog fetcher against the GitHub Releases API, pointed it at
          framer-motion, and got back HTTP 200 and an empty array. The project does not
          publish GitHub releases at all — it keeps its changelog in a{' '}
          <code className="font-mono text-[13px] text-fg">CHANGELOG.md</code>. So for the
          exact package I had spent the previous step scanning, the API had nothing to give.
          That is not a rare edge case, it is a meaningful share of npm. preflight reports it
          plainly instead of showing an all-clear, and a changelog-file fallback is now part
          of the next step.
        </>
      ),
    },
    {
      title: 'Release tags disagree with each other',
      body: (
        <>
          Across four ordinary dependencies I found four conventions:{' '}
          <code className="font-mono text-[13px] text-fg">v1.3.25</code>,{' '}
          <code className="font-mono text-[13px] text-fg">7.9.1</code>,{' '}
          <code className="font-mono text-[13px] text-fg">@clerk/nextjs@7.5.2</code> and{' '}
          <code className="font-mono text-[13px] text-fg">framer-motion@12.0.0</code>. The
          monorepo form is the dangerous one. clerk/javascript tags every package in a single
          repository, so <code className="font-mono text-[13px] text-fg">@clerk/vue@2.4.22</code>{' '}
          and <code className="font-mono text-[13px] text-fg">@clerk/nextjs@2.4.22</code> sit
          side by side. Read a tag as &ldquo;version 2.4.22&rdquo; without checking which
          package it belongs to and you attach the wrong changelog to the wrong upgrade, then
          tell someone their code is safe. That check is a test now.
        </>
      ),
    },
  ];

  return (
    <section className="border-t border-border py-20">
      <h2 className="text-sm font-medium tracking-tight text-fg">What I learned building it</h2>
      <p className="mt-2 max-w-xl text-[13.5px] text-muted">
        Three things that only showed up by running it against real repositories.
      </p>

      <div className="mt-10 flex flex-col gap-10">
        {entries.map((entry) => (
          <article key={entry.title} className="max-w-2xl">
            <h3 className="text-[15px] font-medium text-fg">{entry.title}</h3>
            <p className="mt-2.5 text-[14.5px] leading-[1.75] text-muted">{entry.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Status() {
  return (
    <section className="border-t border-border py-20">
      <h2 className="text-sm font-medium tracking-tight text-fg">Status</h2>

      <dl className="mt-8 max-w-2xl divide-y divide-border border-y border-border">
        <div className="grid gap-1 py-4 sm:grid-cols-[7rem_1fr] sm:gap-6">
          <dt className="font-mono text-[12px] text-faint">working</dt>
          <dd className="text-[14.5px] leading-relaxed text-muted">
            The full pipeline: AST usage scanning, changelog fetching, usage-to-changelog
            matching (certain vs maybe), transitive dependencies from the lockfile, and a
            consolidated report with a CI-readable exit code. 75 tests pass, covering
            renamed imports, shadowed bindings, TypeScript type positions, four release-tag
            conventions, API rate limits, missing repositories, and the matching layer.
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[7rem_1fr] sm:gap-6">
          <dt className="font-mono text-[12px] text-accent">next</dt>
          <dd className="text-[14.5px] leading-relaxed text-muted">
            The GitHub Action that runs this on every pull request and fails the check when
            a certain break is found — the exit code is already in place for it.
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[7rem_1fr] sm:gap-6">
          <dt className="font-mono text-[12px] text-faint">not built</dt>
          <dd className="text-[14.5px] leading-relaxed text-muted">
            Publishing to npm, and an optional AI fallback for changelog lines the rules
            cannot disambiguate (like a package named the same as an export).
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[7rem_1fr] sm:gap-6">
          <dt className="font-mono text-[12px] text-faint">published</dt>
          <dd className="text-[14.5px] leading-relaxed text-muted">
            Not yet. Until it is, run it from source.
          </dd>
        </div>
      </dl>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="border-t border-border py-20">
      <h2 className="text-[1.6rem] font-medium tracking-[-0.02em] text-fg">Try it</h2>
      <p className="mt-3 max-w-lg text-[14.5px] leading-relaxed text-muted">
        Point it at a package and the version you are thinking about moving to.
      </p>

      <div className="mt-7 max-w-xl">
        <Terminal command="npx preflight <package> <version>" />
        <p className="mt-3 text-[13px] text-muted">
          Not on npm yet — clone the repo and run{' '}
          <code className="font-mono text-[12.5px] text-fg">npm link</code> to use it today.
        </p>
      </div>

      <a
        href={GITHUB}
        className="mt-8 inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13.5px] text-fg transition-colors hover:border-fg/25"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        View source
      </a>
    </section>
  );
}
