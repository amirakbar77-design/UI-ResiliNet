'use client';

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import {
  Antenna,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  Home,
  Layers3,
  LogOut,
  MapPin,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  Route,
  Settings,
  ShieldCheck,
  Signal,
  UserRound,
  Users,
  Waves,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { RouteRun, SiteMarkerState, View } from '@/components/terrain-3d';
import {
  alignToNow,
  type FloodBand,
  type FloodCurve,
  type Forecast,
  FORECAST_MODES,
  type ForecastMode,
  floodBand,
  floodCurve,
  forecastLabel,
  loadForecast,
  MAX_LEVEL,
  MIN_LEVEL,
} from '@/lib/forecast';
import {
  assessNetwork,
  type FailureCause,
  type NetworkAssessment,
  type Overrides,
  type SiteStatus,
  siteViewsheds,
} from '@/lib/network';
import { baselineTopUps, convoyOptions, type Plan, recommendPlans, type Recommendation } from '@/lib/recommend';
import { evaluateRoutes, type RouteEvaluation } from '@/lib/routing';
import { assessSites, type SiteAssessment } from '@/lib/sites';
import { clamp, type TerrainData, terrainResource } from '@/lib/terrain-field';

type LayerKey = 'coverage' | 'towers' | 'sites' | 'flood' | 'roads' | 'population';
type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean;
}>;

const Terrain3D = lazy(() =>
  import('@/components/terrain-3d').then((module) => ({
    default: module.Terrain3D,
  })),
);

const layerOptions: Array<{
  key: LayerKey;
  label: string;
  icon: IconComponent;
}> = [
  { key: 'coverage', label: 'Network Coverage', icon: Signal },
  { key: 'sites', label: 'Existing sites', icon: RadioTower },
  { key: 'towers', label: 'Concept tower', icon: Antenna },
  { key: 'flood', label: 'Flood Hazards', icon: Waves },
  { key: 'roads', label: 'Road & Rail Status', icon: Route },
  { key: 'population', label: 'Settlements & Homes', icon: Users },
];

const utilityItems: Array<{ label: string; icon: IconComponent }> = [
  { label: 'Overview', icon: Home },
  { label: 'Map layers', icon: Layers3 },
  { label: 'Operator profile', icon: UserRound },
  { label: 'Method library', icon: BookOpen },
  { label: 'Settings', icon: Settings },
];

type Stage = 'now' | 'forecast' | 'site';

// Kuala Krai gauge (Sungai Kelantan), metres above gauge datum. Danger level
// and the 2014 record are the published JPS figures; the slider range brackets
// them.
const GAUGE_MIN = 20;
const GAUGE_MAX = 34;
const GAUGE_STEP = 0.1;
const GAUGE_DANGER = 25;
const GAUGE_RECORD_2014 = 34.2;
const GAUGE_DEFAULT = 27;

/**
 * Wall-clock "now", at minute resolution so re-renders only happen when the
 * displayed time actually changes. null during prerender, before the browser
 * clock is available. In Live mode forecast hour 0 is the current hour and
 * hour h reads as now + h hours; a replay pins "now" to the event's issue time.
 */
function useClock() {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 15_000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );
}

const clockFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dayClockFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "Thu 08:00" for multi-day horizons. */
function dayClockLabel(now: number | null, hoursAhead = 0) {
  if (now === null) return '--:--';
  return dayClockFormat.format(new Date(now + hoursAhead * 3_600_000)).replace(',', '');
}

/** "21:37" for now + hoursAhead, or a placeholder before the clock is known. */
function clockLabel(now: number | null, hoursAhead = 0) {
  if (now === null) return '--:--';
  return clockFormat.format(new Date(now + hoursAhead * 3_600_000));
}

/**
 * Illustrative mapping from the gauge reading to the scene's HAND threshold:
 * every metre above danger level is taken as a metre of water above the
 * drainage datum across the valley. A real deployment would replace this
 * with a rating curve per reach.
 */
const gaugeToHandLevel = (gauge: number) => clamp(gauge - GAUGE_DANGER, 0.5, 14);

const stages: Array<{
  key: Stage;
  label: string;
  heading: string;
  helper: string;
}> = [
  {
    key: 'now',
    label: 'Now',
    heading: 'Flooding now',
    helper: 'Enter the observed river level to see the flood as it is right now.',
  },
  {
    key: 'forecast',
    label: 'Forecast',
    heading: 'Rain forecast',
    helper:
      'Rain is still falling. Review the hourly forecast and choose the hour to plan for.',
  },
  {
    key: 'site',
    label: 'Site',
    heading: 'Tower site',
    helper: 'Press Start to evaluate routes and sites.',
  },
];

function StageIndicator({
  stage,
  setStage,
}: {
  stage: Stage;
  setStage: (stage: Stage) => void;
}) {
  const current = stages.findIndex((entry) => entry.key === stage);
  return (
    <>
      {/* Phones get one pill with a back button instead of three chips. */}
      <div className="flex items-center gap-1 rounded-full border border-slate-600/50 bg-slate-900/70 p-1 md:hidden">
        {current > 0 && (
          <button
            type="button"
            onClick={() => setStage(stages[current - 1]!.key)}
            aria-label={`Back to ${stages[current - 1]!.label}`}
            className="grid size-8 place-items-center rounded-full text-sky-200 hover:bg-slate-700/60"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        )}
        <span
          aria-current="step"
          className="flex min-h-8 items-center gap-1.5 rounded-full bg-sky-400 px-3 text-xs font-semibold tracking-[0.04em] text-slate-950"
        >
          {current + 1}/{stages.length} · {stages[current]!.label}
        </span>
      </div>
    <ol
      aria-label="Workflow steps"
      className="hidden items-center gap-1 rounded-full border border-slate-600/50 bg-slate-900/70 p-1 md:flex"
    >
      {stages.map((entry, index) => {
        const state =
          index === current ? 'current' : index < current ? 'done' : 'todo';
        return (
          <li key={entry.key}>
            <button
              type="button"
              disabled={state === 'todo'}
              onClick={() => setStage(entry.key)}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold tracking-[0.04em] transition-colors ${
                state === 'current'
                  ? 'bg-sky-400 text-slate-950'
                  : state === 'done'
                    ? 'text-sky-200 hover:bg-slate-700/60 hover:text-white'
                    : 'text-slate-500'
              }`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[11px] ${
                  state === 'current'
                    ? 'bg-slate-950/20'
                    : state === 'done'
                      ? 'bg-sky-400/20'
                      : 'bg-slate-700/60'
                }`}
              >
                {state === 'done' ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  index + 1
                )}
              </span>
              <span>{entry.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
    </>
  );
}

function TopBar({
  stage,
  setStage,
}: {
  stage: Stage;
  setStage: (stage: Stage) => void;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center border-b border-slate-600/45 bg-[#07111b]/92 px-3 backdrop-blur-xl sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-sky-400/25 bg-sky-400/10 text-sky-300">
          <Antenna className="size-[18px]" aria-hidden />
        </div>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate text-[18px] font-semibold tracking-[-0.03em] text-sky-300 sm:text-xl">
            resiliNet 3D
          </span>
          <span className="hidden rounded-full border border-slate-600/70 bg-slate-800/75 px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] text-slate-300 uppercase sm:inline-flex">
            ASEAN GeoAI Fusion 2026
          </span>
        </div>
      </div>

      {/* Centred on wide screens; tucked to the right on phones so it clears the wordmark. */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 md:left-1/2 md:right-auto md:-translate-x-1/2">
        <StageIndicator stage={stage} setStage={setStage} />
      </div>

    </header>
  );
}

function UtilityRail() {
  return (
    <nav
      aria-label="Dashboard tools"
      className="fixed bottom-0 left-0 top-14 z-40 hidden w-14 flex-col items-center border-r border-slate-600/40 bg-[#07111b]/94 py-3 backdrop-blur-xl md:flex"
    >
      <div className="flex w-full flex-1 flex-col items-center gap-2">
        {utilityItems.map(({ label, icon: Icon }, index) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-current={index === 1 ? 'page' : undefined}
            className={`grid size-10 place-items-center rounded-lg border transition-colors ${
              index === 1
                ? 'border-sky-400/20 bg-sky-400/12 text-sky-300'
                : 'border-transparent text-slate-400 hover:bg-slate-800/80 hover:text-white'
            }`}
          >
            <Icon className="size-[18px]" aria-hidden />
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Sign out"
        className="grid size-10 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-red-400/10 hover:text-red-300"
      >
        <LogOut className="size-[18px]" aria-hidden />
      </button>
    </nav>
  );
}

function MobileDock({ onOpenAnalysis }: { onOpenAnalysis: () => void }) {
  return (
    <nav
      aria-label="Dashboard tools"
      className="fixed inset-x-2 bottom-2 z-50 flex h-14 items-center justify-around rounded-2xl border border-slate-600/45 bg-[#07111b]/94 px-2 shadow-2xl backdrop-blur-xl md:hidden"
    >
      {utilityItems.slice(0, 4).map(({ label, icon: Icon }, index) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          aria-current={index === 1 ? 'page' : undefined}
          className={`grid size-11 place-items-center rounded-xl ${
            index === 1 ? 'bg-sky-400/12 text-sky-300' : 'text-slate-400'
          }`}
        >
          <Icon className="size-5" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        aria-label="Open intervention analysis"
        onClick={onOpenAnalysis}
        className="grid size-11 place-items-center rounded-xl bg-emerald-400 text-slate-950"
      >
        <ShieldCheck className="size-5" aria-hidden />
      </button>
    </nav>
  );
}

function TerrainFallback() {
  return (
    <div
      className="terrain-fallback absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <svg
        className="absolute inset-0 size-full opacity-65"
        viewBox="0 0 1400 900"
        preserveAspectRatio="none"
      >
        <defs>
          <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="0"
              dy="16"
              stdDeviation="18"
              floodColor="#102a24"
              floodOpacity=".35"
            />
          </filter>
        </defs>
        <path
          d="M550 20 C760 70 1000 80 1230 250 C1320 320 1375 450 1400 560 L1400 0 Z"
          fill="#b5cb70"
          opacity=".2"
        />
        <path
          d="M670 0 C820 90 990 140 1110 290 C1210 414 1250 565 1400 650"
          fill="none"
          stroke="#e5f3bd"
          strokeWidth="2"
          opacity=".27"
        />
        <path
          d="M600 0 C750 130 906 190 1020 330 C1120 454 1175 640 1400 735"
          fill="none"
          stroke="#e5f3bd"
          strokeWidth="2"
          opacity=".22"
        />
        <path
          d="M80 740 C250 610 360 650 500 550 C650 445 720 300 930 240"
          fill="none"
          stroke="#173f33"
          strokeWidth="80"
          opacity=".08"
          filter="url(#soft-shadow)"
        />
      </svg>
      <div className="absolute bottom-24 left-[18%] rounded-md border border-white/10 bg-slate-950/25 px-2 py-1 text-[11px] font-medium tracking-[0.08em] text-white/55 uppercase backdrop-blur-sm">
        Offline terrain preview
      </div>
    </div>
  );
}

function TerrainStage({
  layers,
  level,
  view,
  forecast,
  forecastHour,
  routeRun,
  onRouteProgress,
  onRouteDone,
  spawnedIds,
  onSiteSpawn,
  onSitesDone,
  winnerId,
  previewId,
  onPreview,
  siteStates,
  onSiteTap,
  convoyId,
  topUpIds,
  resetSignal,
}: {
  layers: Record<LayerKey, boolean>;
  level: number;
  view: View;
  forecast: Forecast | null;
  forecastHour: number;
  routeRun: RouteRun | null;
  onRouteProgress: (state: { reachableKm: number; cuts: number }) => void;
  onRouteDone: () => void;
  spawnedIds: string[];
  onSiteSpawn: (id: string) => void;
  onSitesDone: () => void;
  winnerId: string | null;
  previewId: string | null;
  onPreview: (id: string) => void;
  siteStates: Record<string, SiteMarkerState>;
  onSiteTap: (id: string) => void;
  convoyId: string | null;
  topUpIds: string[];
  resetSignal: number;
}) {
  return (
    <section
      aria-label="Interactive 3D terrain model of the Sungai Galas valley, Dabong to Kuala Krai"
      className="absolute inset-0 overflow-hidden bg-[#173b31]"
    >
      <Suspense fallback={<TerrainFallback />}>
        <Terrain3D
          layers={layers}
          level={level}
          view={view}
          forecast={forecast}
          forecastHour={forecastHour}
          routeRun={routeRun}
          onRouteProgress={onRouteProgress}
          onRouteDone={onRouteDone}
          spawnedIds={spawnedIds}
          onSiteSpawn={onSiteSpawn}
          onSitesDone={onSitesDone}
          winnerId={winnerId}
          previewId={previewId}
          onPreview={onPreview}
          siteStates={siteStates}
          onSiteTap={onSiteTap}
          convoyId={convoyId}
          topUpIds={topUpIds}
          resetSignal={resetSignal}
        />
      </Suspense>
      <div className="map-vignette pointer-events-none absolute inset-0" />
      <p className="pointer-events-none absolute bottom-1 right-3 z-20 hidden text-[10px] leading-4 text-white/45 lg:block">
        Elevation NASA SRTM · Imagery Sentinel-2 cloudless by EOX (CC BY 4.0,
        ESA Copernicus) · Roads, rail & settlements © OpenStreetMap contributors (ODbL)
      </p>
    </section>
  );
}

function LayerPanel({
  layers,
  onLayerChange,
}: {
  layers: Record<LayerKey, boolean>;
  onLayerChange: (key: LayerKey, value: boolean) => void;
}) {
  return (
    <aside className="absolute left-16 top-20 z-30 hidden w-72 md:block">
      <div className="glass-panel flex items-start gap-3 rounded-xl px-3.5 py-3 text-sm font-medium text-slate-100">
        <MapPin className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden />
        <span className="leading-5">
          Dabong – Kuala Krai, Sungai Galas valley, Kelantan, Malaysia
        </span>
      </div>
      <div className="glass-panel mt-2 overflow-hidden rounded-xl p-2">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <span className="text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">
            Map layers
          </span>
          <span className="text-[11px] text-sky-300">
            {Object.values(layers).filter(Boolean).length} active
          </span>
        </div>
        <div className="space-y-0.5">
          {layerOptions.map(({ key, label, icon: Icon }) => (
            <label
              key={key}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-sm text-slate-200 transition-colors hover:bg-slate-700/45"
            >
              <Icon className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className="flex-1">{label}</span>
              <Switch
                size="sm"
                checked={layers[key]}
                onCheckedChange={(checked) => onLayerChange(key, checked)}
                aria-label={`Toggle ${label}`}
                className="data-checked:bg-sky-400 data-unchecked:bg-slate-700"
              />
            </label>
          ))}
        </div>
      </div>
    </aside>
  );
}

function GaugeControl({
  gauge,
  setGauge,
  now,
  network,
  mode,
  forecast,
  onCycleMode,
  onNext,
}: {
  gauge: number;
  setGauge: (value: number) => void;
  now: number | null;
  network: NetworkAssessment | null;
  mode: ForecastMode;
  forecast: Forecast | null;
  onCycleMode: () => void;
  onNext: () => void;
}) {
  const aboveDanger = gauge - GAUGE_DANGER;
  const commit = (raw: string) => {
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value)) {
      setGauge(clamp(Math.round(value * 10) / 10, GAUGE_MIN, GAUGE_MAX));
    }
  };

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-[0.12em] text-slate-300 uppercase">
          Observed level
        </h3>
        <span className="flex items-center gap-1.5 rounded-md border border-red-300/20 bg-red-400/10 px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-red-200 uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
          Now · {clockLabel(now)}
        </span>
      </div>
      {/* The forecast source: the one control Part 2 adds. Tap to cycle. */}
      <button
        type="button"
        onClick={onCycleMode}
        title={forecast?.source ?? 'Forecast source'}
        aria-label={`Forecast source: ${forecastLabel(forecast, mode)}. Tap to change`}
        className={`mt-2 min-h-7 rounded-md border px-2 py-1 text-left text-[10px] font-semibold leading-4 tracking-[0.06em] uppercase tabular-nums ${
          mode === 'live'
            ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
            : 'border-sky-300/25 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20'
        }`}
      >
        {forecastLabel(forecast, mode)}
      </button>

      <div className="mt-3 rounded-xl border border-slate-600/30 bg-slate-900/35 p-3.5">
        <label
          htmlFor="gauge-reading"
          className="text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase"
        >
          Kuala Krai gauge
        </label>
        <div className="mt-1.5 flex items-baseline gap-2">
          {/* Uncontrolled and re-keyed on the committed value, so typing is
              not interrupted and the slider still refreshes the field. */}
          <input
            id="gauge-reading"
            key={gauge}
            type="number"
            inputMode="decimal"
            min={GAUGE_MIN}
            max={GAUGE_MAX}
            step={GAUGE_STEP}
            defaultValue={gauge.toFixed(1)}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit(event.currentTarget.value);
            }}
            className="w-28 rounded-lg border border-slate-600/40 bg-slate-950/60 px-3 py-2 text-[28px] font-semibold leading-none tracking-[-0.03em] text-white tabular-nums outline-none focus:border-sky-300/60 focus:ring-2 focus:ring-sky-300/25"
          />
          <span className="text-sm text-slate-400">m</span>
        </div>
        <Slider
          value={[gauge]}
          min={GAUGE_MIN}
          max={GAUGE_MAX}
          step={GAUGE_STEP}
          onValueChange={(value) =>
            setGauge(typeof value === 'number' ? value : (value[0] ?? gauge))
          }
          aria-label="Kuala Krai gauge reading in metres"
          className="mt-4 [&_[data-slot=slider-range]]:bg-sky-400 [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-sky-400 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-slate-600"
        />
        <div className="mt-2 flex justify-between text-[11px] text-slate-500 tabular-nums">
          <span>Danger level {GAUGE_DANGER.toFixed(1)} m</span>
          <span>Record 2014: {GAUGE_RECORD_2014.toFixed(1)} m</span>
        </div>
        <p
          className={`mt-3 rounded-lg border px-2.5 py-2 text-xs font-medium tabular-nums ${
            aboveDanger >= 0
              ? 'border-red-300/20 bg-red-400/10 text-red-100'
              : 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
          }`}
          aria-live="polite"
        >
          {aboveDanger >= 0
            ? `${aboveDanger.toFixed(1)} m above danger level`
            : `${(-aboveDanger).toFixed(1)} m below danger level`}
        </p>
        {network && (
          <p
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 tabular-nums"
            aria-live="polite"
          >
            <span>{network.summary.total} sites</span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-400" />
              {network.summary.battery} on battery
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-500" />
              {network.summary.down} down
            </span>
          </p>
        )}
      </div>

      <Button
        type="button"
        onClick={onNext}
        className="mt-4 min-h-11 w-full rounded-lg bg-sky-400 text-sm font-semibold text-slate-950 hover:bg-sky-300"
      >
        Forecast →
      </Button>
    </section>
  );
}

// Chart geometry in viewBox units; the SVG scales with its container.
const CHART_W = 640;
const CHART_H = 150;
const CHART_ML = 34;
const CHART_MR = 14;
const CHART_MT = 26;
const CHART_MB = 18;
const HOUR_STEP = 0.25;
const PLAY_HOURS_PER_SECOND = 2;

/**
 * The forecast control: the predicted river curve drawn over the catchment
 * rain, with the peak pinned. The chart itself is the slider that picks the
 * planning hour.
 */
function ForecastTimeline({
  forecast,
  curve,
  band,
  sourceLabel,
  hour,
  setHour,
  now,
  floor,
  network,
  onNext,
}: {
  forecast: Forecast;
  /** The curve the plan uses: p50 where the source has a spread, else the mean. */
  curve: FloodCurve;
  /** p10–p90 curves when the source has an ensemble spread. */
  band: FloodBand | null;
  sourceLabel: string;
  hour: number;
  setHour: (hour: number) => void;
  now: number | null;
  /** Level the river is at right now, from the gauge. */
  floor: number;
  network: NetworkAssessment | null;
  onNext: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const maxHour = forecast.hours - 1;
  const plotW = CHART_W - CHART_ML - CHART_MR;
  const plotH = CHART_H - CHART_MT - CHART_MB;
  const baseline = CHART_MT + plotH;
  const x = (h: number) => CHART_ML + (h / maxHour) * plotW;
  const y = (level: number) =>
    CHART_MT + (1 - (level - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)) * plotH;
  const rainMax = Math.max(1, ...forecast.catchmentMeanMmPerHour) * 1.15;
  const rainY = (mm: number) => baseline - (mm / rainMax) * plotH * 0.55;
  const barWidth = (plotW / maxHour) * 0.6;

  const linePath = curve.levels
    .map((level, h) => `${h === 0 ? 'M' : 'L'}${x(h).toFixed(1)},${y(level).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${x(maxHour).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;
  // The spread: p90 forward, p10 back.
  const bandPath = band
    ? band.p90.levels
        .map((level, h) => `${h === 0 ? 'M' : 'L'}${x(h).toFixed(1)},${y(level).toFixed(1)}`)
        .join(' ') +
      band.p10.levels
        .map((level, h) => ` L${x(maxHour - h).toFixed(1)},${y(band.p10.levels[maxHour - h]!).toFixed(1)}`)
        .join('') +
      ' Z'
    : null;

  const peakHour = curve.peakHour();
  const peakLevel = curve.peakLevel();
  const atPeak = Math.abs(hour - peakHour) < HOUR_STEP / 2;
  const outageHour = network?.outageHour ?? null;
  const atOutage = outageHour !== null && Math.abs(hour - outageHour) < HOUR_STEP / 2;
  const level = curve.levelAt(hour);
  const h0 = Math.floor(hour);
  const h1 = Math.min(h0 + 1, maxHour);
  const rain =
    (forecast.catchmentMeanMmPerHour[h0] ?? 0) * (1 - (hour - h0)) +
    (forecast.catchmentMeanMmPerHour[h1] ?? 0) * (hour - h0);
  const isPlaying = playing && hour < maxHour;

  // Playback advances a quarter hour at a time and simply stops at the end.
  useEffect(() => {
    if (!playing || hour >= maxHour) return;
    const id = setTimeout(
      () => setHour(Math.min(maxHour, hour + HOUR_STEP)),
      1000 / (PLAY_HOURS_PER_SECOND / HOUR_STEP),
    );
    return () => clearTimeout(id);
  }, [playing, hour, maxHour, setHour]);

  const pick = (next: number) => {
    setPlaying(false);
    setHour(next);
  };

  // Every 3 h on a day, every 6 h on two, every 12 h beyond; longer runs get the weekday.
  const labelStep = maxHour <= 30 ? 3 : maxHour <= 54 ? 6 : 12;
  const timeLabel = maxHour > 30 ? dayClockLabel : clockLabel;
  const timeLabels: number[] = [];
  for (let h = 0; h <= maxHour; h += labelStep) timeLabels.push(h);
  // Site failures as ticks on the baseline, fanned out when several share an hour.
  const tickColor: Record<FailureCause, string> = {
    inundation: 'rgb(248 113 113)',
    power: 'rgb(251 191 36)',
    backhaul: 'rgb(148 163 184)',
    manual: 'rgb(56 189 248)',
  };
  const failureTicks: { x: number; color: string; title: string }[] = [];
  if (network) {
    const byHour = new Map<number, typeof network.sites>();
    for (const s of network.sites) {
      if (s.failureHour === null || s.failureHour > maxHour) continue;
      const list = byHour.get(s.failureHour) ?? [];
      list.push(s);
      byHour.set(s.failureHour, list);
    }
    for (const [h, list] of byHour) {
      list.forEach((s, i) => {
        failureTicks.push({
          x: x(h) + (i - (list.length - 1) / 2) * 2.5,
          color: tickColor[s.failureCause ?? 'manual'],
          title: `${s.site.name}: ${s.failureCause} at ${clockLabel(now, h)}`,
        });
      });
    }
  }
  const darkNow = network ? network.darkAt(hour) : 0;
  const peakRange = band ? `${band.p10.peakLevel().toFixed(1)}–${band.p90.peakLevel().toFixed(1)}` : null;
  const peakTagWidth = peakRange ? 118 : 74;
  const peakTagX = clamp(x(peakHour) - peakTagWidth / 2, CHART_ML, CHART_W - CHART_MR - peakTagWidth);
  const peakTagY = Math.max(2, y(peakLevel) - 22);

  return (
    <aside
      aria-label="River forecast"
      className="glass-panel absolute inset-x-3 bottom-[76px] z-30 rounded-xl p-3 md:bottom-6 md:left-16 md:right-auto md:w-[min(760px,calc(100vw-470px))] md:min-w-[360px] md:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
            River forecast · {sourceLabel}
          </p>
          <p
            className="mt-0.5 text-sm font-semibold text-white tabular-nums"
            aria-live="polite"
          >
            {clockLabel(now, hour)}{' '}
            <span className="font-normal text-slate-400">
              (+{hour.toFixed(hour % 1 === 0 ? 0 : 2)} h)
            </span>
            <span className="mx-1.5 text-slate-600">·</span>
            {level.toFixed(1)} m
            <span className="mx-1.5 text-slate-600">·</span>
            <span className="font-normal text-slate-300">{rain.toFixed(1)} mm/h</span>
            {atPeak && (
              <span className="ml-2 rounded border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-amber-200 uppercase">
                Peak
              </span>
            )}
            {atOutage && (
              <span className="ml-2 rounded border border-red-300/25 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-red-200 uppercase">
                Outage
              </span>
            )}
          </p>
          {network && (
            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              by {clockLabel(now, hour)} ·{' '}
              <span className={darkNow > 0 ? 'font-semibold text-red-300' : 'text-slate-300'}>
                {darkNow} of {network.summary.total} sites dark
              </span>
            </p>
          )}
        </div>
        <Button
          type="button"
          size="icon-lg"
          onClick={() => {
            if (isPlaying) {
              setPlaying(false);
              return;
            }
            if (hour >= maxHour) setHour(0);
            setPlaying(true);
          }}
          className="size-11 rounded-lg bg-slate-800/80 text-slate-100 hover:bg-slate-700"
          aria-label={isPlaying ? 'Pause forecast playback' : 'Play forecast'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </Button>
        <Button
          type="button"
          onClick={onNext}
          className="min-h-11 rounded-lg bg-sky-400 px-4 text-sm font-semibold text-slate-950 hover:bg-sky-300"
        >
          {atOutage ? 'Plan for the outage' : atPeak ? 'Plan for the peak' : 'Plan for this hour'}
        </Button>
      </div>

      {/* The chart is the slider: an invisible native range input covers the
          plot area, so drag, click, arrow keys, Home/End and screen readers
          all work without custom handling. */}
      <div className="relative mt-2 rounded-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-300/60">
        <input
          type="range"
          min={0}
          max={maxHour}
          step={HOUR_STEP}
          value={hour}
          onChange={(event) => pick(Number(event.target.value))}
          onKeyDown={(event) => {
            // Shift + arrow steps a whole hour.
            if (!event.shiftKey) return;
            const delta =
              event.key === 'ArrowRight' || event.key === 'ArrowUp'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                  ? -1
                  : 0;
            if (delta === 0) return;
            event.preventDefault();
            pick(clamp(hour + delta, 0, maxHour));
          }}
          aria-label="Forecast hour"
          aria-valuetext={`${clockLabel(now, hour)}, river level ${level.toFixed(1)} metres`}
          className="absolute inset-y-0 z-10 m-0 cursor-ew-resize appearance-none bg-transparent opacity-0"
          style={{
            left: `${(CHART_ML / CHART_W) * 100}%`,
            width: `${(plotW / CHART_W) * 100}%`,
          }}
        />
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="block w-full select-none"
          aria-hidden
        >
          {/* level gridlines and ticks */}
          {[MIN_LEVEL, 7, MAX_LEVEL].map((tick) => (
            <g key={tick}>
              <line
                x1={CHART_ML}
                x2={CHART_W - CHART_MR}
                y1={y(tick)}
                y2={y(tick)}
                stroke="rgb(148 163 184 / 0.18)"
                strokeWidth={1}
              />
              <text
                x={CHART_ML - 6}
                y={y(tick) + 3}
                textAnchor="end"
                fontSize={9}
                fill="rgb(148 163 184)"
              >
                {tick === MAX_LEVEL ? `${tick} m` : tick}
              </text>
            </g>
          ))}
          {/* catchment rain */}
          <text
            x={CHART_W - CHART_MR}
            y={CHART_MT - 9}
            textAnchor="end"
            fontSize={8}
            fill="rgb(148 163 184 / 0.8)"
          >
            catchment rain, mm/h
          </text>
          {forecast.catchmentMeanMmPerHour.map((mm, h) => (
            <rect
              key={h}
              x={x(h) - barWidth / 2}
              y={rainY(mm)}
              width={barWidth}
              height={Math.max(0, baseline - rainY(mm))}
              fill="rgb(148 163 184 / 0.28)"
            />
          ))}
          {/* ensemble spread, p10–p90 */}
          {bandPath && <path d={bandPath} fill="rgb(56 189 248 / 0.16)" />}
          {/* river level */}
          <path d={areaPath} fill="rgb(56 189 248 / 0.22)" />
          <path
            d={linePath}
            fill="none"
            stroke="rgb(56 189 248)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {/* level right now */}
          <line
            x1={CHART_ML}
            x2={CHART_W - CHART_MR}
            y1={y(floor)}
            y2={y(floor)}
            stroke="rgb(226 232 240 / 0.55)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={CHART_ML + 4}
            y={y(floor) - 3}
            fontSize={8}
            fill="rgb(226 232 240 / 0.7)"
          >
            now
          </text>
          {/* peak pin */}
          <line
            x1={x(peakHour)}
            x2={x(peakHour)}
            y1={y(peakLevel)}
            y2={baseline}
            stroke="rgb(252 211 77 / 0.7)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <rect
            x={peakTagX}
            y={peakTagY}
            width={peakTagWidth}
            height={14}
            rx={3}
            fill="rgb(120 53 15 / 0.85)"
            stroke="rgb(252 211 77 / 0.5)"
          />
          <text
            x={peakTagX + peakTagWidth / 2}
            y={peakTagY + 10}
            textAnchor="middle"
            fontSize={9}
            fontWeight={600}
            fill="rgb(253 230 138)"
          >
            Peak · {peakLevel.toFixed(1)} m{peakRange ? ` (${peakRange})` : ''}
          </text>
          {/* outage pin: the hour the network is at its worst */}
          {outageHour !== null && network && (
            <g>
              <line
                x1={x(outageHour)}
                x2={x(outageHour)}
                y1={CHART_MT + 2}
                y2={baseline}
                stroke="rgb(248 113 113 / 0.7)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <rect
                x={clamp(x(outageHour) - 46, CHART_ML, CHART_W - CHART_MR - 92)}
                y={CHART_MT + 2}
                width={92}
                height={14}
                rx={3}
                fill="rgb(69 10 10 / 0.85)"
                stroke="rgb(248 113 113 / 0.5)"
              />
              <text
                x={clamp(x(outageHour) - 46, CHART_ML, CHART_W - CHART_MR - 92) + 46}
                y={CHART_MT + 12}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill="rgb(254 202 202)"
              >
                Outage · {network.darkAt(outageHour)} of {network.summary.total} dark
              </text>
            </g>
          )}
          {/* site failures: a tick per site at the hour it goes dark */}
          {failureTicks.map((tick, i) => (
            <line
              key={i}
              x1={tick.x}
              x2={tick.x}
              y1={baseline - 9}
              y2={baseline - 1}
              stroke={tick.color}
              strokeWidth={2}
              strokeLinecap="round"
            >
              <title>{tick.title}</title>
            </line>
          ))}
          {/* selected hour */}
          <line
            x1={x(hour)}
            x2={x(hour)}
            y1={CHART_MT}
            y2={baseline}
            stroke="rgb(56 189 248)"
            strokeWidth={1.5}
          />
          <circle
            cx={x(hour)}
            cy={y(level)}
            r={4.5}
            fill="rgb(56 189 248)"
            stroke="white"
            strokeWidth={1.5}
          />
          {/* clock times */}
          {timeLabels.map((h) => (
            <text
              key={h}
              x={x(h)}
              y={CHART_H - 5}
              textAnchor={h === 0 ? 'start' : 'middle'}
              fontSize={9}
              fill="rgb(148 163 184)"
            >
              {h === 0 ? 'Now' : timeLabel(now, h)}
            </text>
          ))}
        </svg>
      </div>
    </aside>
  );
}

const waveLegend = [
  ['bg-emerald-400', 'Open through the peak'],
  ['bg-amber-400', 'Closes before the peak'],
  ['bg-rose-400', 'Closes within 2 h'],
  ['bg-slate-500', 'Unreachable now'],
] as const;

/** "Generator run to X + portable tower at Y"; single-move alternatives get "only". */
function planTitle(plan: Plan, alternative = false) {
  const convoy = plan.convoy ? `Generator run to ${plan.convoy.site.site.name}` : null;
  const tower = plan.portable ? `portable tower at ${plan.portable.site.candidate.name}` : null;
  if (convoy && tower) return `${convoy} + ${tower}`;
  const single = convoy ?? `Portable tower at ${plan.portable?.site.candidate.name ?? ''}`;
  return alternative ? `${single} only` : single;
}

function RecommendationCard({
  route,
  plannedClock,
  now,
  siteNames,
}: {
  route: RouteState;
  plannedClock: string;
  now: number | null;
  siteNames: Record<string, string>;
}) {
  const { best, alternatives, baseline } = route.recommendation;
  const convoy = best?.convoy ?? null;
  const tower = best?.portable ?? null;
  const tone = !best ? 'slate' : tower ? 'emerald' : 'amber';
  const box =
    tone === 'emerald'
      ? 'border-emerald-300/30 bg-emerald-300/10'
      : tone === 'amber'
        ? 'border-amber-300/30 bg-amber-300/10'
        : 'border-slate-600/30 bg-slate-900/35';
  const accent = tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : 'text-slate-400';
  const accentSoft = tone === 'emerald' ? 'text-emerald-100/80' : 'text-amber-100/80';
  const topUps = baseline.sites.length;
  return (
    <div className={`mt-3 rounded-xl border p-3.5 ${box}`}>
      <p className={`text-[11px] font-semibold tracking-[0.12em] uppercase ${accent}`}>Recommendation</p>
      {best ? (
        <>
          <h3 className="mt-0.5 text-base font-semibold leading-snug text-white">{planTitle(best)}</h3>
          <p
            className={`mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${accent}`}
          >
            {best.peopleOnSignal.toLocaleString()}
            <span className={`ml-1.5 text-sm font-medium ${accentSoft}`}>people kept on signal</span>
          </p>
          <p className="mt-1 text-xs text-slate-300 tabular-nums">
            of {route.withoutSignal.toLocaleString()} without signal at {plannedClock}
          </p>
          <ol className="mt-3 space-y-2 text-xs text-slate-200 tabular-nums">
            {convoy && (
              <li className="flex gap-2">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-amber-400/20 text-[10px] font-bold text-amber-200">
                  1
                </span>
                <span>
                  <span className="font-semibold text-white">Convoy to {convoy.site.site.name}</span> by{' '}
                  {clockLabel(now, convoy.by)} · {convoy.routeKm.toFixed(0)} km
                </span>
              </li>
            )}
            {tower && (
              <li className="flex gap-2">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-[10px] font-bold text-emerald-200">
                  {convoy ? 2 : 1}
                </span>
                <span>
                  <span className="font-semibold text-white">Portable tower at {tower.site.candidate.name}</span>,
                  microwave to {siteNames[tower.backhaulTo] ?? tower.backhaulTo}, {tower.backhaulKm} km
                </span>
              </li>
            )}
          </ol>
        </>
      ) : (
        <h3 className="mt-0.5 text-base font-semibold leading-snug text-white">
          No convoy or portable tower can reach the valley in time.
        </h3>
      )}
      {topUps > 0 && baseline.by !== null && (
        <p className="mt-3 text-xs text-slate-300 tabular-nums">
          <span className="font-semibold text-white">
            Local crews top up {topUps} {topUps === 1 ? 'site' : 'sites'}
          </span>{' '}
          before {clockLabel(now, baseline.by)} · keeps {baseline.peopleKept.toLocaleString()}
        </p>
      )}
      {alternatives.length > 0 && (
        <div className="mt-3 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-300">Alternatives</span>
          <ul className="mt-1 space-y-1">
            {alternatives.map((plan, i) => (
              <li key={i} className="tabular-nums">
                {planTitle(plan, true)} — {plan.peopleOnSignal.toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RouteControls({
  route,
  ready,
  plannedClock,
  withoutSignal,
  now,
  siteNames,
  onStart,
  onSkip,
}: {
  route: RouteState | null;
  ready: boolean;
  plannedClock: string;
  /** People in the residual hole at the planned hour; null until known. */
  withoutSignal: number | null;
  now: number | null;
  siteNames: Record<string, string>;
  onStart: () => void;
  onSkip: () => void;
}) {
  const running = route?.status === 'running';
  const done = route?.status === 'done';
  const sitesRunning = done && !route.sitesDone;
  return (
    <section className="mt-4">
      <Button
        type="button"
        onClick={onStart}
        disabled={!ready || route !== null}
        className="min-h-11 w-full rounded-lg bg-sky-400 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:bg-slate-700 disabled:text-slate-300 disabled:opacity-100"
      >
        {route?.sitesDone
          ? 'Sites evaluated'
          : sitesRunning
            ? 'Evaluating sites…'
            : running
              ? 'Evaluating routes…'
              : 'Start evaluation'}
      </Button>
      {(running || sitesRunning) && (
        <button
          type="button"
          onClick={onSkip}
          className="mt-2 min-h-10 w-full rounded-lg text-xs font-semibold tracking-[0.06em] text-sky-200 uppercase hover:bg-slate-800 hover:text-white"
        >
          Skip animation
        </button>
      )}
      {route && (
        <div className="mt-3 rounded-xl border border-slate-600/30 bg-slate-900/35 p-3.5">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-500 uppercase">
            Reachable network
          </p>
          <p
            className="mt-1 text-lg font-semibold text-white tabular-nums"
            aria-live="polite"
          >
            {route.reachableKm.toFixed(0)} km
            <span className="mx-2 text-slate-600">·</span>
            {route.cuts} {route.cuts === 1 ? 'cut' : 'cuts'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            From the Kuala Krai depot at today&rsquo;s level; colours show when the
            forecast closes each road.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-300">
            {waveLegend.map(([swatch, label]) => (
              <li key={label} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${swatch}`} />
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {done && !route.sitesDone && (
        <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/8 p-3.5">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-emerald-200/75 uppercase">
            Reachable sites
          </p>
          <p
            className="mt-1 text-lg font-semibold text-white tabular-nums"
            aria-live="polite"
          >
            {route.spawned.length}
            <span className="text-slate-400"> / {route.sites.length}</span>
          </p>
        </div>
      )}
      {route?.sitesDone && (
        <RecommendationCard route={route} plannedClock={plannedClock} now={now} siteNames={siteNames} />
      )}
      {!ready && (
        <p className="mt-2 text-[11px] text-slate-500">Loading road network…</p>
      )}
      {withoutSignal !== null && (
        <p className="mt-3 rounded-lg border border-slate-600/30 bg-slate-900/35 px-3 py-2.5 text-xs text-slate-300 tabular-nums">
          Without signal at {plannedClock}:{' '}
          <span className={withoutSignal > 0 ? 'font-semibold text-red-200' : 'font-semibold text-emerald-200'}>
            {withoutSignal.toLocaleString()} people
          </span>
        </p>
      )}
    </section>
  );
}

function StageContent({
  stage,
  gauge,
  setGauge,
  now,
  mode,
  forecast,
  onCycleMode,
  route,
  routesReady,
  plannedClock,
  withoutSignal,
  network,
  siteNames,
  onStartRoutes,
  onSkipRoutes,
  onNext,
  onClose,
}: StageProps & { onClose?: () => void }) {
  const index = stages.findIndex((entry) => entry.key === stage);
  const entry = stages[index]!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-600/35 px-4 py-3.5">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-sky-300 uppercase">
            Step {index + 1} of {stages.length}
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-white">
            {entry.heading}
          </h2>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={onClose}
            aria-label="Close panel"
            className="text-slate-400 hover:bg-slate-700/60 hover:text-white"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <p className="text-[13px] leading-5 text-slate-400">{entry.helper}</p>
        {stage === 'now' && (
          <GaugeControl
            gauge={gauge}
            setGauge={setGauge}
            now={now}
            network={network}
            mode={mode}
            forecast={forecast}
            onCycleMode={onCycleMode}
            onNext={onNext}
          />
        )}
        {stage === 'forecast' && (
          <p className="mt-3 rounded-lg border border-slate-600/30 bg-slate-900/35 px-3 py-2.5 text-xs leading-5 text-slate-300">
            Drag along the river forecast at the bottom of the map to pick the
            hour, then press <span className="font-semibold text-white">Plan for the peak</span>.
          </p>
        )}
        {stage === 'site' && (
          <RouteControls
            route={route}
            ready={routesReady}
            plannedClock={plannedClock}
            withoutSignal={withoutSignal}
            now={now}
            siteNames={siteNames}
            onStart={onStartRoutes}
            onSkip={onSkipRoutes}
          />
        )}
      </div>
    </div>
  );
}

type RouteState = {
  id: number;
  evaluation: RouteEvaluation;
  status: 'running' | 'done';
  skip: boolean;
  /** Live figures while the wave plays. */
  reachableKm: number;
  cuts: number;
  /** Reachable candidates in spawn order. */
  sites: SiteAssessment[];
  /** Candidate ids the scene has spawned so far. */
  spawned: string[];
  sitesDone: boolean;
  /** Decided at Start; revealed once every site has spawned. */
  winnerId: string | null;
  /** Runner-up being previewed on the map. */
  previewId: string | null;
  /** People in the residual hole at the planned hour, when Start was pressed. */
  withoutSignal: number;
  /** Existing-site failure hours and the planned hour, for the scene's fans. */
  network: RouteRun['network'];
  /** Baseline top-ups, then the convoy and the portable tower; decided at Start, revealed with the winner. */
  recommendation: Recommendation;
};

type StageProps = {
  stage: Stage;
  gauge: number;
  setGauge: (value: number) => void;
  /** Minute-resolution epoch ms (Live) or the event's hour 0 (replays); null before the clock is known. */
  now: number | null;
  mode: ForecastMode;
  forecast: Forecast | null;
  onCycleMode: () => void;
  route: RouteState | null;
  routesReady: boolean;
  plannedClock: string;
  withoutSignal: number | null;
  network: NetworkAssessment | null;
  siteNames: Record<string, string>;
  onStartRoutes: () => void;
  onSkipRoutes: () => void;
  onNext: () => void;
};

function InterventionPanel({
  open,
  onClose,
  onOpen,
  ...stageProps
}: StageProps & {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="glass-panel absolute right-6 top-20 z-30 hidden min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-white hover:border-sky-300/35 md:flex"
      >
        <ShieldCheck className="size-4 text-sky-300" aria-hidden />
        Open panel
      </button>
    );
  }

  return (
    <aside className="glass-panel absolute bottom-6 right-6 top-20 z-30 hidden w-80 overflow-hidden rounded-xl md:flex">
      <StageContent {...stageProps} onClose={onClose} />
    </aside>
  );
}

function MobileControls({
  layers,
  onLayerChange,
}: {
  layers: Record<LayerKey, boolean>;
  onLayerChange: (key: LayerKey, value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className="absolute inset-x-3 top-[68px] z-30 md:hidden">
      <div className="glass-panel overflow-hidden rounded-xl">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex min-h-12 w-full items-center gap-2 px-3 text-left"
        >
          <MapPin className="size-4 shrink-0 text-sky-300" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
            Dabong – Kuala Krai, Kelantan
          </span>
          <span className="rounded border border-amber-300/20 bg-amber-300/8 px-1.5 py-1 text-[9px] font-bold tracking-[0.08em] text-amber-200 uppercase">
            Concept
          </span>
          <ChevronDown
            className={`size-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {expanded && (
          <div className="grid grid-cols-2 gap-1 border-t border-slate-600/30 p-2">
            {layerOptions.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => onLayerChange(key, !layers[key])}
                aria-pressed={layers[key]}
                className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-[11px] ${layers[key] ? 'bg-sky-400/12 text-sky-100' : 'bg-slate-900/30 text-slate-400'}`}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function MobileAnalysis({
  open,
  onClose,
  ...stageProps
}: StageProps & {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-[60] m-0 flex size-full max-h-none max-w-none items-end border-0 bg-black/40 p-0 backdrop-blur-[2px] md:hidden"
      aria-label="Stage panel"
    >
      <div className="glass-panel flex max-h-[84dvh] w-full flex-col overflow-hidden rounded-t-2xl border-x-0 border-b-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-600" />
        <StageContent
          {...stageProps}
          onNext={() => {
            stageProps.onNext();
            onClose();
          }}
          onClose={onClose}
        />
      </div>
    </dialog>
  );
}

export function ResilinetDashboard() {
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    coverage: true,
    towers: true,
    sites: true,
    flood: true,
    roads: true,
    population: true,
  });
  const [stage, setStage] = useState<Stage>('now');
  const [gauge, setGauge] = useState(GAUGE_DEFAULT);
  // Which dated forecast the demo runs on; the chip beside the clock cycles it.
  const [mode, setMode] = useState<ForecastMode>('live');
  const [rawForecast, setRawForecast] = useState<Forecast | null>(null);
  // The same baked assets the scene uses; needed here for routing and sites.
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  // Officer overrides of site status — how NOC alarms would enter later.
  const [siteOverrides, setSiteOverrides] = useState<Overrides>({});
  const [route, setRoute] = useState<RouteState | null>(null);
  // null until the officer picks an hour; the curve's peak is the default.
  const [chosenHour, setChosenHour] = useState<number | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);

  const onLayerChange = (key: LayerKey, value: boolean) => {
    setLayers((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    let cancelled = false;
    terrainResource().then(
      (data) => {
        if (!cancelled) setTerrain(data);
      },
      (error: unknown) => console.error('Failed to load terrain', error),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // A new mode is a new event: reload the file, prefill the gauge with the
  // event's recorded reading when one was found, and drop any plan in progress.
  useEffect(() => {
    let cancelled = false;
    loadForecast(mode).then(
      (data) => {
        if (cancelled) return;
        setRawForecast(data);
        setGauge(data.gauge?.reading ?? GAUGE_DEFAULT);
        setChosenHour(null);
        setRoute(null);
        setSiteOverrides({});
      },
      (error: unknown) => console.error('Failed to load forecast', error),
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
  const onCycleMode = useCallback(() => {
    setMode((current) => FORECAST_MODES[(FORECAST_MODES.indexOf(current) + 1) % FORECAST_MODES.length]!);
  }, []);

  const clock = useClock();
  // Live: "now" is the wall clock and the file is trimmed to the current hour
  // once an hour. Replays: "now" is the event's hour 0, so nothing moves.
  const alignAt = mode === 'live' && clock !== null ? Math.floor(clock / 3_600_000) * 3_600_000 : null;
  const forecast = useMemo(
    () => (rawForecast && alignAt !== null ? alignToNow(rawForecast, alignAt) : rawForecast),
    [rawForecast, alignAt],
  );
  const now = mode === 'live' ? clock : rawForecast ? Date.parse(rawForecast.issuedAt) : null;

  // The river-level curve starts from the observed gauge reading. Where the
  // source has an ensemble spread the plan runs on p50 and the timeline shows
  // p10–p90; a reanalysis has no spread and runs on its single series.
  const { curve, band } = useMemo(() => {
    if (!forecast) return { curve: null, band: null };
    const level = gaugeToHandLevel(gauge);
    const spread = floodBand(forecast, level);
    return { curve: spread?.p50 ?? floodCurve(forecast, level), band: spread };
  }, [forecast, gauge]);
  // Existing-network status and failure hours follow the gauge and the curve.
  const network = useMemo(
    () => (terrain && curve ? assessNetwork(terrain, curve, siteOverrides) : null),
    [terrain, curve, siteOverrides],
  );
  // Plan for the outage by default — the network is at its worst hours after
  // the river peak, because sites starve once the roads close — and for the
  // river peak only when nothing fails.
  const forecastHour = chosenHour ?? network?.outageHour ?? curve?.peakHour() ?? 0;
  // Existing-site viewsheds never change; the hole follows the failures.
  const siteMasks = useMemo(() => (terrain ? siteViewsheds(terrain) : null), [terrain]);
  // Tier 1 of the plan: sites a local crew can still top up are assumed kept,
  // and the hole the Site stage plans for is what is left after them.
  const planning = useMemo(
    () =>
      terrain && network && siteMasks
        ? baselineTopUps(terrain, network, siteMasks, forecastHour)
        : null,
    [terrain, network, siteMasks, forecastHour],
  );
  const hole = planning?.hole ?? null;
  const baseline = planning?.baseline ?? null;
  const siteStates = useMemo(() => {
    const states: Record<string, SiteMarkerState> = {};
    for (const s of network?.sites ?? []) {
      states[s.id] = {
        status: s.status,
        cause: s.failureCause,
        failureHour: s.failureHour,
        manual: s.manual,
      };
    }
    return states;
  }, [network]);
  const onSiteTap = useCallback((id: string) => {
    setSiteOverrides((current) => {
      const order: (SiteStatus | undefined)[] = [undefined, 'up', 'battery', 'down'];
      const next = order[(order.indexOf(current[id]) + 1) % order.length];
      const copy = { ...current };
      if (next === undefined) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }, []);

  // Now floods from the gauge; Forecast and Site from the curve at the chosen
  // hour (falling back to the gauge if the forecast file is unavailable).
  const plannedLevel = curve ? curve.levelAt(forecastHour) : gaugeToHandLevel(gauge);
  const level = stage === 'now' ? gaugeToHandLevel(gauge) : plannedLevel;
  const plannedClock = clockLabel(now, forecastHour);
  // The forecast is read from above; every other stage is on the ground.
  // Now: the home oblique. Forecast: top-down. Site: from behind the depot,
  // so the route wave starts in the foreground and runs away down the valley.
  const view: View =
    stage === 'forecast' ? 'overview' : stage === 'site' ? 'site' : 'ground';
  // Leaving the site stage discards its route evaluation.
  const changeStage = (next: Stage) => {
    if (next !== 'site') setRoute(null);
    setStage(next);
  };
  const onNext = () => changeStage(stage === 'now' ? 'forecast' : 'site');

  const siteNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const s of terrain?.meta.sites ?? []) names[s.id] = s.name;
    return names;
  }, [terrain]);
  const routesReady = terrain !== null && curve !== null && hole !== null;
  const onStartRoutes = () => {
    if (!terrain || !curve || !hole || !baseline || !network || !siteMasks) return;
    const evaluation = evaluateRoutes(
      terrain.graph,
      terrain.meta.depot.node,
      gaugeToHandLevel(gauge),
      curve.levels,
      curve.peakHour(),
    );
    const convoys = convoyOptions(terrain, network, siteMasks, hole, forecastHour, baseline, {
      level: gaugeToHandLevel(gauge),
      levels: curve.levels,
    });
    // A candidate is worth showing only if some plan could give it a link:
    // a survivor at the planned hour, a topped-up site, or the convoy's site.
    const usable = new Set([
      ...network.liveAt(forecastHour),
      ...baseline.sites.map((s) => s.id),
      ...convoys.map((o) => o.site.id),
    ]);
    const sites = assessSites(terrain, evaluation.distanceByNode, hole.mask, terrain.meta.sites).filter(
      (site) => site.backhaulOptions.some((o) => usable.has(o.siteId)),
    );
    const recommendation = recommendPlans(terrain, network, siteMasks, hole, forecastHour, sites, convoys, baseline);
    // The map's winner shows the link the best plan actually uses.
    const bestTower = recommendation.best?.portable ?? null;
    const sitesForMap = bestTower
      ? sites.map((s) =>
          s.id === bestTower.site.id
            ? { ...s, backhaulTo: bestTower.backhaulTo, backhaulKm: bestTower.backhaulKm }
            : s,
        )
      : sites;
    // For checking against the labels on the map.
    console.log(
      `without signal at +${forecastHour} h: ${baseline.holeBefore} of ${hole.coveredNow} people covered now · top-ups at ${baseline.sites.length} sites keep ${baseline.peopleKept} · residual ${hole.count}`,
    );
    console.table(
      sites.map((site) => ({
        candidate: site.candidate.name,
        'route km': Number(site.routeKm.toFixed(1)),
        'people in hole': site.peopleReconnected,
        'people covered': site.peopleCovered,
        links: site.backhaulOptions
          .filter((o) => usable.has(o.siteId))
          .slice(0, 3)
          .map((o) => `${siteNames[o.siteId]} ${o.km} km`)
          .join(' · '),
      })),
    );
    console.table(
      convoys.map((o) => ({
        convoy: o.site.site.name,
        by: `+${o.by} h`,
        route: `${o.routeKm} km`,
        'people kept': o.peopleKept,
      })),
    );
    const failures: Record<string, number | null> = {};
    for (const s of network.sites) failures[s.id] = s.failureHour;
    setRoute((current) => ({
      id: (current?.id ?? 0) + 1,
      evaluation,
      status: 'running',
      skip: false,
      reachableKm: 0,
      cuts: 0,
      sites: sitesForMap,
      spawned: [],
      sitesDone: false,
      // The map's winner is the tower in the best plan, if the plan has one.
      winnerId: recommendation.best?.portable?.site.id ?? null,
      previewId: null,
      withoutSignal: hole.count,
      network: { failures, plannedHour: forecastHour },
      recommendation,
    }));
  };
  const onSkipRoutes = () =>
    setRoute((current) => (current ? { ...current, skip: true } : current));
  const onRouteProgress = useCallback(
    (state: { reachableKm: number; cuts: number }) =>
      setRoute((current) =>
        current && (current.reachableKm !== state.reachableKm || current.cuts !== state.cuts)
          ? { ...current, ...state }
          : current,
      ),
    [],
  );
  const onRouteDone = useCallback(
    () =>
      setRoute((current) =>
        current && current.status !== 'done' ? { ...current, status: 'done' } : current,
      ),
    [],
  );
  const onSiteSpawn = useCallback(
    (id: string) =>
      setRoute((current) =>
        current && !current.spawned.includes(id)
          ? { ...current, spawned: [...current.spawned, id] }
          : current,
      ),
    [],
  );
  const onSitesDone = useCallback(
    () =>
      setRoute((current) =>
        current && !current.sitesDone ? { ...current, sitesDone: true } : current,
      ),
    [],
  );
  const onPreview = useCallback(
    (id: string) =>
      setRoute((current) =>
        current ? { ...current, previewId: current.previewId === id ? null : id } : current,
      ),
    [],
  );
  const routeRun: RouteRun | null = useMemo(
    () =>
      route
        ? {
            id: route.id,
            evaluation: route.evaluation,
            sites: route.sites,
            network: route.network,
            skip: route.skip,
          }
        : null,
    [route],
  );
  const spawnedIds = route?.spawned ?? [];
  const convoyId = useMemo(
    () => (route?.sitesDone ? (route.recommendation.best?.convoy?.site.id ?? null) : null),
    [route],
  );
  const topUpIds = useMemo(
    () => (route?.sitesDone ? route.recommendation.baseline.sites.map((s) => s.id) : []),
    [route],
  );

  const stageProps: StageProps = {
    stage,
    gauge,
    setGauge,
    now,
    mode,
    forecast,
    onCycleMode,
    route,
    routesReady,
    plannedClock,
    withoutSignal: hole?.count ?? null,
    network,
    siteNames,
    onStartRoutes,
    onSkipRoutes,
    onNext,
  };

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-slate-900 text-slate-100">
      <TerrainStage
        layers={layers}
        level={level}
        view={view}
        forecast={forecast}
        forecastHour={forecastHour}
        routeRun={routeRun}
        onRouteProgress={onRouteProgress}
        onRouteDone={onRouteDone}
        spawnedIds={spawnedIds}
        onSiteSpawn={onSiteSpawn}
        onSitesDone={onSitesDone}
        winnerId={route?.sitesDone ? route.winnerId : null}
        previewId={route?.previewId ?? null}
        onPreview={onPreview}
        siteStates={siteStates}
        onSiteTap={onSiteTap}
        convoyId={convoyId}
        topUpIds={topUpIds}
        resetSignal={resetSignal}
      />
      <TopBar stage={stage} setStage={changeStage} />
      <UtilityRail />
      <LayerPanel layers={layers} onLayerChange={onLayerChange} />
      {stage === 'forecast' && forecast && curve && (
        <ForecastTimeline
          forecast={forecast}
          curve={curve}
          band={band}
          sourceLabel={forecastLabel(forecast, mode)}
          hour={forecastHour}
          setHour={setChosenHour}
          now={now}
          floor={gaugeToHandLevel(gauge)}
          network={network}
          onNext={onNext}
        />
      )}
      {stage === 'site' && curve && (
        <div className="absolute left-1/2 top-[124px] z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-300/25 bg-slate-950/70 py-1.5 pl-3.5 pr-1.5 text-xs text-slate-100 backdrop-blur-md md:top-20">
          <span className="tabular-nums">
            Planning for{' '}
            <span className="font-semibold text-white">
              {clockLabel(now, forecastHour)}
            </span>{' '}
            <span className="text-slate-400">(+{forecastHour.toFixed(0)} h)</span>
            <span className="mx-1.5 text-slate-500">·</span>
            <span className="font-semibold text-white">
              {curve.levelAt(forecastHour).toFixed(1)} m
            </span>
          </span>
          <button
            type="button"
            onClick={() => changeStage('forecast')}
            className="min-h-8 rounded-full px-2.5 text-[11px] font-semibold tracking-[0.06em] text-sky-200 uppercase hover:bg-slate-800 hover:text-white"
          >
            Change
          </button>
        </div>
      )}
      <InterventionPanel
        {...stageProps}
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        onOpen={() => setAnalysisOpen(true)}
      />
      <MobileControls layers={layers} onLayerChange={onLayerChange} />
      <MobileDock onOpenAnalysis={() => setMobileAnalysisOpen(true)} />
      <MobileAnalysis
        {...stageProps}
        open={mobileAnalysisOpen}
        onClose={() => setMobileAnalysisOpen(false)}
      />

      <div className="absolute bottom-6 right-[362px] z-20 hidden items-center gap-2 xl:flex">
        <span className="hidden text-[10px] font-medium tracking-[0.06em] text-white/55 uppercase 2xl:block">
          Drag to pan · pinch to zoom · two fingers up/down to fly · left/right to orbit
        </span>
        <button
          type="button"
          aria-label="Reset map view"
          onClick={() => {
            // Reset returns to the ground view, so the flow returns to Now.
            changeStage('now');
            setResetSignal((value) => value + 1);
          }}
          className="grid size-10 place-items-center rounded-xl border border-white/15 bg-slate-950/65 text-slate-300 backdrop-blur-md hover:bg-slate-800 hover:text-white"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-14 z-20 h-px bg-gradient-to-r from-transparent via-sky-300/25 to-transparent" />
    </main>
  );
}
