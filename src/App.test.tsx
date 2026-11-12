import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { findings } from './findings';

afterEach(cleanup);

const cards = () => document.querySelectorAll('.finding');

describe('review page', () => {
  it('lists every finding with the first one open', () => {
    render(<App />);
    expect(cards().length).toBe(findings.length);
    const toggles = screen.getAllByRole('button', { expanded: true });
    expect(toggles).toHaveLength(1);
    expect(document.getElementById('h1-body')?.hidden).toBe(false);
  });

  it('filters by severity and reports the count', () => {
    render(<App />);
    const group = screen.getByRole('group', { name: 'Filter by severity' });
    fireEvent.click(within(group).getByRole('button', { name: /^High/ }));
    const highs = findings.filter((f) => f.severity === 'high').length;
    expect(cards().length).toBe(highs);
    expect(screen.getByText(`${highs} of ${findings.length} findings`)).toBeTruthy();
    expect(within(group).getByRole('button', { name: /^High/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: /^All/ }));
    expect(cards().length).toBe(findings.length);
  });

  it('searches across titles and source paths', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Search findings'), { target: { value: 'sw.js' } });
    const ids = [...cards()].map((c) => c.id);
    expect(ids).toContain('l7');
    expect(ids.length).toBeLessThan(findings.length);
  });

  it('shows an empty state that resets the filters', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Search findings'), { target: { value: 'zzzz-no-match' } });
    expect(cards().length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show all findings' }));
    expect(cards().length).toBe(findings.length);
  });

  it('expands and collapses one finding and all findings', () => {
    render(<App />);
    const t = document.querySelector('#m1 .finding-toggle') as HTMLButtonElement;
    expect(t.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('m1-body')?.hidden).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(findings.length);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
    findings.forEach((f) => expect(document.getElementById(`${f.id}-body`)?.hidden).toBe(true));
  });

  it('finds the admin-page findings by path', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Search findings'), { target: { value: 'dapp/admin/' } });
    const ids = [...cards()].map((c) => c.id);
    expect(ids).toEqual(findings.filter((f) => f.locations.some((l) => l.path.startsWith('dapp/admin/'))).map((f) => f.id));
    expect(ids).toContain('m5');
  });

  it('copies a fix to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the fix for H1' }));
    expect(writeText).toHaveBeenCalledWith(findings[0].code);
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('links every location to the pinned commit', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const links = [...document.querySelectorAll('.locs a')] as HTMLAnchorElement[];
    expect(links.length).toBe(findings.reduce((n, f) => n + f.locations.length, 0));
    const all = findings.flatMap((f) => f.locations);
    links.forEach((a, i) => {
      expect(a.href).toMatch(/github\.com\/z0r0z\/tacit\/blob\/2a3ec21c62f4af6bd88e72c525c242a08700c246\/dapp\/.+/);
      // a line anchor exactly where a line was pinned; admin snippets link the file
      if (all[i].line) expect(a.href.endsWith(`#L${all[i].line}`)).toBe(true);
      else expect(a.href).not.toContain('#');
    });
  });
});
