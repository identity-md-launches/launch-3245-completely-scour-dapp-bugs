import { useEffect, useMemo, useState } from 'react';
import {
  COMMIT_SHORT,
  REPO,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  findings,
  improvements,
  locLabel,
  sourceUrl,
  type Finding,
  type Severity,
} from './findings';

type Filter = 'all' | Severity;

const matches = (f: Finding, q: string) => {
  if (!q) return true;
  const hay = [f.id, f.title, f.area, f.now, f.impact, f.fix, ...f.locations.map((l) => `${locLabel(l.path, l.line)} ${l.note ?? ''}`)]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('failed');
    }
  };
  return (
    <button type="button" className="btn btn-quiet" onClick={copy} aria-label={label}>
      <span aria-live="polite">{state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy fix'}</span>
    </button>
  );
}

function FindingCard({ f, open, onToggle }: { f: Finding; open: boolean; onToggle: () => void }) {
  const bodyId = `${f.id}-body`;
  return (
    <li className={`finding sev-${f.severity}`} id={f.id}>
      <h3 className="finding-head">
        <button type="button" className="finding-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className={`badge badge-${f.severity}`}>
            {SEVERITY_LABEL[f.severity]} <span className="badge-id">{f.id.toUpperCase()}</span>
          </span>
          <span className="finding-title">{f.title}</span>
          <span className="finding-meta">
            {f.area} · {locLabel(f.locations[0].path.replace(/^dapp\//, ''), f.locations[0].line)}
          </span>
          <svg className="chev" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>
      <div className="finding-body" id={bodyId} hidden={!open}>
        <dl className="facts">
          <dt>What happens</dt>
          <dd>{f.now}</dd>
          <dt>Impact</dt>
          <dd>{f.impact}</dd>
          <dt>Fix</dt>
          <dd>{f.fix}</dd>
        </dl>
        {f.code && (
          <div className="code-wrap">
            <pre className="code">
              <code>{f.code}</code>
            </pre>
            <CopyButton text={f.code} label={`Copy the fix for ${f.id.toUpperCase()}`} />
          </div>
        )}
        <h4 className="where">Where in the source</h4>
        <ul className="locs">
          {f.locations.map((l) => (
            <li key={`${l.path}:${l.line}`}>
              <a href={sourceUrl(l)} target="_blank" rel="noopener noreferrer" className="mono">
                {locLabel(l.path, l.line)}
              </a>
              {l.note && <span className="loc-note"> {l.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export default function App() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => {
    const id = typeof location !== 'undefined' ? location.hash.slice(1) : '';
    return new Set(findings.some((f) => f.id === id) ? [id] : [findings[0].id]);
  });

  useEffect(() => {
    const id = location.hash.slice(1);
    if (findings.some((f) => f.id === id)) document.getElementById(id)?.scrollIntoView();
  }, []);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    findings.forEach((f) => (c[f.severity] += 1));
    return c;
  }, []);

  const shown = findings.filter((f) => (filter === 'all' || f.severity === filter) && matches(f, query.trim()));
  const allOpen = shown.length > 0 && shown.every((f) => open.has(f.id));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (value: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      shown.forEach((f) => (value ? next.add(f.id) : next.delete(f.id)));
      return next;
    });

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: findings.length },
    ...SEVERITY_ORDER.map((s) => ({ key: s, label: SEVERITY_LABEL[s], count: counts[s] })),
  ];

  return (
    <>
      <a className="skip" href="#findings">
        Skip to findings
      </a>
      <header className="top">
        <a className="brand" href="#top" aria-label="Tacit bug review, back to top">
          <img src="./favicon.svg" alt="" width="24" height="24" />
          <span>Tacit bug review</span>
        </a>
        <a className="top-link" href={REPO} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
      </header>

      <main id="top">
        <section className="intro" aria-labelledby="page-title">
          <h1 id="page-title">Tacit dapp bugs, ranked by risk</h1>
          <p className="lede">
            A source review of the <span className="mono">dapp/</span> folder of z0r0z/tacit at commit{' '}
            <a href={`${REPO}/tree/${COMMIT_SHORT}`} className="mono" target="_blank" rel="noopener noreferrer">
              {COMMIT_SHORT}
            </a>
            , with a fix for every bug.
          </p>
        </section>

        <section id="findings" className="findings" aria-labelledby="findings-title">
          <h2 id="findings-title" className="sr-only">
            Findings
          </h2>
          <div className="controls">
            <div className="filters" role="group" aria-label="Filter by severity">
              {filters.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className={`chip${x.key !== 'all' ? ` chip-${x.key}` : ''}`}
                  aria-pressed={filter === x.key}
                  onClick={() => setFilter(x.key)}
                >
                  {x.label} <span className="chip-count">{x.count}</span>
                </button>
              ))}
            </div>
            <div className="search-row">
              <label htmlFor="q" className="sr-only">
                Search findings
              </label>
              <input
                id="q"
                type="search"
                placeholder="Search: chain, innerHTML, sw.js"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="btn btn-quiet" onClick={() => setAll(!allOpen)} disabled={!shown.length}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            <p className="result-count" aria-live="polite">
              {shown.length === findings.length ? `${shown.length} findings` : `${shown.length} of ${findings.length} findings`}
            </p>
          </div>

          {shown.length ? (
            <ol className="finding-list">
              {shown.map((f) => (
                <FindingCard key={f.id} f={f} open={open.has(f.id)} onToggle={() => toggle(f.id)} />
              ))}
            </ol>
          ) : (
            <div className="empty">
              <p>No findings match “{query.trim()}” at this severity.</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Show all findings
              </button>
            </div>
          )}
        </section>

        <section className="section" aria-labelledby="improve-title">
          <h2 id="improve-title">Changes that prevent the next bug</h2>
          <ol className="improve">
            {improvements.map((i) => (
              <li key={i.title}>
                <h3>{i.title}</h3>
                <p>{i.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="method-title">
          <h2 id="method-title">How the review was done</h2>
          <div className="prose">
            <p>
              The <span className="mono">dapp/</span> folder holds about 1,270 files, including a 2.97 MB{' '}
              <span className="mono">tacit.js</span>. The review swept all of it for known risk patterns: chain checks
              before each <span className="mono">eth_sendTransaction</span>, HTML sinks, key and note storage, random
              sources, float-to-integer amounts, module loading and the service worker. Every finding was then read in
              context, including the branch guards between a source and a sink, and its line numbers pinned to commit{' '}
              {COMMIT_SHORT}.
            </p>
            <p>
              Severity follows impact: High breaks a primary flow or can send a transaction to the wrong place; Medium
              misleads the user or weakens a safety check; Low is a latent risk or a privacy leak with limited reach.
            </p>
            <p>
              The four admin pages in <span className="mono">dapp/admin/</span> (gas-relay, proof-market, tacit-chain
              and token-pools) are covered too: their wallet connection, chain checks, simulation, send, receipt and
              rendering code (M5, L8 to L11). All four render through textContent, keep nothing in storage and send no
              ETH value. Their findings cite a code snippet you can search for in the linked file at {COMMIT_SHORT}
              instead of a line number.
            </p>
            <p>
              Limits: this is a static review. No wallet was connected, no transaction was sent and no admin deploy was
              simulated, so wallet-specific switch behaviour, a pending deploy and RPC outages were read from the code,
              not observed. The kit.json, kits.json and hub.json files those pages load at run time, the Solidity
              contracts, the zero-knowledge circuits, and the relay and worker services were not reviewed. The one live
              check was a HEAD request to tacit.finance for its security headers (L6).
            </p>
          </div>
        </section>
      </main>

      <footer className="foot">
        <p>
          Reviewed source: <a href={REPO}>github.com/z0r0z/tacit</a> at {COMMIT_SHORT}. Line links open that exact commit.
        </p>
      </footer>
    </>
  );
}
