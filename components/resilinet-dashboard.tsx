'use client';

import {
  lazy,
  Suspense,
  useState,
  type ComponentType,
  type CSSProperties,
} from 'react';
import {
  Antenna,
  BookOpen,
  Check,
  ChevronDown,
  CircleDollarSign,
  CloudRain,
  Globe2,
  Home,
  Info,
  Layers3,
  LocateFixed,
  LogOut,
  MapPin,
  Menu,
  MousePointer2,
  Pause,
  Play,
  RadioTower,
  RotateCcw,
  Route,
  Satellite,
  Settings,
  ShieldCheck,
  Signal,
  UserRound,
  Users,
  Waves,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type LayerKey = 'coverage' | 'towers' | 'flood' | 'roads' | 'population';
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
  { key: 'towers', label: 'Current Tower Status', icon: RadioTower },
  { key: 'flood', label: 'Flood Hazards', icon: Waves },
  { key: 'roads', label: 'Road Network Status', icon: Route },
  { key: 'population', label: 'Population Density', icon: Users },
];

const utilityItems: Array<{ label: string; icon: IconComponent }> = [
  { label: 'Overview', icon: Home },
  { label: 'Map layers', icon: Layers3 },
  { label: 'Operator profile', icon: UserRound },
  { label: 'Method library', icon: BookOpen },
  { label: 'Settings', icon: Settings },
];

const councilOptions = [
  ['Fixed Weighting 1', 'Balanced response'],
  ['Fixed Weighting 2', 'Population first'],
  ['Fixed Weighting 3', 'Access first'],
  ['Fixed Weighting 4', 'Cost first'],
];

function TopBar() {
  const [navOpen, setNavOpen] = useState(false);

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

      <nav
        aria-label="Primary navigation"
        className="ml-auto hidden items-center gap-7 lg:flex"
      >
        {['Global', 'Developers', 'Develops', 'About', 'Contact'].map(
          (item) => (
            <button
              key={item}
              type="button"
              className="flex min-h-11 items-center gap-1.5 text-sm text-slate-300 transition-colors hover:text-white"
            >
              {item === 'Global' && <Globe2 className="size-4" aria-hidden />}
              {item}
            </button>
          ),
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2 lg:ml-5">
        <span className="hidden items-center gap-1.5 rounded-md border border-amber-300/20 bg-amber-300/8 px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-amber-200 uppercase md:flex">
          <span className="size-1.5 rounded-full bg-amber-300" />
          Static UI concept
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((value) => !value)}
        >
          {navOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {navOpen && (
        <nav
          aria-label="Mobile navigation"
          className="glass-panel absolute right-3 top-[62px] w-52 rounded-xl p-2 lg:hidden"
        >
          {['Global', 'Developers', 'Develops', 'About', 'Contact'].map(
            (item) => (
              <button
                key={item}
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-slate-700/45"
              >
                {item === 'Global' && (
                  <Globe2 className="size-4 text-sky-300" aria-hidden />
                )}
                {item}
              </button>
            ),
          )}
        </nav>
      )}
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
  timeline,
  resetSignal,
}: {
  layers: Record<LayerKey, boolean>;
  timeline: number;
  resetSignal: number;
}) {
  return (
    <section
      aria-label="Interactive 3D terrain model of Yan and Gunung Jerai"
      className="absolute inset-0 overflow-hidden bg-[#173b31]"
    >
      <Suspense fallback={<TerrainFallback />}>
        <Terrain3D
          layers={layers}
          timeline={timeline}
          resetSignal={resetSignal}
        />
      </Suspense>
      <div className="map-vignette pointer-events-none absolute inset-0" />
      <p className="pointer-events-none absolute bottom-1 right-3 z-20 hidden text-[10px] leading-4 text-white/45 lg:block">
        Elevation NASA SRTM · Imagery Sentinel-2 cloudless by EOX (CC BY 4.0,
        ESA Copernicus) · Roads © OpenStreetMap contributors (ODbL)
      </p>
      <div className="pointer-events-none absolute bottom-5 left-20 hidden items-center gap-2 text-[11px] font-medium tracking-[0.06em] text-white/60 uppercase md:flex">
        <LocateFixed className="size-3.5" />
        5.792° N, 100.402° E
        <span className="h-3 w-px bg-white/20" />
        Drag to orbit · scroll to zoom
      </div>
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
        <span className="leading-5">Yan and Gunung Jerai, Kedah, Malaysia</span>
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
        <button
          type="button"
          className="group relative mt-1 flex min-h-11 w-full items-center gap-3 rounded-lg border border-sky-300/20 bg-slate-700/65 px-2.5 text-left text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          <span className="grid size-6 place-items-center rounded-md bg-sky-400/14 text-sky-300">
            <RadioTower className="size-4" aria-hidden />
          </span>
          <span className="flex-1">New Portable Tower</span>
          <span className="rounded-md border border-sky-300/20 bg-sky-400/10 px-1.5 py-1 text-[10px] font-bold tracking-[0.09em] text-sky-200 uppercase">
            Place
          </span>
          <MousePointer2
            className="absolute -bottom-2 -right-1 size-5 fill-slate-950 text-white drop-shadow-lg transition-transform group-hover:-translate-x-1 group-hover:-translate-y-1"
            aria-hidden
          />
        </button>
      </div>
    </aside>
  );
}

function TimelinePanel({
  timeline,
  setTimeline,
  playing,
  setPlaying,
}: {
  timeline: number;
  setTimeline: (value: number) => void;
  playing: boolean;
  setPlaying: (value: boolean) => void;
}) {
  const hour = `H${String(timeline).padStart(2, '0')}`;

  return (
    <aside className="glass-panel absolute bottom-6 left-16 z-30 hidden w-[min(520px,calc(100vw-470px))] min-w-[360px] rounded-xl p-4 md:block">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-slate-400 uppercase">
            HAND
          </p>
          <h2 className="mt-0.5 text-sm font-medium text-slate-100">
            Height Above Nearest Drainage
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <CloudRain className="size-3.5 text-sky-300" /> Modelled flood depth
        </div>
      </div>
      <div className="mt-3 h-2 rounded-full border border-white/10 bg-gradient-to-r from-[#a7dff5] via-[#0ea5e9] to-[#0a4a87] shadow-[0_0_18px_rgb(14_165_233/22%)]" />
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
        <span>Shallow (&lt;0.3m)</span>
        <span>Deep (&gt;1.5m)</span>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-slate-600/30 pt-4">
        <Button
          type="button"
          size="icon-lg"
          onClick={() => setPlaying(!playing)}
          className="size-9 rounded-lg bg-sky-400 text-slate-950 hover:bg-sky-300"
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        >
          {playing ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </Button>
        <span className="text-xs font-semibold tabular-nums text-slate-300">
          H08
        </span>
        <div className="relative flex-1 pt-5">
          <output
            className="absolute left-[var(--timeline-position)] top-0 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-900 shadow-lg"
            style={
              {
                '--timeline-position': `${(timeline / 16) * 100}%`,
              } as CSSProperties
            }
          >
            {hour}
          </output>
          <Slider
            value={[timeline]}
            min={0}
            max={16}
            step={2}
            onValueChange={(value) =>
              setTimeline(typeof value === 'number' ? value : (value[0] ?? 8))
            }
            aria-label="Scenario hour"
            className="[&_[data-slot=slider-range]]:bg-sky-400 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-sky-400 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-slate-600"
          />
        </div>
        <span className="text-xs font-semibold tabular-nums text-slate-300">
          H08
        </span>
      </div>
    </aside>
  );
}

function CoverageVisual() {
  return (
    <div className="relative mt-3 h-36 overflow-hidden rounded-xl border border-slate-600/35 bg-[#07141c]">
      <div className="scan-line absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-emerald-300/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[58%] bg-[linear-gradient(160deg,transparent_0_18%,#264736_19%_42%,#18382d_43%_63%,#0e291f_64%)] opacity-85" />
      <div className="coverage-cone absolute bottom-[28px] left-[42%] h-[92px] w-[155px] -translate-x-1/2 opacity-70" />
      <div className="absolute bottom-[30px] left-[42%] -translate-x-1/2 text-emerald-200">
        <RadioTower className="size-8" />
      </div>
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-emerald-300/20 bg-emerald-300/8 px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-emerald-200 uppercase">
        <span className="size-1.5 rounded-full bg-emerald-300" /> LOS service
        area
      </div>
      <div className="absolute bottom-2 right-2 text-[10px] text-slate-500">
        VISUAL ESTIMATE
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: IconComponent;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-600/30 bg-slate-900/35 p-3">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon className="size-3.5" aria-hidden />
        <p className="text-[10px] font-semibold tracking-[0.1em] uppercase">
          {label}
        </p>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-100 tabular-nums">
        {value}
      </p>
    </div>
  );
}

function InterventionContent({ onClose }: { onClose?: () => void }) {
  const [council, setCouncil] = useState('Fixed Weighting 1');
  const [decision, setDecision] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-600/35 px-4 py-3.5">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-sky-300 uppercase">
            Candidate 04
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-white">
            Intervention Analysis
          </h2>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={onClose}
            aria-label="Close intervention analysis"
            className="text-slate-400 hover:bg-slate-700/60 hover:text-white"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 rounded-xl border border-emerald-300/20 bg-emerald-300/8 p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-emerald-200/75 uppercase">
                Reconnected population
              </p>
              <Users className="size-4 text-emerald-300" aria-hidden />
            </div>
            <div className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em] text-emerald-300 tabular-nums">
              +13,369
            </div>
            <p className="mt-1.5 text-xs text-emerald-100/55">
              Across 12 priority communities
            </p>
          </div>
          <MetricCard
            icon={Waves}
            label="Site flood depth"
            value="Dry (0.0m)"
          />
          <MetricCard
            icon={CircleDollarSign}
            label="Est. cost"
            value="RM 45,000"
          />
        </div>

        <CoverageVisual />

        <section className="mt-5">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-[0.12em] text-slate-300 uppercase">
              Decision council
            </h3>
            <span className="rounded-md border border-slate-600/40 bg-slate-800/60 px-1.5 py-1 text-[10px] text-slate-400">
              4 lenses
            </span>
          </div>
          <RadioGroup
            value={council}
            onValueChange={setCouncil}
            aria-label="Decision council weighting"
            className="gap-1.5"
          >
            {councilOptions.map(([name, description], index) => (
              <label
                htmlFor={`council-${index}`}
                key={name}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 transition-colors ${council === name ? 'border-sky-300/25 bg-sky-300/8' : 'border-slate-600/25 bg-slate-900/20 hover:bg-slate-700/30'}`}
              >
                <RadioGroupItem
                  id={`council-${index}`}
                  value={name}
                  className="border-slate-500 data-checked:border-sky-300 data-checked:bg-sky-400"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-100">
                    {name}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {description}
                  </span>
                </span>
                <span
                  title={`${name}: ${description}`}
                  className="grid size-7 place-items-center text-slate-500"
                  aria-label={`About ${name}`}
                >
                  <Info className="size-3.5" aria-hidden />
                </span>
              </label>
            ))}
          </RadioGroup>
        </section>

        <section className="mt-5 rounded-xl border border-slate-600/30 bg-slate-900/35 p-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-sky-300" aria-hidden />
            <h3 className="text-xs font-semibold tracking-[0.12em] text-slate-300 uppercase">
              Oversight log
            </h3>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-slate-400">
            Final placement remains with the response officer. This concept
            records no decision and submits no operational data.
          </p>
        </section>
      </div>

      <div className="border-t border-slate-600/35 bg-slate-950/25 p-3">
        {decision && (
          <p
            className="mb-2 flex items-center gap-2 rounded-lg border border-slate-600/30 bg-slate-800/55 px-2.5 py-2 text-xs text-slate-300"
            aria-live="polite"
          >
            <Check className="size-3.5 text-sky-300" aria-hidden />
            Preview marked: {decision}. Nothing was submitted.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setDecision('Accepted')}
            className="min-h-10 rounded-lg bg-emerald-500 px-2 text-xs font-bold tracking-[0.04em] text-white transition-colors hover:bg-emerald-400"
          >
            ACCEPT
          </button>
          <button
            type="button"
            onClick={() => setDecision('Modify')}
            className="min-h-10 rounded-lg border border-slate-500/45 bg-slate-700/75 px-2 text-xs font-bold tracking-[0.04em] text-white transition-colors hover:bg-slate-600"
          >
            MODIFY
          </button>
          <button
            type="button"
            onClick={() => setDecision('Rejected')}
            className="min-h-10 rounded-lg bg-red-500 px-2 text-xs font-bold tracking-[0.04em] text-white transition-colors hover:bg-red-400"
          >
            REJECT
          </button>
        </div>
      </div>
    </div>
  );
}

function InterventionPanel({
  open,
  onClose,
  onOpen,
}: {
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
        Open analysis
      </button>
    );
  }

  return (
    <aside className="glass-panel absolute bottom-6 right-6 top-20 z-30 hidden w-80 overflow-hidden rounded-xl md:flex">
      <InterventionContent onClose={onClose} />
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
            Yan · Gunung Jerai, Kedah
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
            <button
              type="button"
              className="flex min-h-11 items-center gap-2 rounded-lg bg-emerald-400/12 px-2 text-left text-[11px] font-semibold text-emerald-200"
            >
              <RadioTower className="size-3.5" aria-hidden /> New Portable Tower
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function MobileTimeline({
  timeline,
  setTimeline,
}: {
  timeline: number;
  setTimeline: (value: number) => void;
}) {
  return (
    <div className="glass-panel absolute inset-x-3 bottom-[72px] z-30 rounded-xl px-3 py-2.5 md:hidden">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold tracking-[0.08em] text-sky-200 uppercase">
          HAND
        </span>
        <Slider
          value={[timeline]}
          min={0}
          max={16}
          step={2}
          onValueChange={(value) =>
            setTimeline(typeof value === 'number' ? value : (value[0] ?? 8))
          }
          aria-label="Scenario hour"
          className="flex-1 [&_[data-slot=slider-range]]:bg-sky-400 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-sky-400 [&_[data-slot=slider-track]]:bg-slate-600"
        />
        <span className="w-8 text-right text-xs font-semibold tabular-nums text-white">
          H{String(timeline).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}

function MobileAnalysis({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <dialog
      open
      className="fixed inset-0 z-[60] m-0 flex size-full max-h-none max-w-none items-end border-0 bg-black/40 p-0 backdrop-blur-[2px] md:hidden"
      aria-label="Intervention analysis"
    >
      <div className="glass-panel flex max-h-[84dvh] w-full flex-col overflow-hidden rounded-t-2xl border-x-0 border-b-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-600" />
        <InterventionContent onClose={onClose} />
      </div>
    </dialog>
  );
}

export function ResilinetDashboard() {
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    coverage: true,
    towers: true,
    flood: true,
    roads: true,
    population: true,
  });
  const [timeline, setTimeline] = useState(8);
  const [playing, setPlaying] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);

  const onLayerChange = (key: LayerKey, value: boolean) => {
    setLayers((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-slate-900 text-slate-100">
      <TerrainStage
        layers={layers}
        timeline={timeline}
        resetSignal={resetSignal}
      />
      <TopBar />
      <UtilityRail />
      <LayerPanel layers={layers} onLayerChange={onLayerChange} />
      <TimelinePanel
        timeline={timeline}
        setTimeline={setTimeline}
        playing={playing}
        setPlaying={setPlaying}
      />
      <InterventionPanel
        open={analysisOpen}
        onClose={() => setAnalysisOpen(false)}
        onOpen={() => setAnalysisOpen(true)}
      />
      <MobileControls layers={layers} onLayerChange={onLayerChange} />
      <MobileTimeline timeline={timeline} setTimeline={setTimeline} />
      <MobileDock onOpenAnalysis={() => setMobileAnalysisOpen(true)} />
      <MobileAnalysis
        open={mobileAnalysisOpen}
        onClose={() => setMobileAnalysisOpen(false)}
      />

      <div className="absolute right-[362px] top-20 z-20 hidden rounded-lg border border-white/15 bg-slate-950/55 px-2.5 py-2 text-[11px] text-slate-200 backdrop-blur-md xl:flex">
        <Satellite
          className="mr-1.5 inline size-3.5 text-sky-300"
          aria-hidden
        />
        NASA SRTM · Sentinel-2
      </div>
      <button
        type="button"
        aria-label="Reset map view"
        onClick={() => setResetSignal((value) => value + 1)}
        className="absolute bottom-6 right-[362px] z-20 hidden size-10 place-items-center rounded-xl border border-white/15 bg-slate-950/65 text-slate-300 backdrop-blur-md hover:bg-slate-800 hover:text-white xl:grid"
      >
        <RotateCcw className="size-4" aria-hidden />
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-14 z-20 h-px bg-gradient-to-r from-transparent via-sky-300/25 to-transparent" />
    </main>
  );
}
