/* The landing view: the concept loop running live, with one way in.

   The scene reports overlay state every frame; anything that changes at frame
   rate (the counter, the pointer, the ripple) is written straight to the DOM
   through refs, and React state carries only what changes at beat rate. That
   keeps a 60 fps scene from driving 60 renders a second. */

import { useEffect, useRef, useState } from "react";

import { createConceptScene, type ConceptFrame, type ConceptHandle } from "./conceptScene";
import { ACT_STARTS, BEATS, SCENARIO } from "./landingModel";
import "./landing.css";

const ACT_TITLES = [
  "A normal day",
  "The failure",
  "The obvious answers fail",
  "The engine's answer",
];

export function Landing({ onEnter }: { onEnter: () => void }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ConceptHandle | null>(null);

  const chipRef = useRef<HTMLDivElement | null>(null);
  const chipNumRef = useRef<HTMLDivElement | null>(null);
  const chipLabelRef = useRef<HTMLDivElement | null>(null);
  const chipSubRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLSpanElement | null>(null);
  const cursorRef = useRef<SVGSVGElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipTitleRef = useRef<HTMLElement | null>(null);
  const tipDetailRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  const [beat, setBeat] = useState(0);
  const [act, setAct] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // A fresh canvas per mount: a WebGL context cannot be handed to a second
    // renderer, and React's development double-mount would do exactly that.
    const canvas = document.createElement("canvas");
    canvas.className = "landing-canvas";
    canvas.setAttribute(
      "aria-label",
      "Three-dimensional concept scene: Kuala Krai river communities lose connectivity in a flood, and a well placed tower restores it.",
    );
    host.appendChild(canvas);

    const write = (frame: ConceptFrame): void => {
      const chip = chipRef.current;
      if (chip) chip.dataset.tone = frame.chip.tone;
      if (chipNumRef.current) {
        chipNumRef.current.textContent = frame.chip.figure.toLocaleString("en-US");
      }
      if (chipLabelRef.current) chipLabelRef.current.textContent = frame.chip.label;
      if (chipSubRef.current) chipSubRef.current.textContent = frame.chip.sub;
      if (stageRef.current) stageRef.current.textContent = `${frame.stageM.toFixed(1)} m`;

      const cursor = cursorRef.current;
      const tip = tipRef.current;
      const ring = ringRef.current;
      if (frame.cursor && cursor && tip && ring) {
        cursor.style.opacity = String(frame.cursor.opacity);
        cursor.style.transform = `translate(${frame.cursor.x}px, ${frame.cursor.y}px)`;
        tip.style.opacity = String(frame.cursor.opacity);
        const tipX = Math.max(12, Math.min(frame.cursor.x + 24, window.innerWidth - tip.offsetWidth - 12));
        const tipY = Math.max(12, Math.min(frame.cursor.y + 16, window.innerHeight - tip.offsetHeight - 80));
        tip.style.transform = `translate(${tipX}px, ${tipY}px)`;
        if (tipTitleRef.current) tipTitleRef.current.textContent = frame.tip.title;
        if (tipDetailRef.current) tipDetailRef.current.textContent = frame.tip.detail;
        ring.style.opacity = String(frame.ring.opacity);
        ring.style.left = `${frame.ring.x}px`;
        ring.style.top = `${frame.ring.y}px`;
        ring.style.width = `${frame.ring.size}px`;
        ring.style.height = `${frame.ring.size}px`;
      } else {
        if (cursor) cursor.style.opacity = "0";
        if (tip) tip.style.opacity = "0";
        if (ring) ring.style.opacity = "0";
      }
    };

    const handle = createConceptScene(canvas, {
      onFrame: write,
      onBeat: setBeat,
      onAct: setAct,
      onPlayingChange: setPlaying,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    sceneRef.current = handle;
    setPlaying(handle.isPlaying());

    return () => {
      handle.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "BUTTON" || target?.tagName === "INPUT";
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        sceneRef.current?.setPlaying(!(sceneRef.current?.isPlaying() ?? false));
      }
      if (e.code === "Enter" && !typing) onEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter]);

  const current = BEATS[beat] ?? BEATS[0]!;

  return (
    <div className="landing">
      <div className="landing-stage" ref={hostRef} />

      <header className="landing-head">
        <div>
          <div className="landing-wordmark">ResiliNet 3D</div>
          <div className="landing-tagline">
            See who loses connectivity in a flood, and what a tower or a generator actually
            brings back, before the money is spent.
          </div>
        </div>
        <div className="landing-actions">
          <button type="button" className="landing-cta" onClick={onEnter}>
            Open the working prototype
          </button>
          <div className="landing-cta-sub">Kuala Krai · Sungai Galas–Kelantan valley</div>
        </div>
      </header>

      <div className="landing-chip" ref={chipRef} data-tone="teal">
        <div className="landing-chip-num" ref={chipNumRef}>
          {SCENARIO.online.toLocaleString("en-US")}
        </div>
        <div className="landing-chip-label" ref={chipLabelRef}>
          online
        </div>
        <div className="landing-chip-sub" ref={chipSubRef}>
          modelled coverage · before storm
        </div>
      </div>

      <div className="landing-stage-chip">
        scenario stage <span ref={stageRef}>0.0 m</span>, a dial, not a forecast
      </div>

      <div className="landing-caption" data-tone={current.tone} key={beat}>
        <div className="landing-eyebrow">{current.eyebrow}</div>
        <h1 className="landing-heading">{current.heading}</h1>
        <p className="landing-sub">{current.sub}</p>
      </div>

      <div className="landing-dots" role="group" aria-label="Jump to act">
        {ACT_STARTS.map((_, i) => (
          <button
            key={i}
            type="button"
            className="landing-dot"
            aria-current={i === act ? "true" : "false"}
            title={ACT_TITLES[i]}
            onClick={() => sceneRef.current?.actStart(i)}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          className="landing-dot landing-play"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => sceneRef.current?.setPlaying(!playing)}
        >
          {playing ? "❚❚" : "▶"}
        </button>
      </div>

      <svg className="landing-cursor" ref={cursorRef} width="26" height="30" viewBox="0 0 26 30" aria-hidden="true">
        <path
          d="M3 2 L3 24 L9.5 18.5 L13.5 27 L17.5 25 L13.5 17 L22 16 Z"
          fill="#10171c"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <div className="landing-tip" ref={tipRef}>
        <b ref={tipTitleRef} />
        <span ref={tipDetailRef} />
      </div>
      <div className="landing-ripple" ref={ringRef} />

      <footer className="landing-foot">
        <span>
          Illustrative terrain · Counts from the Kuala Krai model: initial gauge 27.0 m, planned +14 h.
          Estimates, not observed outages.
        </span>
        <span className="landing-hint">drag to orbit, scroll to zoom, space to pause</span>
      </footer>
    </div>
  );
}
