# ResiliNet — 7-minute pitch

5:00 of slides, 2:00 of live demo. Six slides, on the spine from the handwritten outline: intro → objective → problem → how it is built → how it decides → impact. Every number is the app's output at the default reading (Kelantan map, Scenario · design storm, gauge 27.0 m, planned for +14 h) or a cited source.

The three numbers carry the arc: **36,614** people about to lose their phone → **19,595** of them on dry ground, because the tower loses power, not because it floods → **8,604** kept alive by putting the portable tower on the right hill.


---


## Slide 1 · 0:00 – 0:30 · Intro — stuck on the roof

**Near-black. One line, white, 84 pt:**

> Full battery. No service. The tower is standing, two kilometres away.

No body, no source.

> [Two seconds of silence.] You are on the roof. Water to the gutter. The phone in your hand has full battery and no service. The tower that serves you is two kilometres away, on the hill, standing, dry, and dead. This happened to a quarter of a million people in Kelantan in December 2014. Kuala Krai was an island for five days, two of the three networks were down, and people pleaded for rescue on Facebook the moment they caught one bar. The masts above them stood the whole week.

Two other openings, if you prefer: the accusation, "Nobody drowned that tower. It was cut off, and no map showed it coming." Or the silence: black slide, "No service.", four seconds of quiet, then "That is what a quarter of a million people heard in December 2014." I recommend the one above: the judge is on the roof in four words and the assumption breaks in the same breath.

---

## Slide 2 · 0:30 – 0:55 · Objective

**Big number (red):** 36,614
**Headline:** Minimise the impact of the outage.
**Body (12 words):** People in this valley who lose their phone by 04:00. Shrink it.
**Source:** ResiliNet at 27.0 m · WorldPop 2020

> Our objective is one sentence: minimise the impact of the telecommunication outage a flood causes. In the Sungai Galas valley, at two metres above danger level, thirty-six thousand people lose their phone by four in the morning. Everything we built exists to make that number smaller, while the roads are still open.

---

## Slide 3 · 0:55 – 1:50 · Problem statement

**Big number (accent):** 19,595
**Headline:** The tower doesn't drown. Its power goes.
**Body (12 words):** Of the 36,614: on dry ground. Flooded homes under a live tower still call.
**Source:** FCC DIRS, Hurricane Helene: 63% of outages power, 36% backhaul · MCMC 2014

> Here is the problem, and the part everyone gets wrong. In annual flood-prone areas the towers go down every year, and it is not the water that takes them. A tower sits on high ground. The grid fails with the flood, the battery lasts hours, and once the road to it is closed nobody can reach it. After Hurricane Helene the FCC counted it: two thirds of dead cell sites were power, a third backhaul, water almost none. MCMC saw the same in Kelantan. So the phones do not die where the water is. In this valley, at the worst hour, nineteen thousand six hundred of those thirty-six thousand people are standing on dry ground with a phone that does nothing. On the flood map they are fine. The map shows water. It does not show silence.

---

## Slide 4 · 1:50 – 2:40 · Technical implementation — what it is built from

**Map (largest element):** the app's 3D valley, centred, in its frame. Five short labels around it with thin lines to the map, as in the sketch:
Elevation · NASA SRTM — Surface · Sentinel-2 — Flood · HAND — Roads · OpenStreetMap — People · WorldPop
and two more in the same style: Towers · OpenCellID — Rain · WeatherNext 3
**Headline:** A 3D valley built only from public data.
**Body (11 words):** Seven open layers, baked once. No server, no keys, runs offline.
**Source:** NASA · ESA/EOX · OpenStreetMap · WorldPop · OpenCellID · Google DeepMind

> We built the valley to simulate it. NASA terrain for the ground. Sentinel-2 for the surface. From the terrain we derive height above the nearest river, so the flood is a level, not a drawing. OpenStreetMap for every road, bridge and railway. WorldPop for the people, so every number is a person, not a guess. Open cell records for the towers that exist today. And the rain is Google DeepMind's WeatherNext 3, an AI weather model, hourly over the whole basin, with its own uncertainty band. It is baked once into a static site: no server, no API keys, it runs on a laptop with no internet in an operations room. Point the same code at another valley and it runs; the second one is the Padas gorge in Sabah.

---

## Slide 5 · 2:40 – 3:45 · Technical implementation — how it decides

**Map (largest element):** app screenshot, Site stage after Start, before the card: roads green / amber / red by the hour they close, red markers at the cuts, candidate hills with their people counts.
**Headline:** Where does the tower go, before the road closes?
**Body (12 words):** Reachable before its road closes. Sees the phones. Links back to the network.
**Source:** ResiliNet at 27.0 m, planned for +14 h

> Then it decides. Rain over the basin becomes a river level, hour by hour. The river closes each road at the hour the forecast says. Closed roads take towers off the air. Dead towers are phones that stop. That gives us the hour the network is at its worst, and the roads still open before then: green stays open, amber closes before the peak, red within two hours. Every hill the truck can still reach is tested three ways. Can it get there before its road closes. Does it see the phones about to go silent, by line of sight from the mast. Can it link back by microwave to a tower that is still alive. The hill that passes all three and covers the most people wins. Under the hood that is a road graph that closes when a hundred and fifty metres go under, line of sight over the terrain from every mast, and the shortest open route from the depot, recomputed for every hour of the forecast.

---

## Slide 6 · 3:45 – 4:45 · Impact

**Big number (accent):** 8,604
**Headline:** Bukit Bedak. Faster, clear, justifiable.
**Map, smaller, beside the number:** Site stage with the card: mast on Kampung Bukit Bedak, dashed link to Kuala Balah.
**Body (10 words):** Phones kept alive tonight. Every number traceable. Re-decides in 0.2 s.
**Source:** ResiliNet plan at 27.0 m · method panel

> For this night the answer is Bukit Bedak. Dry, reachable, high enough to see the upper valley, ten kilometres line of sight to Kuala Balah. Eight thousand six hundred people keep a working phone through the night who otherwise would not. The impact is three things. Faster: this decision is made in seconds instead of from a phone call and a paper map. Clear: it is a hill, a link, and the people it saves, nothing else on the screen. Justifiable: every number traces to public data, every assumption is listed with its value, and we replayed December 2014 through it and show the one village it misses. And it does not hold still. When the call comes in that a tower is under water, the officer taps it and the whole chain decides again in a fifth of a second. Let me show you.

**4:45 – 5:00:** switch to the browser. Say nothing while switching.

---

## Demo run-sheet · 5:00 – 7:00

**Before walking on:** app in a full-screen browser, place chip on Dabong – Kuala Krai, rain chip on "Scenario · design storm", Now stage, gauge 27.0, method sheet closed, no console. Run it once in the morning so the terrain is cached. A second tab with the same page as a spare.

| Time | Click | What appears | The one line I say |
|---|---|---|---|
| 5:00 | nothing yet | Now stage: the valley at 27.0 m; twelve tower markers, nine green, three amber | "Two metres above danger. Three towers already cut off from the world." |
| 5:12 | **Forecast →** | camera flies up; rain drifts up the valley; the river curve draws itself; the red **Outage** pin lands at +14 h | "Rain still coming. River peaks at ten hours. The phones go quiet at fourteen. That red pin is the hour we plan for." |
| 5:35 | **Plan for the outage** | camera flies down to the Site stage | "Now: where does the tower go?" |
| 5:42 | **Start evaluation** | wave lights the roads from the depot, green / amber / red; red markers at cut crossings; tower fans grey out; candidate hills spawn with people counts | "Green stays open, amber closes before the peak, red within two hours. Every hill the truck can still reach, with the people it would bring back." |
| 6:05 | nothing | card: **8,604 people kept on signal**; mast rises on Bukit Bedak; dashed link to Kuala Balah; amber ring on Kuala Balah | "Bukit Bedak. Linked to Kuala Balah, which we keep alive by sending a generator there before its road closes. Eight thousand six hundred phones stay on." |
| 6:25 | say the line, then **click the Kuala Balah marker** once | its dot turns red with a **reported** tag; the card becomes portable tower at Jelawang, **5,141**; the mast and the link move; the camera stays | "The operator just called. Kuala Balah is under water. [click] Jelawang. New hill, new link. Five thousand one hundred. Same night, same roads, new answer." |
| 6:45 | nothing. Hold the screen. | | closing line |

**Closing line, 6:48 – 7:00:**

> It does not have a fixed answer. It has a fixed way of thinking, and every time the valley changes it decides again, so the phone on the roof still gets a bar.

Stop there. No "thank you", no "questions". Let the screen hold.

### If something goes wrong

| Problem | Do this |
|---|---|
| The wave is slow on the venue machine | press **Skip animation** under Start; the card appears at once |
| The Kuala Balah marker is off screen after the camera glide | drag the map down a little; it sits north-east of the depot, up the valley |
| A click misses the marker | click again; the tag says **reported** when it has taken |
| The browser dies | spare tab, start from **Forecast →** (25 s); failing that, slides 5 and 6 carry the same screens |

### Questions to drill, one-line answers

- **Where are the towers from?** Open cell records clustered and snapped to dry ground, plus one OpenStreetMap mast: twelve corroborated sites. The rule is in the method panel.
- **Why this hill?** Reachable before its road closes, sees the most people about to lose their phones within nine kilometres line of sight, and has a microwave path to a tower alive in the plan. Tap any other hill to compare.
- **Why does the tower die if it is dry?** It loses grid power with the flood and runs on battery; it stays alive only while a crew can still reach it. That is the support move in the demo.
- **What is real, what is assumed?** Terrain, roads, population, towers and the rain feeds are real and licensed. The design storm, the battery hours and the river constants are assumptions, listed with values in the method panel next to where a real value comes from.
- **Did you validate it?** Against December 2014: the bridge and the isolation right, the town's networks half right, one village missed, on screen.
- **How would an agency adopt it?** A static build that runs offline. A new valley is a bake from public data plus one entry in the map list. Real inputs replace the assumptions one at a time; the chain does not change.
- **Isn't the hill always the same?** Most nights, yes, and an operator would pre-plan it. It earns its keep the moment the report changes, which you just saw.
