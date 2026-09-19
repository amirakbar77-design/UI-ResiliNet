'use client';

/**
 * The method sheet behind the book icon: what is real, what is derived,
 * what is assumed, and the December 2014 check. Every value is read from
 * the model's own constants (lib/method.ts), so it cannot drift.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FORECAST_FILES, floodCurve, type Forecast } from '@/lib/forecast';
import { GAUGE_RECORD_2014, gaugeToHandLevel } from '@/lib/gauge';
import { type HindcastCheck, hindcastChecks } from '@/lib/hindcast';
import { type MethodRow, methodSections } from '@/lib/method';
import { assessNetwork } from '@/lib/network';
import type { TerrainData } from '@/lib/terrain-field';
import type { ViewshedMask } from '@/lib/viewshed';

const verdictGlyph = {
  hit: ['✓', 'text-emerald-300', 'hit'],
  partial: ['~', 'text-amber-300', 'partial'],
  miss: ['✗', 'text-red-300', 'miss'],
} as const;

function Table({
  title,
  head,
  rows,
  tone = 'slate',
}: {
  title: string;
  head: [string, string, string];
  rows: MethodRow[];
  tone?: 'slate' | 'amber';
}) {
  return (
    <section aria-label={title}>
      <h3
        className={`text-[11px] font-semibold tracking-[0.12em] uppercase ${tone === 'amber' ? 'text-amber-200/90' : 'text-slate-400'}`}
      >
        {title}
      </h3>
      <table className="mt-1.5 w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.08em] text-slate-500 uppercase">
            <th className="w-[24%] py-1 pr-3 font-medium">{head[0]}</th>
            <th className="py-1 pr-3 font-medium">{head[1]}</th>
            <th className="w-[26%] py-1 font-medium">{head[2]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, what, source]) => (
            <tr key={name} className="border-t border-slate-600/25 align-top">
              <td className="py-1.5 pr-3 font-medium text-white">{name}</td>
              <td className="py-1.5 pr-3 text-slate-200">{what}</td>
              <td className="py-1.5 text-slate-400">{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function MethodPanel({
  open,
  onClose,
  terrain,
  siteMasks,
  forecast,
  onOpenHindcast,
}: {
  open: boolean;
  onClose: () => void;
  terrain: TerrainData | null;
  siteMasks: Map<string, ViewshedMask> | null;
  /** The file the app is running on; only its Live init date is quoted. */
  forecast: Forecast | null;
  /** Switches the app to the December 2014 hindcast and closes the sheet. */
  onOpenHindcast: () => void;
}) {
  const [checks, setChecks] = useState<HindcastCheck[] | null>(null);

  // The 2014 check needs the 2014 rain; fetch it once, the first time the sheet opens.
  useEffect(() => {
    if (!open || checks || !terrain || !siteMasks) return;
    let cancelled = false;
    fetch(FORECAST_FILES['hindcast-2014'])
      .then((r) => (r.ok ? (r.json() as Promise<Forecast>) : Promise.reject(new Error(String(r.status)))))
      .then((file) => {
        if (cancelled) return;
        const level = gaugeToHandLevel(GAUGE_RECORD_2014);
        const network = assessNetwork(terrain, floodCurve(file, level));
        setChecks(hindcastChecks(terrain, network, siteMasks, level));
      })
      .catch((error: unknown) => console.error('Failed to load the 2014 hindcast', error));
    return () => {
      cancelled = true;
    };
  }, [open, checks, terrain, siteMasks]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const sections = methodSections(terrain?.meta ?? null, forecast);

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close the method sheet"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/45"
      />
      <dialog
        open
        aria-modal="true"
        aria-labelledby="method-title"
        className="glass-panel absolute inset-0 m-0 flex max-h-none w-auto max-w-none flex-col overflow-hidden border-0 p-0 text-inherit md:inset-auto md:left-16 md:top-16 md:max-h-[calc(100vh-5rem)] md:w-[min(920px,calc(100vw-5rem))] md:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-600/30 px-5 py-4">
          <div>
            <h2 id="method-title" className="text-base font-semibold text-white">
              Method
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              What is real, what is derived, what is assumed. Values are read from the model&rsquo;s own constants.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
            className="size-9 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-5 py-4 pb-24 md:pb-5">
          <Table title="Real data" head={['Source', 'Gives', 'Licence · vintage']} rows={sections.real} />
          <Table title="Synthetic" head={['Input', 'What it is', 'Status']} rows={sections.synthetic} tone="amber" />
          <Table title="Derived" head={['Thing', 'How', 'Where']} rows={sections.derived} />
          <Table title="Assumptions" head={['Constant', 'Value in the model', 'A real value comes from']} rows={sections.assumptions} />
          <section aria-label="Seeds">
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">Seeds</h3>
            <p className="mt-1.5 text-xs text-slate-200">{sections.seeds}</p>
          </section>
          <section aria-label="Checked against the record">
            <h3 className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
              Checked against the record · December 2014
            </h3>
            <p className="mt-1.5 text-xs text-slate-400">
              At the recorded {GAUGE_RECORD_2014} m peak: four things people reported, and what the model says.
              The river constants were not tuned to fit it.
            </p>
            {checks ? (
              <table className="mt-2 w-full border-collapse text-xs">
                <tbody>
                  {checks.map((c) => {
                    const [glyph, tone, word] = verdictGlyph[c.verdict];
                    return (
                      <tr key={c.key} className="border-t border-slate-600/25 align-top" title={c.source}>
                        <td className={`w-5 py-1.5 font-bold ${tone}`} aria-label={word}>
                          {glyph}
                        </td>
                        <td className="w-[30%] py-1.5 pr-3 font-medium text-white">{c.fact}</td>
                        <td className="py-1.5 text-slate-200">{c.model}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Loading the 2014 rain…</p>
            )}
            <Button
              type="button"
              onClick={onOpenHindcast}
              className="mt-3 min-h-9 rounded-lg bg-sky-400/15 px-3 text-xs font-semibold text-sky-100 hover:bg-sky-400/25"
            >
              Open the December 2014 hindcast
            </Button>
          </section>
        </div>
      </dialog>
    </div>
  );
}
