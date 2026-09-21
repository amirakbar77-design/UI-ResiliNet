# ResiliNet 3D: questions and answers

Each answer opens by restating the question, then answers it in under 500 characters. Say them as written and you will not ramble.

---

**What is the GeoAI applied in this project?**

The GeoAI in this project is two halves working together. The AI half is the rain: a machine learning weather model gives us hourly rainfall over the whole basin. The geospatial half turns that rain into a decision on the map: river level, flooded ground, roads closing hour by hour, towers losing power, and who each hill can still see. Together they answer one question, where the portable tower should go.

---

**What is the geospatial intelligence applied in this project?**

The geospatial intelligence in this project is the reasoning on the map, and it is deliberate computation, not a black box. From the terrain we build a flood surface, so a river level tells us exactly which ground goes under. A road graph turns that into roads closing, and when. Line of sight from each mast tells us who a tower reaches. Routing from the depot tells us where a truck can still get to in time. Every step is inspectable.

---

**What is the AI applied in this project?**

The AI in this project is one model doing one job. WeatherNext 3 is Google DeepMind's machine learning weather model. It gives us rain for every hour of the next two days, with a range showing how sure it is. We deliberately kept AI out of the decision itself. An officer has to defend that decision the morning after, so the part that says "this hill" has to be readable line by line.

---

**Is this applicable for other ASEAN countries?**

Yes, and it already runs in three valleys: Kelantan, Beaufort in Sabah, and Yen Bai in Vietnam, where Typhoon Yagi knocked out over six thousand base stations in 2024. Every input is global public data: NASA terrain, OpenStreetMap, WorldPop, OpenCellID, and the weather model covers the world. A new valley needs three local facts: the gauge and its danger level, the depot town, and a box on the map.

---

**How accurate is the flood simulation, and did you validate it?**

Yes, against December 2014, the worst on record here. We compared our flood at the peak with the drainage department's published maps. In the river towns the model is right where it counts: of the ground it calls flooded, 88 percent really flooded in Dabong and 92 percent in Manik Urai, and in Kuala Krai it catches 75 percent of the real flood. On the strict overlap score the towns sit at 0.49 to 0.55, and 0.29 valley wide, where one water level spreads too thin up the side streams.

---

**How do you predict the flood?**

We predict the flood in one chain. Start with the gauge reading now. Add the forecast rain hour by hour: each hour pushes the river up, and it drains a little back down. Every patch of ground has a known height above its nearest river, from the NASA terrain. When the river passes that height, the patch floods. A road closes once a hundred and fifty metres of it is under water.

---

**What is the uniqueness? What makes it different?**

What makes it unique is that it does not stop at the water. It models the network: where the twelve real towers are, and that they die from power loss when the fuel road closes, not from getting wet. From that it finds the coverage hole, then answers where the one portable tower and the one convoy should go. Report a tower down and it re-decides in a fifth of a second. Open data only, runs offline, shows its own errors.

---

**How do you measure whether a tower can go on that hill?**

We measure a hill three ways. Can a truck reach it before its road closes? We route from the depot over roads still open each hour. Does it see the people about to lose signal? We trace line of sight from a thirty two metre mast out to nine kilometres and count them. Can it link back? It needs a clear microwave path to a tower that stays alive. Pass all three, then rank by people.

---

**What is next? More AI?**

What is next is three things, none of them AI: a live feed from the river gauge, the operator's real tower and battery list, and a rating curve per stretch of river instead of one water level. That last one is where our validation says the error is. After that, AI earns its place learning rain to river from years of gauge records, and reading radar images to detect flood extent. The decision stays readable.

---

**Who is the target user?**

The target user is the person who decides where the portable tower goes during a flood: the state emergency communications officer, working with the disaster agency. MCMC is the natural owner, because it regulates network resilience and coordinates operators in a disaster. The operators' crews are the ones who act on it. The people in the valley are the ones who benefit.

---

**What is the evidence that this happens in Kelantan?**

The evidence is in the news. December 2014: Kuala Krai an island for five days, Maxis and Digi down across the district, reported by Malaysiakini. December 2022: ninety four power substations shut in four Kelantan districts. November 2024: seven transmitter stations and forty two internet hubs down in Kelantan and Terengganu. Same pattern every time: water takes the power, then the roads, and the towers die in between.

---

**What rules choose a candidate site?**

The rules for a candidate site are three. Dry: at least three metres above its nearest river, at every level we model. Buildable: ten degrees of slope or less, on the site and around it. Reachable: a truck can park within three hundred metres, so nobody carries a tower up a hill. Candidates stay a kilometre apart, and the best thirty are kept in the map.

---

**How is the water network mapped for drainage?**

The drainage network comes from the terrain alone. We take the NASA elevation grid, fill the small pits that would trap water, and work out which way water runs off every cell. Cells collecting enough upstream water become the river, about twenty one thousand of them here. Every other cell records how high it sits above its nearest river cell. That height is the flood surface.
