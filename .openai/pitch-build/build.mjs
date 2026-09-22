import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
const ROOT='/Users/amirulammar/Documents/My VS Code/UI-ResiliNet';
const BUILD=path.join(ROOT,'.openai/pitch-build');
const OUT=path.join(ROOT,'outputs/resilinet-pitch');
const FONT='Helvetica Neue';
const C={paper:'#FAFAF7',ink:'#111827',grey:'#6B7280',blue:'#1D4ED8',red:'#DC2626',dark:'#0B0F14'};
const p=Presentation.create({slideSize:{width:1600,height:900}});
const visible=[];
function slide(title,dark=false){const s=p.slides.add();s.background.fill=dark?C.dark:C.paper;visible.push({slide:visible.length+1,title,text:[]});return s;}
function text(s,str,x,y,w,h,size=32,color=C.ink,bold=false,align='left'){
  const t=s.shapes.add({geometry:'textbox',name:str.slice(0,45),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  t.text=str;t.text.style={typeface:FONT,fontSize:size,color,bold,alignment:align,verticalAlignment:'top',autoFit:'none',wrap:'square',insets:{left:0,right:0,top:0,bottom:0}};
  visible.at(-1).text.push(str);return t;
}
function title(s,str){text(s,str,80,62,1440,150,58.7,C.ink,true);}
function footer(s,source,n){text(s,source,80,845,1360,29,18.7,C.grey);text(s,String(n).padStart(2,'0'),1460,845,60,30,18.7,C.grey,false,'right');}
async function image(s,file,x,y,w,h,alt){const im=s.images.add({blob:new Uint8Array(await fs.readFile(path.join(BUILD,'assets',file))),contentType:'image/png',position:{left:x,top:y,width:w,height:h},fit:'cover',...(file==='forecast.png'?{crop:{left:0.02,top:0,right:0.04,bottom:0.34}}:{}),geometry:'roundRect',borderRadius:16,alt});if(file==='forecast.png') im.crop={left:0.02,top:0,right:0.04,bottom:0.34};}
function notes(s,time,script,sources,extra=''){s.speakerNotes.textFrame.setText(`TIMING: ${time}\n\n${script}\n\n${extra}\n\nSOURCES\n${sources}`);}
const model='ResiliNet scenario. Kelantan, gauge 27.0 m, planning hour +14 h. Model estimates, not observed outages.';
const provenance='App screenshots: ResiliNet local prototype. Terrain: NASA SRTM. Imagery: Sentinel-2 cloudless 2020, EOX IT Services GmbH, CC BY 4.0, based on modified Copernicus Sentinel data 2020. Roads and settlements: OpenStreetMap contributors, ODbL. Population: WorldPop 2020, CC BY 4.0.';
let s=slide('Full battery. No service.',true);
text(s,'Full battery.',80,168,1440,160,132,'#FFFFFF',true);
text(s,'No service.',80,325,1440,180,154,'#FFFFFF',true);
text(s,'The tower is standing. On dry ground.',86,566,1430,68,48,'#B6C3D2');
text(s,'ResiliNet',86,760,270,53,36,'#FFFFFF',true);
text(s,'Helps response teams place portable towers before roads close',364,766,1040,48,28,'#94A3B8');
notes(s,'0:00–0:25',`Imagine being on a roof as floodwater rises. Your phone has a full battery, but no service. The tower is still standing on dry ground. A flood can cut its access, its power, or its connection to the rest of the network. ResiliNet helps emergency communications teams decide where to send a portable tower before the roads close.`, 'Illustrative opening, not a documented account of a particular person or tower. Mechanism implemented in lib/network.ts.');

s=slide('Malaysia’s floods, December 2014'); title(s,'Malaysia’s floods, December 2014');
text(s,'237,000',70,238,1460,380,310,C.blue,true);
text(s,'people displaced nationwide',88,619,1400,64,43,C.ink);
text(s,'In Kelantan, families pleaded for help when they found signal.',88,741,1420,58,32);
footer(s,'Malaysiakini, 30 Dec 2014. Kelantan reporting: The Malaysian Insider, 26 Dec 2014.',2);
notes(s,'0:25–0:50',`In December 2014, about 237,000 people were displaced nationwide. Kelantan was at the centre of that crisis. Families in cut-off communities pleaded for help through social media when they could connect. Communication let them ask for help and tell others where they were. This history motivates our project. The numbers that follow come from a simulated storm, not that historical event.`, 'https://www.malaysiakini.com/news/284861 (237,037 nationally at 8:30 pm on 30 Dec; not a Kelantan-only count).\nhttps://blog.limkitsiang.com/2014/12/27/kelantan-flood-victims-plead-for-aid-via-social-media/amp/ (reproduces The Malaysian Insider, 26 Dec).', 'Do not imply that all displaced people lost service. Do not claim every mast survived.');

s=slide('Dry ground can still lose signal');title(s,'Dry ground can still lose signal');
text(s,'SIMULATED STORM · 14 HOURS AHEAD',88,218,1400,42,25,C.blue,true);
text(s,'19,595',70,260,1460,380,310,C.blue,true);
text(s,'people on dry ground, without signal',88,619,1440,64,43);
text(s,'Flooded roads isolate towers. Backup power runs out. Signal disappears.',88,741,1430,55,32);
footer(s,'Illustrative scenario at +14 h. ResiliNet coverage model and WorldPop 2020.',3);
notes(s,'0:50–1:30',`Here is the distinction that matters. The flood map and the communications map answer different questions. A flooded home under a working tower may still call for help. A dry village under a failed tower may not. In our demonstration scenario, 19,595 people occupy cells that remain dry but lose modelled coverage. That is a subset of the people we will see on the next slide. A map of water alone does not reveal that need. ResiliNet follows the dependencies that connect the rain, roads, towers, and people.`, model+'\nVerified against coverageHole and the population-aligned HAND raster in the current repository. Dry means HAND is 255 or at least the simulated flood threshold at +14 h. '+provenance, 'Counts represent estimated people living in modelled coverage areas, not measured phones, subscribers, calls, or lives saved.');

s=slide('Where should the portable tower go?');title(s,'Where should the portable tower go?');
text(s,'36,614',74,237,1440,350,300,C.red,true);
text(s,'people projected to lack signal at hour 14',88,615,1400,67,42);
text(s,'Includes the 19,595 on dry ground. Where should one portable tower go?',88,741,1430,60,32);
footer(s,'Illustrative scenario. Kelantan gauge 27.0 m. Before any response.',4);
notes(s,'1:30–2:05',`Across this valley, the scenario projects 36,614 people without coverage at hour fourteen, including the dry-ground group. The operator has one portable tower. Which hill should it go to? A high hill is not enough if the truck cannot reach it, terrain blocks the villages, or there is no working network to connect to. Our prototype compares fifteen candidate locations. Seven are usable here. It gives the officer a specific place to investigate, before roads close.`, model+'\nnode scripts/check-sites.mjs kelantan 27\npublic/terrain/terrain.json: 15 candidate sites; 7 usable reachable sites.\nWorldPop 2020.', 'The original draft’s 30 hills is not the current dataset. The four-hour deadline applies to a support convoy’s latest arrival, not a universal portable-tower departure deadline. Use relative hours, not a fixed 04:00 wall clock.');

s=slide('The right hill, before the road closes');title(s,'The right hill, before the road closes');
await image(s,'search.png',80,220,930,560,'Full-valley route search with tower markers and roads in the ResiliNet app');
text(s,'Every location must pass',1060,236,450,54,28,C.grey);
text(s,'Reachable in time',1060,331,450,62,36,C.blue,true);
text(s,'Reaches people',1060,466,450,62,36,C.blue,true);
text(s,'Links to a\nworking tower',1060,599,450,110,36,C.blue,true);
footer(s,'ResiliNet prototype. NASA SRTM, OpenStreetMap, WorldPop and OpenCellID.',5);
notes(s,'2:05–2:45',`ResiliNet tests each location in three ways. Can the truck reach it before access closes? Can the tower see people who would otherwise lose signal? Can it connect back to a working part of the network? The model connects rainfall to river level, river level to road access, and tower failures to coverage loss. The map shows the reachable roads and compares candidate sites over real terrain. It uses elevation, a road graph, line-of-sight coverage, and population estimates. The innovation is bringing these dependencies into one decision that an officer can inspect.`, model+'\nImplementation: lib/forecast.ts, lib/routing.ts, lib/network.ts, lib/viewshed.ts, lib/sites.ts, lib/recommend.ts.\n'+provenance, 'Explain “links back” as the portable tower’s connection to the wider mobile network. The storm and several physical thresholds are illustrative.');

s=slide('One plan: a portable tower + generator support');title(s,'One plan: a portable tower + generator support');
text(s,'8,604',70,247,805,295,250,C.blue,true);
text(s,'additional people keep\na connection',87,539,680,110,39);
text(s,'of 13,811 still at risk\nafter routine support',87,684,685,90,32,C.grey);
await image(s,'answer.png',830,223,690,480,'Recommended portable tower at Kampung Bukit Bedak and its coverage');
text(s,'1,128 via the portable tower\n7,476 via generator support',830,724,690,90,30,C.ink,true);
footer(s,'Model estimate. Including routine support: 31,407 benefit; 5,207 remain without coverage.',6);
notes(s,'2:45–3:20',`The plan combines a portable tower at Bukit Bedak with generator support at Kuala Balah. After routine support, 13,811 people still face an outage. This additional plan keeps 8,604 connected: 1,128 through the portable tower and 7,476 through generator support. Including routine support, the guided demo shows 31,407 benefiting overall; 5,207 remain without coverage. These are population estimates within modelled radio coverage, not confirmed working calls or a deployment result. The route and connection are inspectable in the app.`, model+'\nnode scripts/check-sites.mjs kelantan 27: baseline keeps 22,803; residual 13,811; combined plan 8,604 = support at Kuala Balah 7,476 + portable tower 1,128; remaining 5,207.\n'+provenance, 'The guided demo displays 31,407 including routine support. The full app displays 8,604 additional to that baseline. Both reconcile to 36,614 initially at risk.');

s=slide('Public data. Transparent assumptions.');title(s,'Public data. Transparent assumptions.');
await image(s,'forecast.png',80,220,850,560,'Scenario rain on the actual valley map');
s.shapes.add({geometry:'rect',position:{left:80,top:630,width:850,height:150},fill:C.paper,line:{fill:'none',width:0}});
text(s,'Prepared rainfall scenario',80,692,850,62,32,C.grey);
text(s,'Terrain and roads\nPopulation and towers\nAI weather forecasts',985,232,535,190,38,C.ink,true);
text(s,'The demo uses\na synthetic storm',985,485,535,102,36,C.blue,true);
text(s,'2014: road cuts matched;\none village outage missed',985,661,535,91,32,C.grey);
footer(s,'NASA, OSM, WorldPop, OpenCellID, Google DeepMind WeatherNext 3, ECMWF ERA5-Land.',7);
notes(s,'3:20–3:55',`Public data supplies the terrain, roads, population and tower records. WeatherNext 3 supplies an AI forecast option. This demonstration uses a synthetic storm so the decision unfolds in one sitting. We checked parts of the chain against December 2014: bridge and town-access checks match, one village outage is missed, and the operator comparison is partial. The river model needs calibration. We expose those limits because a dispatch decision needs traceable assumptions. Forecast accuracy and real-world benefit remain to be established.`, 'https://science.nasa.gov/mission/srtm/\nhttps://www.openstreetmap.org/copyright\nhttps://hub.worldpop.org/geodata/summary?id=49771\nhttps://opencellid.org/\nhttps://deepmind.google/science/weathernext/\nhttps://cds.climate.copernicus.eu/datasets/reanalysis-era5-land\nnode scripts/check-hindcast.mjs; lib/method.ts; README.md\n'+provenance, 'Historical checks are partial mechanism checks at a reported peak, not an end-to-end validated 2014 forecast. The shipped rainfall model does not reproduce the historical peak.');

s=slide('Two valleys. The same planning engine.');title(s,'Two valleys. The same planning engine.');
await image(s,'galas.png',80,226,700,465,'Sungai Galas terrain and coverage in the Kelantan deployment');
await image(s,'padas.png',820,226,700,465,'Sungai Padas terrain and coverage in the Sabah deployment');
text(s,'Galas, Kelantan',80,710,700,56,35,C.ink,true);
text(s,'Padas, Sabah',820,710,700,56,35,C.ink,true);
text(s,'Prepare the data once. Plan offline when connectivity fails.',80,782,1400,47,32,C.blue);
footer(s,'ResiliNet prototype. Two prepared datasets. Operational use requires local validation.',8);
notes(s,'3:55–4:25',`The same engine runs in the Galas valley in Kelantan and the Padas in Sabah, each with prepared local data. Once the application and assets are installed locally, teams can explore the scenario and enter site reports without an internet connection. Fresh forecasts still require an update. Two valleys demonstrate portability, not nationwide readiness. Operational use needs verified operator infrastructure, local hydrology and ground checks.`, 'Repository: lib/maps.ts; public/terrain; public/terrain-padas; scripts/bake-terrain.mjs; next.config.ts; README.md.\n'+provenance, 'An initial download and local static serving/setup are required. Building or refreshing datasets can require online services and credentials. No claim of a completed operational deployment.');

s=slide('When a tower fails, the plan changes');title(s,'When a tower fails, the plan changes');
text(s,'1',82,202,410,393,340,C.blue,true);
text(s,'new report',105,607,510,67,46);
text(s,'A new recommendation',690,301,805,96,58.7,C.ink,true);
text(s,'Watch the two-minute live demo',694,436,790,110,42,C.grey);
text(s,'Seeking an operator pilot: verified sites, outage logs, field checks.',86,757,1430,57,32,C.blue);
footer(s,'Interactive prototype. Replanning time depends on the device and scenario.',9);
notes(s,'4:25–4:50, then switch by 5:00',`Floods change while you plan. When a report says a tower has failed, the officer updates it and the recommendation changes. We are seeking an operator partner to provide verified sites, outage logs and field checks. The pilot should compare predicted outages and recommended access routes with actual conditions. Let me show that decision in two minutes.`, 'Implementation: components/resilinet-dashboard.tsx, onSiteTap and buildPlan. The draft’s 0.2-second claim is omitted because no reproducible device-specific benchmark was supplied.', `LIVE DEMO 5:00–7:00\nUse /explore for a controlled demonstration. The homepage loops automatically; pause it if using it instead.\n5:00–5:20: Kelantan, Scenario, 27.0 m. Point to real terrain and the communities.\n5:20–5:42: Forecast. Let the storm play, then select the default +14 h outage.\n5:42–6:12: Site, Start. Explain the three location checks while the roads and candidates animate.\n6:12–6:35: Show the Bukit Bedak recommendation and 8,604 additional people. Mention the separate routine-support baseline so the totals are clear.\n6:35–6:55: Tap Kuala Balah once to report it down; show the changed plan. Say the number on screen rather than precommitting to one.\n6:55–7:00: Close with the request for an operator-data pilot.\nRehearse the exact browser build and keep the result slide as the fallback if the live demo fails.`);

await fs.mkdir(path.join(BUILD,'renders'),{recursive:true});
await fs.mkdir(OUT,{recursive:true});
await (await PresentationFile.exportPptx(p)).save(path.join(BUILD,'candidate.pptx'));
await fs.writeFile(path.join(BUILD,'visible-slide-text.json'),JSON.stringify(visible,null,2));
for(let i=0;i<p.slides.items.length;i++){
 const slide=p.slides.items[i];
 const b=await p.export({slide,format:'png',scale:1});
 await fs.writeFile(path.join(BUILD,'renders',`slide-${i+1}.png`),new Uint8Array(await b.arrayBuffer()));
 const layout=await slide.export({format:'layout'});
 await fs.writeFile(path.join(BUILD,'renders',`slide-${i+1}.json`),await layout.text());
 console.log(`Rendered slide ${i+1}`);
}
console.log('Draft complete');
