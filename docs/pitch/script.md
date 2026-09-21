# ResiliNet 3D — presentation script

Five minutes, spoken. Nine slides, the live demo left out and timed on its own. About 700 words at a teaching pace. Paste each block into that slide's speaker notes.

Read it aloud once with a stopwatch before you change a word. The pauses are written in; keep them.

## The eight beats — this is what you memorise

One job per slide, three or four words each. If you can say this list from memory, you cannot get lost.

1. **Roof, no bars** (Title)
2. **Power, not water** (Introduction)
3. **One goal, two moves** (Objective)
4. **The headlines** (Problem)
5. **Walk the picture** (Methodology)
6. **The 8,604** (Benefit)
7. **What is weak** (Limitations)
8. **Back to the bars** (Thank you)

Under every slide there is a beat card. Only two sentences per beat are locked word for word: the first and the last. Openers and transitions are where people blank. The middle you improvise, because you know it cold.

---

## Slide 1 · Title · 0:00 – 0:40

> Before I say the name on this slide, i want u guys to do one small favour for me. Look at the top corner of your phone. Count the bars.

> [pause]

>Keep that number in your head. Imagine it is two in the morning. You are on your roof surrounded by water by a flood. You have your phone on your hand but cannot even use it to get a help cus no line.

> Not because the tower fell. But because the regulator didnt decide the most optimizes place to put the portable tower to cover u.

> That is the problem we solved. This is ResiliNet 3D.

**Beat 1 · Roof, no bars**
- **Open, locked:** "Before I say the name on this slide, I want you guys to do one small favour for me."
- **Middle, improvise:** look at your phone → count the bars → two in the morning, on the roof → phone works, no line → tower is fine, the tower was put in the wrong place
- **Close, locked:** "That is the problem we solved. This is ResiliNet 3D."

---

## Slide 2 · Introduction · 0:40 – 1:10

> Eventhough the tower sits on high ground which was not hit by the flood at all. But it is not working because the power is cut off. Someone has to do something about it. And the road they would use to do something about it is the first to get blocked by the flood.

> So connectivity fails at the exact moment people need it most. 

**Beat 2 · Power, not water**
- **Open, locked:** "Even though the tower sits on high ground which was not hit by the flood at all, it is not working, because the power is cut off."
- **Middle, improvise:** someone has to reach it → the road they need is the first one the river closes
- **Close, locked:** "So connectivity fails at the exact moment people need it most."

---

## Slide 3 · Objective · 1:10 – 1:45

> We gave ourselves one goal, and only one. Keep the most people connected.

> For example in a real flood the operator has one portable tower and one generator convoy. The question is where to send them.

> To answer it you need three things. Which sites will fail, and when. Which roads stay open, and until what hour. And which plcae candidate reconnects the most people.

> In our Kelantan valley, the right moves made could keep eight thousand six hundred of the thirteen thousand eight hundred people who would otherwise go silent.

**Beat 3 · One goal, two moves**
- **Open, locked:** "We gave ourselves one goal, and only one. Keep the most people connected."
- **Middle, improvise:** one portable tower, one generator convoy → where to send them → three things: which sites fail and when, which roads stay open and until when, which place reconnects the most people
- **Close, locked:** "In our Kelantan valley, the right moves could keep eight thousand six hundred of the thirteen thousand eight hundred people who would otherwise go silent."

---

## Slide 4 · Problem Statement · 1:45 – 2:25

> This is not a story we made up. These are Kelantan headlines.

> Over two hundred substations shut down. Ninety four in four districts. Forty two internet hubs down in a single week.

> Read them together and the pattern is clear. The water takes the power, then it takes the roads, and the towers die in between.

> Two groups pay for it. The families cut off on dry ground, and the one crew sent out with a truck and a paper map, trying to decide where to go before the last road closes.

> And this happens every monsoon, in Kelantan and in Sabah.

**Beat 4 · The headlines**
- **Open, locked:** "This is not a story we made up. These are Kelantan headlines."
- **Middle, improvise:** two hundred substations → ninety four → forty two hubs → pattern: water takes the power, then the roads, towers die in between → two groups pay: families on dry ground, one crew with a paper map
- **Close, locked:** "And this happens every monsoon, in Kelantan and in Sabah."

---

## Slide 5 · Live Demo

*Timed outside the five minutes. No script here.*

---

## Slide 6 · Solution Methodology · 2:25 – 3:45

> Here is how it works, and I will walk you around the picture.

> Start at the top. The rain comes from WeatherNext 3, Google DeepMind's weather model, hourly, over the whole river basin. Everything under it is public data. NASA gives us the ground. Sentinel-2 gives us the surface. OpenStreetMap gives us every road, bridge and railway. WorldPop tells us where the people are, and the JPS gauge tells us how high the river is right now.

> Then we prepare it. we use HAND.

> Now the analysis. Start with the rain. Every hour of rain on the basin pushes the river up, so the forecast gives us a river level for every hour ahead. Once we know the level, we know which roads go under, and when. This red crossing, for example, is under water five hours from now. So the question becomes: in the hours before that, where can a truck still get to? We start at the depot, follow the roads that are still open, and mark every hill it can reach in time. Then, standing on each of those hills, we look out across the valley along the line of sight, and count the phones that hill would bring back to life. The hill with the most phones wins.

> The output is that tower. A named hill, with coordinates.

> And we checked it. We replayed December 2014, the flood everyone in this room remembers, and where the model misses, it says so.

**Beat 5 · Walk the picture**
- **Open, locked:** "Here is how it works, and I will walk you around the picture."
- **Middle, improvise, hand on the picture:** cloud: WeatherNext 3 rain → the ground layers: NASA, Sentinel-2, OpenStreetMap, WorldPop, JPS gauge → prepare: the grid, HAND → analysis, one chain: rain pushes the river up, the level says which roads go under and when, the red crossing at five hours, where the truck can still get to, from each hill look along the line of sight and count the phones → output: that tower, a named hill with coordinates
- **Close, locked:** "And we checked it. We replayed December 2014, the flood everyone in this room remembers, and where the model misses, it says so."

---

## Slide 7 · Benefit / Expected Impact · 3:45 – 4:20

> So what does this change?

> Today that decision is a phone call and a guess. With this, the officer gets ranked coordinates in minutes, and a reason next to each one that they can defend the morning after.

> Same tower. Same convoy. Better placed. And in our scenario that is eight thousand six hundred people who keep a working phone through the night.

> For the regulator, it is network resilience you can actually plan. For the operator, it is one less night of guessing where to send the truck.

**Beat 6 · The 8,604**
- **Open, locked:** "So what does this change?"
- **Middle, improvise:** today a phone call and a guess → now ranked coordinates in minutes, with a reason you can defend the morning after → same tower, same convoy, better placed → eight thousand six hundred through the night
- **Close, locked:** "For the regulator, it is network resilience you can actually plan. For the operator, it is one less night of guessing where to send the truck."

---

## Slide 8 · Limitation / Key Challenges · 4:20 – 4:50

> Now let me tell you what is weak, because you would ask anyway.

> Our elevation is thirty metre satellite data, and over forest it reads the treetops, not the ground. Our site list is inferred from open data, not the operator's own inventory. Coverage is line of sight, not full radio propagation. And we have checked 2014 against four reported facts, not a full record.

> Every one of those has a fix, and every fix is a data feed we can connect. None of them is a redesign.

**Beat 7 · What is weak**
- **Open, locked:** "Now let me tell you what is weak, because you would ask anyway."
- **Middle, improvise:** treetops, not ground → site list from open data, not the operator → line of sight, not propagation → 2014 checked on four facts, not a full record
- **Close, locked:** "Every one of those has a fix, and every fix is a data feed we can connect. None of them is a redesign."

---

## Slide 9 · Thank You · 4:50 – 5:00

> So, back to that number of bars on your phone.

> On a bad night, in a river valley, this is how we keep it from reaching zero.

> Thank you.

**Beat 8 · Back to the bars**
- **Open, locked:** "So, back to that number of bars on your phone."
- **Middle:** nothing. One breath.
- **Close, locked:** "On a bad night, in a river valley, this is how we keep it from reaching zero. Thank you."

---

## Delivery notes

- Slide 1: actually wait for people to look at their phones. Three seconds feels long on stage and is right.
- Slide 6 is the longest. Point at the picture as you go: cloud, grid, red crossing, tower, gauge. Your hand does the work the words do not have to.
- The two numbers to say slowly: eight thousand six hundred, and thirteen thousand eight hundred. Everything else can move.
- Slide 8 earns trust. Do not rush it and do not apologise in it.
- If you blank mid-slide, say the locked closing sentence and move on. The next opener is locked too, so you land on your feet.
