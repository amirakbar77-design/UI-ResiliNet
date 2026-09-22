'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  CloudRain,
  Compass,
  MapPin,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  Route,
  ShieldCheck,
  Signal,
} from 'lucide-react';
import type { Recommendation } from '@/lib/recommend';

type Stage = 'now' | 'forecast' | 'site';
type Props = {
  paused: boolean;
  onPause: (paused: boolean) => void;
  stage: Stage;
  ready: boolean;
  hour: number;
  maxHour: number;
  levels: number[];
  playingForecast: boolean;
  onHour: (hour: number) => void;
  onForecastEnd: () => void;
  onNext: () => void;
  onStage: (stage: Stage) => void;
  onStart: () => void;
  onSkip: () => void;
  running: boolean;
  done: boolean;
  reachableKm: number;
  checked: number;
  total: number;
  recommendation: Recommendation | null;
  withoutSignal: number | null;
  onReset: () => void;
  onResetView: () => void;
};

const chapters = [
  {
    label: 'Meet the valley',
    title: 'When the water rises, connection matters.',
    text: 'Explore the Sungai Galas valley in Kelantan. These communities depend on mobile towers to stay in touch. Follow a simulated storm and see how we can keep people connected.',
    look: 'Blue water marks flooded ground. Roads connect the communities scattered between these hills.',
    icon: Compass,
  },
  {
    label: 'Watch the storm',
    title: 'See the storm before it cuts people off.',
    text: 'Rain falls across the valley and the river rises. Flooded roads can block help from reaching mobile towers. When their backup power runs out, people can lose signal.',
    look: 'Watch the rain move over the terrain. Move the timeline to see how flooding changes over time.',
    icon: CloudRain,
  },
  {
    label: 'Find a way through',
    title: 'One portable tower. Find its best place.',
    text: 'ResiliNet checks the roads from the response base, then compares reachable places for a portable tower. It looks for a location that can reconnect people and link to the working network.',
    look: 'Follow the glowing roads. Each new marker is a possible tower location; its coverage lights up as it is checked.',
    icon: Route,
  },
  {
    label: 'See the difference',
    title: 'A plan to keep people connected.',
    text: 'The highlighted locations show where help can make a difference. The plan combines generator support with a portable tower when a useful, reachable location is available.',
    look: 'The raised mast marks the recommended tower. Tap other candidate markers to preview their coverage.',
    icon: ShieldCheck,
  },
];

export function GuidedDemo(p: Props) {
  const { paused, onPause: setPaused } = p;
  // Keep actions fresh without restarting chapter timers on terrain updates.
  const actions = useRef(p);
  useEffect(() => {
    actions.current = p;
  });
  const phase = p.done
    ? 'result'
    : p.stage === 'now'
      ? 'intro'
      : p.stage === 'forecast'
        ? p.playingForecast
          ? 'storm'
          : 'storm-end'
        : p.running
          ? 'analysis'
          : 'site-intro';
  const countdown = useRef({ phase: '', remaining: 0 });
  useEffect(() => {
    const delays: Record<string, number> = {
      intro: 6500,
      'storm-end': 2500,
      'site-intro': 3500,
      result: 10000,
    };
    if (countdown.current.phase !== phase) {
      countdown.current = { phase, remaining: delays[phase] ?? 0 };
    }
    if (paused || !p.ready || !(phase in delays)) return;
    const started = performance.now();
    const timer = setTimeout(() => {
      if (phase === 'result') actions.current.onReset();
      else if (phase === 'site-intro') actions.current.onStart();
      else actions.current.onNext();
    }, countdown.current.remaining);
    return () => {
      clearTimeout(timer);
      countdown.current.remaining = Math.max(
        0,
        countdown.current.remaining - (performance.now() - started),
      );
    };
  }, [phase, paused, p.ready]);
  const chapter = p.done
    ? 3
    : p.stage === 'site'
      ? 2
      : p.stage === 'forecast'
        ? 1
        : 0;
  const content = chapters[chapter];
  const Icon = content.icon;
  const { stage, playingForecast, hour, maxHour, onHour, onForecastEnd } = p;
  useEffect(() => {
    if (stage !== 'forecast' || !playingForecast || paused) return;
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onForecastEnd();
      return;
    }
    const id = setTimeout(() => {
      if (hour >= maxHour) onForecastEnd();
      else onHour(Math.min(maxHour, hour + 0.5));
    }, 180);
    return () => clearTimeout(id);
  }, [stage, playingForecast, hour, maxHour, onHour, onForecastEnd, paused]);
  const best = p.recommendation?.best;
  const totalHelped =
    (best?.peopleOnSignal ?? 0) + (p.recommendation?.baseline.peopleKept ?? 0);
  const maxLevel = Math.max(1, ...p.levels);
  const points = p.levels
    .map(
      (v, i) =>
        `${(i / Math.max(1, p.levels.length - 1)) * 300},${64 - (v / maxLevel) * 52}`,
    )
    .join(' ');
  function restart() {
    p.onReset();
  }

  return (
    <div className="guided-ui">
      <header className="guided-header">
        <Link href="/" className="guided-brand">
          <span>
            <RadioTower size={22} />
          </span>
          ResiliNet <b>3D</b>
        </Link>
        <span className="guided-mode">
          <i /> LOOPING DEMO
        </span>
        <button
          className="guided-pause"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? 'Resume demo' : 'Pause demo'}
          aria-pressed={paused}
          title={paused ? 'Resume demo' : 'Pause demo'}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          <span>{paused ? 'Resume' : 'Pause'}</span>
        </button>
        <Link href="/explore" className="guided-explore">
          Explore the full app <ArrowRight size={15} />
        </Link>
      </header>
      <div className="guided-location">
        <MapPin size={15} />
        <div>
          <strong>Dabong — Kuala Krai</strong>
          <span>Sungai Galas · Kelantan, Malaysia</span>
        </div>
        <span className="guided-synthetic">Demo storm</span>
      </div>
      <nav className="guided-chapters" aria-label="Demo chapters">
        {chapters.map((c, i) => (
          <button
            key={c.label}
            disabled={i > chapter || i === 3}
            aria-current={chapter === i ? 'step' : undefined}
            onClick={() =>
              p.onStage(i === 0 ? 'now' : i === 1 ? 'forecast' : 'site')
            }
            className={
              i === chapter ? 'current' : i < chapter ? 'complete' : ''
            }
          >
            <span>{i < chapter ? <Check size={13} /> : `0${i + 1}`}</span>
            <b>{c.label}</b>
          </button>
        ))}
      </nav>
      <aside className="guided-story glass-panel" aria-label="Demo guide">
        <div className="guided-story-top">
          <span>
            <Icon size={15} />{' '}
            {p.running ? 'FINDING A SAFE RESPONSE' : 'YOUR GUIDE TO THE VALLEY'}
          </span>
          <b>
            0{chapter + 1}
            <small> / 04</small>
          </b>
        </div>
        <div className="guided-copy" aria-live="polite">
          <h1>{content.title}</h1>
          <p>{content.text}</p>
        </div>
        {p.stage === 'forecast' && (
          <div className="guided-forecast">
            <div>
              <span>
                <CloudRain size={14} /> Simulated river rise
              </span>
              <strong>+{p.hour.toFixed(0)} hours</strong>
            </div>
            <svg viewBox="0 0 300 72" aria-hidden="true">
              <defs>
                <linearGradient id="guided-river" x1="0" y1="0" x2="0" y2="1">
                  <stop stopColor="#38bdf8" stopOpacity=".3" />
                  <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={`M0 72 L${points} L300 72 Z`}
                fill="url(#guided-river)"
              />
              <polyline
                points={points}
                stroke="#67d7ff"
                strokeWidth="2"
                fill="none"
              />
              <line
                x1={(p.hour / p.maxHour) * 300}
                x2={(p.hour / p.maxHour) * 300}
                y1="0"
                y2="72"
                stroke="white"
                strokeDasharray="3 4"
              />
            </svg>
            <input
              aria-label="Hours into the simulated storm"
              type="range"
              min="0"
              max={p.maxHour}
              step="0.5"
              value={p.hour}
              onChange={(e) => {
                setPaused(true);
                p.onHour(Number(e.target.value));
              }}
            />
            <div className="guided-playback">
              <span>Now</span>
              <span>
                {paused
                  ? 'Demo paused'
                  : p.playingForecast
                    ? 'Playing automatically'
                    : 'Forecast complete'}
              </span>
              <span>+{p.maxHour} h</span>
            </div>
          </div>
        )}
        {p.running && (
          <output className="guided-progress">
            <div className="guided-scan" />
            <strong>{p.reachableKm.toFixed(0)} km of reachable roads</strong>
            <span>
              {p.checked === 0
                ? 'Tracing access from the response base…'
                : `${p.checked} of ${p.total} tower locations checked`}
            </span>
            <button onClick={p.onSkip}>
              Show the result now <ArrowRight size={13} />
            </button>
          </output>
        )}
        {p.done ? (
          <div className="guided-result">
            <span>
              <Signal size={15} /> PEOPLE KEPT OR BROUGHT BACK ON SIGNAL
            </span>
            <strong>{totalHelped.toLocaleString()}</strong>
            <p>
              {best?.portable ? (
                <>
                  Portable tower near <b>{best.portable.site.candidate.name}</b>
                  .
                </>
              ) : (
                'No useful portable-tower placement was found for this scenario.'
              )}
              {best?.convoy && (
                <>
                  {' '}
                  Generator support at <b>{best.convoy.site.site.name}</b>.
                </>
              )}
            </p>
            <small>
              Model estimate, including local generator top-ups.{' '}
              {p.withoutSignal !== null &&
                `${Math.max(0, p.withoutSignal - (best?.peopleOnSignal ?? 0)).toLocaleString()} people still need support after this plan.`}
            </small>
          </div>
        ) : (
          !p.running && (
            <div className="guided-look">
              <span>
                <Compass size={14} /> WHAT TO LOOK FOR
              </span>
              <p>{content.look}</p>
            </div>
          )
        )}
        <div className="guided-actions">
          <button
            className="guided-primary"
            disabled={!p.ready || p.running}
            onClick={() => {
              if (p.done) restart();
              else if (p.stage === 'site') p.onStart();
              else p.onNext();
            }}
          >
            {!p.ready
              ? 'Preparing the valley…'
              : p.running
                ? 'Checking roads and locations…'
                : p.done
                  ? 'Replay the simulation'
                  : p.stage === 'now'
                    ? 'Watch the storm'
                    : p.stage === 'forecast'
                      ? 'Find a safe response'
                      : 'Find the best location'}
            {p.done ? <RotateCcw size={17} /> : <ArrowRight size={17} />}
          </button>
          <div className="guided-secondary">
            {chapter > 0 ? (
              <button onClick={restart}>
                <RotateCcw size={12} /> Start again
              </button>
            ) : (
              <span>
                {paused
                  ? 'Demo paused'
                  : 'Plays automatically · Loops continuously'}
              </span>
            )}
            <span>Real terrain · Simulated event</span>
          </div>
        </div>
      </aside>
      <div className="guided-map-tools">
        <span>Drag to explore · Scroll to zoom</span>
        <button onClick={p.onResetView} aria-label="Reset 3D camera">
          <Compass size={19} />
        </button>
      </div>
      <div className="guided-legend glass-panel">
        <span>
          <i className="water" /> Floodwater
        </span>
        <span>
          <i className="signal" /> Signal coverage
        </span>
        <span>
          <i className="closed" /> Flooded road
        </span>
      </div>
      <div className="guided-disclaimer">
        {paused
          ? 'Paused · Explore at your own pace'
          : 'Autoplay · Repeats after the result'}{' '}
        · Simulated event
      </div>
    </div>
  );
}
