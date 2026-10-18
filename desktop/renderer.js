const api = window.tourPulseDesktop;
const $ = id => document.getElementById(id);

const TYPES = [
  ["vip","VIP",true],
  ["ga","GA",true],
  ["goo","GOO",true],
  ["rci","RCI",true],
  ["renter","Renter",true],
  ["bounceback","Bounce Back",false]
];

const VALUES = {
  vip:{seen:0,booked:0},
  ga:{seen:0,booked:0},
  goo:{seen:0,booked:0},
  rci:{seen:0,booked:0},
  renter:{seen:0,booked:0},
  bounceback:{seen:0,booked:0}
};

let USER = null;
let CONFIGS = [];
let ACTIVE = null;
let SAVE_TIMER = null;
let SAVING = false;
let SAVE_AGAIN = false;
let LOADING = false;

function safeInt(v){
  const n = parseInt(String(v ?? "0"),10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function today(){
  const d = new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}

function siteTitle(key){
  return key === "myrtle-beach-oceanfront" ? "MBO — Myrtle Beach Oceanfront" :
         key === "south-beach" ? "SBR — South Beach" : key;
}

function setStatus(text, cls=""){
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

function buildGrid(){
  for(const [key,label,hasSeen] of TYPES){
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="type">${label}</div>
      <div class="cell">
        ${hasSeen ? `
          <span class="value" id="v-${key}-seen">0</span>
          <span class="steps">
            <button class="step" type="button" data-type="${key}" data-field="seen" data-delta="1">▲</button>
            <button class="step" type="button" data-type="${key}" data-field="seen" data-delta="-1">▼</button>
          </span>` : '<span class="na">—</span>'}
      </div>
      <div class="cell">
        <span class="value" id="v-${key}-booked">0</span>
        <span class="steps">
          <button class="step" type="button" data-type="${key}" data-field="booked" data-delta="1">▲</button>
          <button class="step" type="button" data-type="${key}" data-field="booked" data-delta="-1">▼</button>
        </span>
      </div>
    `;
    $("grid").appendChild(row);
  }
}

function reset(){
  for(const [key] of TYPES){
    VALUES[key].seen = 0;
    VALUES[key].booked = 0;
  }
}

function totals(){
  let seen=0, booked=0;
  for(const [key,,hasSeen] of TYPES){
    if(hasSeen) seen += safeInt(VALUES[key].seen);
    booked += safeInt(VALUES[key].booked);
  }
  return {seen,booked,conversion:seen ? booked/seen : 0};
}

function refresh(){
  for(const [key,,hasSeen] of TYPES){
    if(hasSeen){
      const el = $("v-"+key+"-seen");
      if(el) el.textContent = VALUES[key].seen;
    }
    const booked = $("v-"+key+"-booked");
    if(booked) booked.textContent = VALUES[key].booked;
  }
  const t=totals();
  $("totalSeen").textContent=t.seen;
  $("totalBooked").textContent=t.booked;
  $("conversion").textContent=(t.conversion*100).toFixed(t.seen?1:0)+"%";
}

function draftKey(){
  if(!USER || !ACTIVE) return "";
  return "tourpulse-quick-eod|" + USER.emp + "|" + ACTIVE.site_key + "|" + ($("reportDate").value || today());
}

function saveLocalDraft(){
  const key=draftKey();
  if(!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({updated_at:new Date().toISOString(), values:VALUES}));
  }catch(_){}
}

function clearLocalDraft(){
  const key=draftKey();
  if(!key) return;
  try{ localStorage.removeItem(key); }catch(_){}
}

function restoreLocalDraft(){
  const key=draftKey();
  if(!key) return false;
  try{
    const raw=localStorage.getItem(key);
    if(!raw) return false;
    const draft=JSON.parse(raw);
    for(const [type] of TYPES){
      VALUES[type].seen=safeInt(draft?.values?.[type]?.seen);
      VALUES[type].booked=safeInt(draft?.values?.[type]?.booked);
    }
    return true;
  }catch(_){
    return false;
  }
}

async function loadEod(){
  if(!ACTIVE || !USER) return;
  LOADING=true;
  clearTimeout(SAVE_TIMER);
  reset();
  setStatus("Loading…","warn");

  const res=await api.getEod(ACTIVE.site_key,$("reportDate").value || today());

  if(!res?.ok){
    setStatus("Load error","bad");
    LOADING=false;
    refresh();
    return;
  }

  const row=res.row;
  if(row){
    VALUES.vip.seen=safeInt(row.vip_seen);
    VALUES.vip.booked=safeInt(row.vip_booked);
    VALUES.ga.seen=safeInt(row.ga_seen);
    VALUES.ga.booked=safeInt(row.ga_booked);
    VALUES.goo.seen=safeInt(row.goo_seen);
    VALUES.goo.booked=safeInt(row.goo_booked);
    VALUES.rci.seen=safeInt(row.rci_seen);
    VALUES.rci.booked=safeInt(row.rci_booked);
    VALUES.renter.seen=safeInt(row.renter_seen);
    VALUES.renter.booked=safeInt(row.renter_booked);
    VALUES.bounceback.booked=safeInt(row.bounce_back_booked);
  }

  const restored=restoreLocalDraft();
  refresh();
  LOADING=false;

  if(restored){
    setStatus("Draft restored","warn");
    scheduleSave();
  }else if(row?.sync_status==="queued"){
    setStatus("EOD sync queued","good");
  }else if(row?.sync_status==="synced"){
    setStatus("EOD synced","good");
  }else if(row){
    setStatus("TourPulse saved","good");
  }else{
    setStatus("Ready");
  }
}

function payload(){
  return {
    site_key:ACTIVE.site_key,
    report_date:$("reportDate").value || today(),
    vip_seen:VALUES.vip.seen,
    vip_booked:VALUES.vip.booked,
    ga_seen:VALUES.ga.seen,
    ga_booked:VALUES.ga.booked,
    goo_seen:VALUES.goo.seen,
    goo_booked:VALUES.goo.booked,
    rci_seen:VALUES.rci.seen,
    rci_booked:VALUES.rci.booked,
    renter_seen:VALUES.renter.seen,
    renter_booked:VALUES.renter.booked,
    bounce_back_booked:VALUES.bounceback.booked
  };
}

function scheduleSave(){
  if(LOADING || !ACTIVE || !USER) return;
  saveLocalDraft();
  setStatus("Changes pending","warn");
  clearTimeout(SAVE_TIMER);
  SAVE_TIMER=setTimeout(saveNow,1600);
}

async function saveNow(){
  if(LOADING || !ACTIVE || !USER) return;
  if(SAVING){
    SAVE_AGAIN=true;
    return;
  }

  SAVING=true;
  SAVE_AGAIN=false;
  document.querySelectorAll(".step").forEach(btn=>btn.disabled=true);
  setStatus("Saving to TourPulse…","warn");

  const res=await api.saveEod(payload());

  if(res?.ok){
    clearLocalDraft();
    if(res.sync?.queued) setStatus("EOD sync queued","good");
    else if(res.sync?.synced) setStatus("EOD synced","good");
    else setStatus("TourPulse saved","good");
  }else{
    saveLocalDraft();
    setStatus("Save error","bad");
  }

  SAVING=false;
  document.querySelectorAll(".step").forEach(btn=>btn.disabled=false);

  if(SAVE_AGAIN){
    SAVE_AGAIN=false;
    SAVE_TIMER=setTimeout(saveNow,350);
  }
}

async function signIn(){
  const emp=String($("emp").value||"").trim();
  const pin=String($("pin").value||"").trim();
  $("loginError").textContent="";

  if(!/^\d{6}$/.test(emp)){
    $("loginError").textContent="Employee ID must be exactly 6 digits.";
    return;
  }
  if(!/^\d{4}$/.test(pin)){
    $("loginError").textContent="PIN must be exactly 4 digits.";
    return;
  }

  $("signInBtn").disabled=true;
  setStatus("Verifying…","warn");

  const res=await api.signIn(emp,pin);

  if(!res?.ok){
    $("loginError").textContent=res?.error || "Sign in failed.";
    $("pin").value="";
    setStatus("Access denied","bad");
    $("signInBtn").disabled=false;
    return;
  }

  USER=res.user;
  CONFIGS=res.configs || [];
  ACTIVE=CONFIGS[0] || null;

  const site=$("siteSelect");
  site.innerHTML="";
  for(const cfg of CONFIGS){
    const opt=document.createElement("option");
    opt.value=cfg.site_key;
    opt.textContent=siteTitle(cfg.site_key);
    site.appendChild(opt);
  }
  site.disabled=CONFIGS.length===1;
  if(ACTIVE) site.value=ACTIVE.site_key;

  $("userLine").textContent=USER.first_name+" • #"+USER.emp;
  $("reportDate").value=today();
  $("loginView").classList.add("hidden");
  $("entryView").classList.remove("hidden");
  $("signInBtn").disabled=false;
  $("pin").value="";

  await loadEod();
}

async function signOut(){
  clearTimeout(SAVE_TIMER);
  await api.signOut();
  USER=null;
  CONFIGS=[];
  ACTIVE=null;
  reset();
  refresh();
  $("entryView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("emp").value="";
  $("pin").value="";
  $("loginError").textContent="";
  setStatus("Sign in required");
  $("emp").focus();
}

buildGrid();
$("reportDate").value=today();

$("grid").addEventListener("click",e=>{
  const btn=e.target.closest("[data-type]");
  if(!btn || SAVING) return;

  const type=btn.dataset.type;
  const field=btn.dataset.field;
  const delta=Number(btn.dataset.delta||0);
  if(!VALUES[type] || !["seen","booked"].includes(field) || !Number.isFinite(delta)) return;

  const current=safeInt(VALUES[type][field]);
  const next=Math.max(0,current+delta);
  if(next===current) return;

  VALUES[type][field]=next;
  refresh();
  scheduleSave();
});

$("signInBtn").addEventListener("click",signIn);
$("pin").addEventListener("keydown",e=>{ if(e.key==="Enter") signIn(); });
$("emp").addEventListener("keydown",e=>{ if(e.key==="Enter") $("pin").focus(); });
$("signOutBtn").addEventListener("click",signOut);
$("fullEodBtn").addEventListener("click",()=>api.openFullEod());

$("siteSelect").addEventListener("change",async()=>{
  ACTIVE=CONFIGS.find(c=>c.site_key===$("siteSelect").value) || CONFIGS[0] || null;
  await loadEod();
});

$("reportDate").addEventListener("change",loadEod);

setStatus("Sign in required");
$("emp").focus();
