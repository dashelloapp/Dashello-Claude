import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";

// ── DB helpers ────────────────────────────────────────────────────────────
async function loadUserData(table: string, userId: string) {
  const { data } = await supabase
    .from(table)
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.data ?? null;
}

async function saveUserData(table: string, userId: string, payload: any) {
  const { data: existing } = await supabase
    .from(table)
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from(table)
      .update({ data: payload, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } else {
    await supabase
      .from(table)
      .insert({ user_id: userId, data: payload });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type MetricColor = "green"|"yellow"|"red"|"gray";
type Page = "home"|"goals"|"tasks"|"integrations"|"team"|"settings"|"app-detail";
type GraphType = "bar-h"|"linear"|"pie"|"bar-v";
type MetricType = "counter"|"percentage"|"financial";
type RuleOp = ">="|"<="|">"|"<"|"between";

interface ColorRule {
  id: string;
  color: "red"|"yellow"|"green";
  op: RuleOp;
  value: number;
  value2?: number;
}

interface Transaction { date:string; description:string; credit?:number; debit?:number; }
interface StatRow     { label:string; value:string; synced?:boolean; }
interface ProjRow     { label:string; sub:string; value:string; }
interface NextAction  { label?:string; avatar?:string; }

interface MetricModalData {
  type:"cashflow"|"leads"|"emails"|"invoices"|"website"|"generic";
  title:string; color:MetricColor; healthPct:number|null;
  mainValue:string; syncTime:string;
  stats:StatRow[]; transactions?:Transaction[];
  projections:ProjRow[]; suggestions:string[]; nextActions:NextAction[];
  fiveAccountEnabled?:boolean;
  accountType?:"overhead"|"profit"|"tax"|"investments"|"owner";
}
interface Metric {
  id:string; label:string; value:string; icon:string; color:MetricColor; modal:MetricModalData;
  graphType?:GraphType; metricType?:MetricType;
  colorRules?:ColorRule[];
  connectedApps?:string[];
}
interface Section { id:string; title:string; avatars:string[]; metrics:Metric[]; }

// ─── Traffic light: evaluate rules against current value ───────────────────
function resolveColor(metric:Metric): MetricColor {
  if(!metric.colorRules||metric.colorRules.length===0) return "gray";
  const num = parseFloat(metric.value.replace(/[^0-9.\-]/g,""));
  if(isNaN(num)) return "gray";
  for(const rule of metric.colorRules){
    let match=false;
    if(rule.op===">="  && num>=rule.value) match=true;
    if(rule.op==="<="  && num<=rule.value) match=true;
    if(rule.op===">"   && num> rule.value) match=true;
    if(rule.op==="<"   && num< rule.value) match=true;
    if(rule.op==="between"&&rule.value2!=null&&num>=rule.value&&num<=rule.value2) match=true;
    if(match) return rule.color;
  }
  return "gray";
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS / STYLES
// ═══════════════════════════════════════════════════════════════════════════

const MS:Record<MetricColor,{bg:string;text:string;iconBg:string}> = {
  green: {bg:"#4CAF7D",text:"#fff",iconBg:"rgba(255,255,255,0.25)"},
  yellow:{bg:"#F5A623",text:"#fff",iconBg:"rgba(255,255,255,0.25)"},
  red:   {bg:"#E85D75",text:"#fff",iconBg:"rgba(255,255,255,0.25)"},
  gray:  {bg:"#E8EDF2",text:"#8A95A3",iconBg:"rgba(138,149,163,0.15)"},
};

const FIVE_DESC:Record<string,string> = {
  overhead:    "2 months of operating expenses. Everything above this flows to Profit.",
  profit:      "Builds to a 6-month emergency fund. Surplus splits 50/50 to Tax & Investments.",
  tax:         "50% of surplus Profit allocation. Set aside for taxes.",
  investments: "50% of surplus Profit allocation. Long-term growth fund.",
  owner:       "Your salary — paid from Overhead as a fixed operating expense.",
};

// ─── Icon library (scrollable categorized) ────────────────────────────────
const ICON_NONE = "";
const ICONS_ALL = [
  "💳","💰","💵","💴","💶","💷","🏦","📈","📉","📊","🪙","💎",
  "📋","📌","📎","🗂","📁","📂","🗃","🗄","📝","✅","☑","🔖",
  "👤","👥","🤝","👋","📣","📢","🎯","🏆","⭐","🥇","🎖","🏅",
  "💻","🖥","📱","⌨","🖱","🔗","⚙","🔧","🔨","🛠","🔌","💡",
  "✉","📧","📨","📩","📬","📮","☎","📞","📟","📠","💬","🗨",
  "📐","📏","🔢","🔣","🔤","🔡","🔠","📡","🛰","🔭","🔬","⚗",
  "✓","✗","⚠","🚨","🔔","🔕","❗","❓","ℹ","🔴","🟡","🟢",
  "↗","↘","↙","↖","↑","↓","←","→","↻","↺","⇄","⇅",
  "⏰","⏱","⏲","🕐","📅","📆","🗓","⌛","⏳","🔄","▶","⏩",
];

// ═══════════════════════════════════════════════════════════════════════════
// SPARKLINE
// ═══════════════════════════════════════════════════════════════════════════

const CS=[
  {color:"#4CAF7D",pts:[30,55,40,70,60,80,55,75,50,65]},
  {color:"#4C9FE8",pts:[60,40,65,35,70,45,80,40,70,35]},
  {color:"#E85D75",pts:[50,70,30,80,25,75,35,85,30,80]},
  {color:"#94a3b8",pts:[70,50,75,45,65,55,70,45,60,50]},
];
function Sparkline() {
  const W=380,H=200,p=20;
  const coord=(s:number[])=>s.map((v,i)=>[p+(i/(s.length-1))*(W-p*2),H-p-(v/100)*(H-p*2)] as [number,number]);
  const d=(pts:[number,number][])=>{
    let r=`M ${pts[0][0]} ${pts[0][1]}`;
    for(let i=1;i<pts.length;i++){const[x0,y0]=pts[i-1],[x1,y1]=pts[i],cx=(x0+x1)/2;r+=` C ${cx} ${y0},${cx} ${y1},${x1} ${y1}`;}
    return r;
  };
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:160,overflow:"visible"}}>
      {[0,1,2,3].map(i=><line key={i} x1={p} x2={W-p} y1={p+i*(H-p*2)/3} y2={p+i*(H-p*2)/3} stroke="#e2e8f0" strokeWidth={1}/>)}
      {CS.map((s,si)=>{const c=coord(s.pts);return(<g key={si}><path d={d(c)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round"/>{c.map(([x,y],pi)=><circle key={pi} cx={x} cy={y} r={3} fill={s.color}/>)}</g>);})}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL DATA
// ═══════════════════════════════════════════════════════════════════════════

function makeModal(label:string,value:string,color:MetricColor,extra?:Partial<MetricModalData>):MetricModalData {
  return{type:"generic",title:label,color,healthPct:null,mainValue:value,syncTime:"10:23AM",
    stats:[{label:"Balance",value}],projections:[{label:"Projected Value",sub:"Based on past data | Synced from 10:23AM",value}],
    suggestions:[],nextActions:[{avatar:"AJ"},{avatar:"BK"}],...extra};
}

const CASHFLOW_MODALS:Record<string,MetricModalData> = {
  overhead: makeModal("Overhead","$79,941.08","green",{type:"cashflow",healthPct:100,
    stats:[{label:"Balance",value:"$79,941.08",synced:true},{label:"Income",value:"$52,786.45",synced:true},{label:"Expenses",value:"$25,345.37",synced:true}],
    transactions:[
      {date:"March 13",description:"Web hosting",credit:197.35},
      {date:"March 6",description:"Accounting Services",credit:765.45},
      {date:"February 10",description:"New Invoice Payment",debit:25987.34},
      {date:"January 30",description:"Electric Bill",credit:5034.03},
      {date:"January 1",description:"Inventory Payment",credit:10385.68},
    ],
    projections:[
      {label:"Projected Income",sub:"Based on goals and past income | Synced from 10:23AM",value:"$47,213.55"},
      {label:"Projected Expenses To Meet",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"$24,654.63"},
      {label:"Need To Still Make This Month:",sub:"Based on goals, income, and past expenses | Synced from 10:23AM",value:"$35,058.92"},
    ],
    suggestions:["Add $9,756 to Tax account","Add $9,756 to Profit account"],
    nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}],
    fiveAccountEnabled:true,accountType:"overhead"}),
  profit: makeModal("Profit","$235,000.00","yellow",{type:"cashflow",healthPct:35,
    stats:[{label:"Balance",value:"$235,000.00",synced:true},{label:"Goal",value:"$600,000",synced:true}],
    transactions:[
      {date:"January 15",description:"Transfer Received from Overhead",debit:4950.00},
      {date:"October 15",description:"Transfer Received from Overhead",debit:16250.00},
      {date:"September 27",description:"Transfer Received from Overhead",credit:2550.00},
    ],
    projections:[{label:"Projected Complete Date",sub:"Based on goals and past income | Synced from 10:23AM",value:"March 17/25"}],
    suggestions:["Add $3,500 from Overhead"],
    nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}],
    fiveAccountEnabled:true,accountType:"profit"}),
  tax: makeModal("Tax","$23,750.00","gray",{type:"cashflow",healthPct:null,title:"Taxes",
    stats:[{label:"Balance",value:"$23,750.00",synced:true}],
    transactions:[
      {date:"January 30",description:"Tax Bill",credit:5000.00},
      {date:"January 15",description:"Transfer Received from Overhead",debit:4950.00},
      {date:"October 30",description:"Tax Bill",credit:5000.00},
      {date:"October 15",description:"Transfer from Overhead",credit:47.69,debit:16250.00},
    ],
    projections:[
      {label:"Next Tax Payment Estimated",sub:"Based on goals and past income | Synced from 10:23AM",value:"$0"},
      {label:"Amount Still Needed For Next Payment",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"$5,000"},
      {label:"Next Tax Payment Date",sub:"Based on goals, income, and past expenses | Synced from 10:23AM",value:"April 30th"},
    ],
    suggestions:[],nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}],
    fiveAccountEnabled:true,accountType:"tax"}),
  investments: makeModal("Investments","$0.00","gray",{type:"cashflow",healthPct:null,title:"Invest",
    stats:[{label:"Balance",value:"$0.00",synced:true},{label:"Goals",value:"Fully Fund Profit First",synced:true},{label:"Funding Start Date",value:"March 17, 2025",synced:true}],
    transactions:[],
    projections:[
      {label:"Amount Still Needed For Next Payment",sub:"Based on goals and past income | Synced from 10:23AM",value:"$0"},
      {label:"Next Tax Payment Estimated",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"$0"},
      {label:"Next Tax Payment Date",sub:"Based on goals, income, and past expenses | Synced from 10:23AM",value:"..."},
    ],
    suggestions:[],nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}],
    fiveAccountEnabled:true,accountType:"investments"}),
  owner: makeModal("Owner","$7,500","green",{type:"cashflow",healthPct:100,
    stats:[{label:"Balance",value:"$7,500",synced:true}],
    transactions:[],projections:[],suggestions:[],nextActions:[],
    fiveAccountEnabled:true,accountType:"owner"}),
};

const SALES_MODALS:Record<string,MetricModalData> = {
  leads: makeModal("Leads","12","red",{type:"leads",healthPct:25,
    stats:[{label:"Amount",value:"12"},{label:"Leads Moved",value:"5"},{label:"Conversions",value:"24%"},{label:"Leads Closed",value:"13"},{label:"Leads Opened",value:"7"},{label:"Goal",value:"50 / Month"}],
    projections:[
      {label:"Projected Sales ✦",sub:"Based on goals and past income | Synced from 10:23AM",value:"$45K"},
      {label:"Projected New Leads ✦",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"569"},
    ],
    suggestions:[],
    nextActions:[{label:"Close 5 more calls",avatar:"AJ"},{label:"Send 34 quotes",avatar:"BK"},{avatar:"CL"},{avatar:"DM"}]}),
  emails: makeModal("Emails Opened","789","green",{type:"emails",healthPct:100,
    stats:[{label:"Bounce Rate",value:"3%",synced:true},{label:"Open Rate",value:"26%",synced:true},{label:"Click-through Rate",value:"4.5%",synced:true},{label:"Total Emails Sent",value:"3,034",synced:true}],
    projections:[
      {label:"Open Rate",sub:"Based on goals and past income | Synced from 10:23AM",value:"26%"},
      {label:"Click-through Rate",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"Increase"},
      {label:"Bounce Rate",sub:"Based on goals, income, and past expenses | Synced from 10:23AM",value:"3%"},
    ],
    suggestions:[],nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}]}),
  invoices: makeModal("Invoices In Progress","$10,050.76","gray",{type:"invoices",healthPct:null,
    stats:[{label:"Total Invoices",value:"37",synced:true},{label:"Conversion Rate",value:"78%",synced:true},{label:"Average Order Value",value:"$270",synced:true}],
    projections:[
      {label:"Projected Funds",sub:"Based on goals and past income | Synced from 10:23AM",value:"$34,000"},
      {label:"Invoices Need Sending",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"45"},
    ],
    suggestions:["Send 13 invoices"],nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}]}),
  website: makeModal("Website Engagement","67%","green",{type:"website",healthPct:80,
    stats:[{label:"Site Sessions",value:"7,987",synced:true},{label:"Ave Session Duration",value:"23 seconds",synced:true},{label:"Unique Visitors",value:"57.6K",synced:true},{label:"Clicks to Contact",value:"356",synced:true},{label:"Bounce Rate",value:"37%",synced:true}],
    projections:[
      {label:"Clicks Next Month",sub:"Based on goals and past income | Synced from 10:23AM",value:"356"},
      {label:"Conversion Rate Next Month",sub:"Based on goals and past expenses | Synced from 10:23AM",value:"Increase"},
      {label:"Projected Visitors Next Month",sub:"Based on goals, income, and past expenses | Synced from 10:23AM",value:"57.6K"},
    ],
    suggestions:[],nextActions:[{avatar:"AJ"},{avatar:"BK"},{avatar:"CL"},{}]}),
};

const INIT_SECTIONS: Section[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function Av({initials,size=30}:{initials?:string;size?:number}) {
  const colors=["#4C9FE8","#7B68EE","#48C78E","#F5A623","#E85D75"];
  return(
    <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,
      background:initials?colors[initials.charCodeAt(0)%5]:"#e2e8f0",
      display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.36,fontWeight:600,color:"#fff"}}>
      {initials??""}
    </div>
  );
}

function Toggle({on,onChange}:{on:boolean;onChange:(v:boolean)=>void}) {
  return(
    <div onClick={()=>onChange(!on)} style={{width:44,height:24,borderRadius:99,cursor:"pointer",
      background:on?"#4CAF7D":"#e2e8f0",position:"relative",transition:"background 0.2s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:on?22:3,width:18,height:18,borderRadius:"50%",
        background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.2)",transition:"left 0.2s"}}/>
    </div>
  );
}

function SectionCard({title,children}:{title?:string;children:React.ReactNode}) {
  return(
    <div style={{background:"#F8FAFC",borderRadius:16,padding:20,display:"flex",flexDirection:"column"}}>
      {title&&<div style={{fontSize:20,fontWeight:700,color:"#1a2332",marginBottom:16}}>{title}</div>}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION TABLE
// ═══════════════════════════════════════════════════════════════════════════

function TxnTable({transactions}:{transactions:Transaction[]}) {
  const fmt=(n?:number)=>n!=null?n.toLocaleString("en-US",{minimumFractionDigits:2}):"";
  const th:React.CSSProperties={fontSize:12,color:"#94a3b8",padding:"6px 8px",textAlign:"left",fontWeight:500,borderBottom:"1px solid #f1f5f9"};
  const td:React.CSSProperties={fontSize:12,color:"#475569",padding:"6px 8px",borderBottom:"1px solid #f8fafc"};
  return(
    <div style={{background:"#fff",borderRadius:"0 0 12px 12px",border:"1px solid #e2e8f0",borderTop:"none"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>
          <th style={{...th,width:"50%"}}>Transactions</th>
          <th style={{...th,textAlign:"right"}}>Credit</th>
          <th style={{...th,textAlign:"right"}}>Debit</th>
          <th style={{...th,textAlign:"right"}}>Balance</th>
        </tr></thead>
        <tbody>
          {transactions.length===0
            ?<tr><td colSpan={4} style={{...td,color:"#cbd5e1",textAlign:"center",padding:16}}>No transactions yet</td></tr>
            :transactions.map((t,i)=><tr key={i}>
              <td style={td}>{t.date} – {t.description}</td>
              <td style={{...td,textAlign:"right"}}>{fmt(t.credit)}</td>
              <td style={{...td,textAlign:"right"}}>{fmt(t.debit)}</td>
              <td style={{...td,textAlign:"right",color:"#94a3b8"}}>$xxx,xxx.xx</td>
            </tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function MetricModal({data,onClose,onEdit}:{data:MetricModalData;onClose:()=>void;onEdit?:()=>void}) {
  const overlayRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[onClose]);

  const accent=MS[data.color].bg;
  const isCash=data.type==="cashflow";
  const isLeads=data.type==="leads";

  const HealthRow=()=>(
    <div style={{marginBottom:20}}>
      {data.healthPct!=null?(
        <><div style={{fontSize:14,fontWeight:600,color:"#1a2332",marginBottom:7}}>Health — <strong>{data.healthPct}%</strong></div>
        <div style={{height:32,borderRadius:99,background:"#e5e7eb",maxWidth:260,overflow:"hidden"}}>
          <div style={{width:`${data.healthPct}%`,height:"100%",borderRadius:99,background:accent}}/></div></>
      ):(
        <><div style={{fontSize:14,fontWeight:600,color:"#1a2332",marginBottom:8}}>Health — <strong>N/A</strong></div>
        <button style={{padding:"8px 22px",borderRadius:99,border:"1.5px solid #d1d5db",background:"#fff",fontSize:13,cursor:"pointer",fontWeight:600}}>Set A Goal</button></>
      )}
    </div>
  );

  const BottomCards=()=>(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16}}>
      <SectionCard title="Projections">
        {data.projections.map((p,i)=><div key={i} style={{marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1a2332"}}>{p.label}</div>
          <div style={{fontSize:11,color:"#94a3b8",marginBottom:3}}>{p.sub}</div>
          <div style={{fontSize:16,fontWeight:700,color:"#1a2332"}}>{p.value}</div>
        </div>)}
        {data.projections.length===0&&<div style={{fontSize:13,color:"#cbd5e1"}}>No projections yet</div>}
        <a href="#" style={{fontSize:13,color:"#3B82F6",marginTop:"auto",display:"block"}}>View All</a>
      </SectionCard>
      <SectionCard>
        <div style={{display:"inline-block",background:"#3B82F6",color:"#fff",borderRadius:99,padding:"6px 18px",fontSize:13,fontWeight:600,marginBottom:16}}>Suggestions</div>
        {([...data.suggestions,"",""].slice(0,3)).map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:22,height:22,borderRadius:"50%",border:"1.5px solid #d1d5db",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"#94a3b8"}}>+</div>
            {s?<span style={{fontSize:13,color:"#1a2332"}}>{s}</span>:<div style={{flex:1,height:7,borderRadius:99,background:"#e2e8f0"}}/>}
          </div>
        ))}
        <a href="#" style={{fontSize:13,color:"#3B82F6",marginTop:"auto",display:"block"}}>View All</a>
      </SectionCard>
      <SectionCard>
        <div style={{display:"inline-block",background:"#3B82F6",color:"#fff",borderRadius:99,padding:"6px 18px",fontSize:13,fontWeight:600,marginBottom:16}}>Next Actions</div>
        {data.nextActions.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:20,height:20,borderRadius:"50%",border:"1.5px solid #4CAF7D",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#4CAF7D"}}>✓</div>
            {a.label?<span style={{fontSize:13,color:"#1a2332",flex:1}}>{a.label}</span>:<div style={{flex:1,height:7,borderRadius:99,background:"#e2e8f0"}}/>}
            <Av initials={a.avatar}/>
          </div>
        ))}
        {data.nextActions.length===0&&<div style={{fontSize:13,color:"#cbd5e1"}}>No actions yet</div>}
        <a href="#" style={{fontSize:13,color:"#3B82F6",marginTop:"auto",display:"block"}}>View All</a>
      </SectionCard>
    </div>
  );

  return(
    <div ref={overlayRef} onClick={e=>{if(e.target===overlayRef.current)onClose();}} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}}>
      <div style={{background:"#fff",borderRadius:24,width:"100%",maxWidth:900,maxHeight:"92vh",overflowY:"auto",
        padding:"36px 36px 32px",position:"relative",boxShadow:"0 32px 80px rgba(0,0,0,0.2)",animation:"mIn 0.18s ease"}}>
        <style>{`@keyframes mIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}
        @media(max-width:600px){.modal-inner{padding:20px 16px 20px!important}}`}</style>
        <button onClick={onClose} style={{position:"absolute",top:18,right:22,background:"none",border:"none",fontSize:28,cursor:"pointer",color:"#1a2332",lineHeight:1}}>×</button>

        {isLeads?<>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28,flexWrap:"wrap",gap:10}}>
            <button style={{background:"#3B82F6",color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:14,fontWeight:600,cursor:"pointer"}}>Full Page</button>
            <h2 style={{margin:0,fontSize:28,fontWeight:700,color:"#1a2332"}}>{data.title}</h2>
            <button onClick={onEdit} style={{background:"#9CA3AF",color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:14,fontWeight:600,cursor:"pointer"}}>Edit Settings</button>
          </div>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{width:72,height:72,borderRadius:"50%",border:"2px solid #1a2332",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:30}}>💳</div>
          </div>
          <div style={{maxWidth:380,margin:"0 auto 8px"}}>
            <div style={{height:46,borderRadius:99,background:"#e5e7eb",overflow:"hidden"}}>
              <div style={{width:`${data.healthPct??25}%`,height:"100%",borderRadius:99,background:"linear-gradient(90deg,#E85D75,#F472B6)"}}/>
            </div>
          </div>
          <p style={{textAlign:"center",fontSize:14,marginBottom:28,color:"#1a2332"}}>Health Goal — <strong>{data.healthPct??25}%</strong></p>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:32,marginBottom:8}}>
            <button style={{width:42,height:42,borderRadius:"50%",border:"1.5px solid #d1d5db",background:"none",fontSize:22,cursor:"pointer",color:"#6b7280"}}>−</button>
            <span style={{fontSize:80,fontWeight:700,color:"#1a2332",lineHeight:1}}>{data.mainValue}</span>
            <button style={{width:42,height:42,borderRadius:"50%",border:"1.5px solid #d1d5db",background:"none",fontSize:22,cursor:"pointer",color:"#6b7280"}}>+</button>
          </div>
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{height:2,background:"#1a2332",width:240,margin:"0 auto 6px"}}/>
            <span style={{fontSize:13,fontStyle:"italic",color:"#6b7280"}}>Synced from {data.syncTime}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:16}}>
            <SectionCard>
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:14}}>
                <span style={{fontSize:18,fontWeight:700,color:"#1a2332"}}>Details</span>
                <span style={{fontSize:11,color:"#94a3b8"}}>Synced from {data.syncTime}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 14px",flex:1}}>
                {data.stats.map((s,i)=><div key={i}>
                  <div style={{fontSize:12,color:"#94a3b8"}}>{s.label}</div>
                  <div style={{fontSize:15,fontWeight:700,color:"#1a2332"}}>{s.value}</div>
                </div>)}
              </div>
              <a href="#" style={{fontSize:13,color:"#3B82F6",marginTop:14,display:"block"}}>View All</a>
            </SectionCard>
            <SectionCard title="Projections">
              {data.projections.map((p,i)=><div key={i} style={{marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:600,color:"#1a2332"}}>{p.label}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginBottom:3}}>{p.sub}</div>
                <div style={{fontSize:17,fontWeight:700,color:"#1a2332"}}>{p.value}</div>
              </div>)}
              <a href="#" style={{fontSize:13,color:"#3B82F6",marginTop:"auto",display:"block"}}>View All</a>
            </SectionCard>
            <SectionCard title="Next Actions">
              {data.nextActions.map((a,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{width:22,height:22,borderRadius:"50%",border:"1.5px solid #d1d5db",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#94a3b8",flexShrink:0}}>⊕</div>
                {a.label?<span style={{fontSize:13,color:"#1a2332",flex:1}}>{a.label}</span>:<div style={{flex:1,height:7,borderRadius:99,background:"#e2e8f0"}}/>}
                {a.avatar&&<Av initials={a.avatar}/>}
              </div>)}
              <a href="#" style={{fontSize:13,color:"#3B82F6",marginTop:"auto",display:"block"}}>View All</a>
            </SectionCard>
          </div>

        </>:isCash?<>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:6,flexWrap:"wrap"}}>
            <h2 style={{margin:0,fontSize:30,fontWeight:700,color:"#1a2332"}}>{data.title}</h2>
            <button onClick={onEdit} style={{padding:"4px 14px",borderRadius:20,border:"1px solid #d1d5db",background:"none",fontSize:13,cursor:"pointer",color:"#1a2332"}}>Edit</button>
          </div>
          {data.fiveAccountEnabled&&data.accountType&&(
            <div style={{background:"linear-gradient(135deg,#EEF9F4,#E8F4FD)",border:"1px solid #c3e6d4",borderRadius:12,padding:"12px 16px",marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#0F6E56",marginBottom:4}}>Five-Account System — {data.accountType}</div>
              <p style={{margin:0,fontSize:12,color:"#1e6b4e"}}>{FIVE_DESC[data.accountType]}</p>
            </div>
          )}
          <HealthRow/>
          <div style={{marginBottom:24}}>
            <div style={{background:accent,borderRadius:"12px 12px 0 0",padding:"20px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  {data.stats.map((s,i)=><div key={i} style={{marginBottom:i<data.stats.length-1?12:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:13,color:"rgba(255,255,255,0.82)"}}>{s.label}</span>
                      {s.synced&&<span style={{fontSize:10,color:"rgba(255,255,255,0.5)"}}>Synced from {data.syncTime}</span>}
                    </div>
                    <div style={{fontSize:i===0?22:18,fontWeight:700,color:"#fff"}}>{s.value}</div>
                  </div>)}
                </div>
                <button style={{background:"#fff",border:"none",borderRadius:20,padding:"6px 18px",fontSize:13,cursor:"pointer",fontWeight:600,flexShrink:0,marginLeft:16}}>Filter</button>
              </div>
            </div>
            <TxnTable transactions={data.transactions??[]}/>
          </div>
          <BottomCards/>

        </>:<>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:6,flexWrap:"wrap"}}>
            <h2 style={{margin:0,fontSize:30,fontWeight:700,color:"#1a2332"}}>{data.title}</h2>
            <button onClick={onEdit} style={{padding:"4px 14px",borderRadius:20,border:"1px solid #d1d5db",background:"none",fontSize:13,cursor:"pointer",color:"#1a2332"}}>Edit</button>
          </div>
          <HealthRow/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:24,marginBottom:26}}>
            <div style={{background:accent,borderRadius:16,padding:"20px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
                <div><div style={{fontSize:12,color:"rgba(255,255,255,0.8)"}}>Amount</div><div style={{fontSize:10,color:"rgba(255,255,255,0.55)"}}>Synced from {data.syncTime}</div></div>
                <button style={{background:"#fff",border:"none",borderRadius:20,padding:"4px 14px",fontSize:12,cursor:"pointer",fontWeight:600}}>Filter</button>
              </div>
              <div style={{fontSize:22,fontWeight:700,color:"#fff",marginBottom:14}}>{data.mainValue}</div>
              {data.stats.map((s,i)=><div key={i} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,color:"rgba(255,255,255,0.82)"}}>{s.label}</span>
                  {s.synced&&<span style={{fontSize:10,color:"rgba(255,255,255,0.5)"}}>Synced from {data.syncTime}</span>}
                </div>
                <div style={{fontSize:16,fontWeight:700,color:"#fff"}}>{s.value}</div>
              </div>)}
            </div>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:"#1a2332",marginBottom:10}}>Manually Adjust Metric</div>
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
                <button style={{width:32,height:32,borderRadius:"50%",border:"1.5px solid #d1d5db",background:"none",fontSize:18,cursor:"pointer",color:"#9CA3AF"}}>−</button>
                <div><div style={{fontSize:32,fontWeight:700,color:"#1a2332",lineHeight:1}}>{data.mainValue}</div>
                  <div style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>Synced from {data.syncTime}</div></div>
                <button style={{width:32,height:32,borderRadius:"50%",border:"1.5px solid #d1d5db",background:"none",fontSize:18,cursor:"pointer",color:"#9CA3AF"}}>+</button>
              </div>
              <div style={{border:"1px solid #e2e8f0",borderRadius:12,padding:"6px 10px"}}><Sparkline/></div>
            </div>
          </div>
          <BottomCards/>
        </>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD COLOR RULE MODAL
// ═══════════════════════════════════════════════════════════════════════════

function AddColorRuleModal({onSave,onClose,existing}:{
  onSave:(rule:ColorRule)=>void; onClose:()=>void; existing?:ColorRule;
}) {
  const [color,setColor]=useState<"red"|"yellow"|"green">(existing?.color??"red");
  const [op,setOp]=useState<RuleOp>(existing?.op??">=");
  const [val,setVal]=useState(existing?.value?.toString()??"");
  const [val2,setVal2]=useState(existing?.value2?.toString()??"");

  const opLabels:RuleOp[]=[">=","<=",">","<","between"];
  const opDisplay:Record<RuleOp,string>={">=":"≥ (greater than or equal)","<=":"≤ (less than or equal)",">":"> (greater than)","<":"< (less than)","between":"between (range)"};

  const save=()=>{
    const n=parseFloat(val);if(isNaN(n))return;
    onSave({id:existing?.id??crypto.randomUUID(),color,op,value:n,value2:op==="between"?parseFloat(val2):undefined});
    onClose();
  };

  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:4000,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,padding:"28px 28px 24px",width:"100%",maxWidth:700,boxShadow:"0 24px 64px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <h3 style={{margin:0,fontSize:20,fontWeight:700,color:"#1a2332"}}>Add Color Rule</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>×</button>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a2332",marginBottom:12}}>1. Select Metric</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:13,color:"#64748b",width:90,flexShrink:0}}>If Metric is</span>
              <select value={op} onChange={e=>setOp(e.target.value as RuleOp)}
                style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:13,outline:"none",background:"#fff",cursor:"pointer"}}>
                {opLabels.map(o=><option key={o} value={o}>{opDisplay[o]}</option>)}
              </select>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:13,color:"#64748b",width:90,flexShrink:0}}>Value</span>
              <input value={val} onChange={e=>setVal(e.target.value)} placeholder="Enter number"
                style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:14,outline:"none"}}/>
              {op==="between"&&<>
                <span style={{fontSize:13,color:"#94a3b8",flexShrink:0}}>and</span>
                <input value={val2} onChange={e=>setVal2(e.target.value)} placeholder="Max"
                  style={{flex:1,padding:"8px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:14,outline:"none"}}/>
              </>}
            </div>
          </div>
        </div>

        <div style={{marginBottom:28}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a2332",marginBottom:12}}>2. Select Color</div>
          <div style={{display:"flex",gap:20}}>
            {(["red","yellow","green"] as const).map(c=>(
              <label key={c} onClick={()=>setColor(c)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",
                padding:"10px 16px",borderRadius:10,border:`2px solid ${color===c?MS[c].bg:"#e2e8f0"}`,
                background:color===c?MS[c].bg+"18":"#fff",transition:"all 0.15s",flex:1,justifyContent:"center"}}>
                <span style={{width:14,height:14,borderRadius:"50%",background:MS[c].bg,display:"inline-block",flexShrink:0}}/>
                <span style={{fontSize:13,fontWeight:600,color:color===c?MS[c].bg:"#64748b",textTransform:"capitalize"}}>{c}</span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={save} style={{width:"100%",padding:"12px 0",borderRadius:8,border:"none",
          background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
          Save Rule
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BOX SETTINGS MODAL  (create new OR edit existing)
// ═══════════════════════════════════════════════════════════════════════════

function MetricBoxSettingsModal({initial,onSave,onDelete,onClose}:{
  initial?:Metric; onSave:(m:Omit<Metric,"id">)=>void; onDelete?:()=>void; onClose:()=>void;
}) {
  const [label,      setLabel]      =useState(initial?.label??"");
  const [value,      setValue]      =useState(initial?.value??"");
  const [icon,       setIcon]       =useState(initial?.icon??ICON_NONE);
  const [graphType,  setGraphType]  =useState<GraphType>(initial?.graphType??"linear");
  const [metricType, setMetricType] =useState<MetricType>(initial?.metricType??"counter");
  const [fiveOn,     setFiveOn]     =useState(initial?.modal?.fiveAccountEnabled??false);
  const [rules,      setRules]      =useState<ColorRule[]>(initial?.colorRules??[]);
  const [showRuleModal,setShowRuleModal]=useState(false);
  const [editingRule,  setEditingRule]  =useState<ColorRule|undefined>();

  const graphTypes:[GraphType,string][]=[["bar-h","Bar Horizontal"],["linear","Linear"],["pie","Pie Chart"],["bar-v","Bar Vertical"]];
  const metricTypes:[MetricType,string][]=[["counter","Counter"],["percentage","Percentage"],["financial","Financial"]];

  const Radio=({checked,onChange,label:rl}:{checked:boolean;onChange:()=>void;label:string})=>(
    <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:"#1a2332",marginBottom:5}}>
      <input type="radio" checked={checked} onChange={onChange} style={{accentColor:"#3B82F6",margin:0}}/>{rl}
    </label>
  );

  const SectionLabel=({children}:{children:string})=>(
    <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>{children}</div>
  );

  const openAddRule=()=>{setEditingRule(undefined);setShowRuleModal(true);};
  const openEditRule=(r:ColorRule)=>{setEditingRule(r);setShowRuleModal(true);};
  const saveRule=(r:ColorRule)=>setRules(prev=>{const i=prev.findIndex(x=>x.id===r.id);if(i>=0){const a=[...prev];a[i]=r;return a;}return[...prev,r];});
  const removeRule=(id:string)=>setRules(prev=>prev.filter(r=>r.id!==id));
  const ruleDesc=(r:ColorRule)=>r.op==="between"?`If Metric is between ${r.value}–${r.value2}`:`If Metric is ${r.op} ${r.value}`;

  const handleSave=()=>{
    if(!label.trim())return;
    const baseColor:MetricColor="gray";
    const m=makeModal(label,value||"0",baseColor,{fiveAccountEnabled:fiveOn,type:fiveOn?"cashflow":"generic"});
    onSave({label,value:value||"0",icon,color:baseColor,modal:m,graphType,metricType,colorRules:rules,connectedApps:initial?.connectedApps??[]});
    onClose();
  };

  return(
    <>
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:700,maxHeight:"92vh",overflowY:"auto",
        boxShadow:"0 24px 64px rgba(0,0,0,0.2)",animation:"mIn 0.15s ease"}}>
        <style>{`@keyframes mIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>

        {/* Header */}
        <div style={{padding:"22px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Metric Box Title"
            style={{fontSize:18,fontWeight:700,border:"none",outline:"none",color:"#1a2332",background:"transparent",flex:1,minWidth:0}}/>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,cursor:"pointer",color:"#94a3b8",padding:"0 0 0 12px",flexShrink:0}}>×</button>
        </div>

        <div style={{padding:"8px 24px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:24}}>

            {/* ── LEFT COLUMN ── */}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <SectionLabel>Select Metric Type</SectionLabel>
                {metricTypes.map(([t,l])=><Radio key={t} checked={metricType===t} onChange={()=>setMetricType(t)} label={l}/>)}
              </div>
              <div>
                <SectionLabel>Current Value</SectionLabel>
                <input value={value} onChange={e=>setValue(e.target.value)} placeholder="e.g. 75 or $12,000"
                  style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
              </div>
              <div>
                <SectionLabel>Connected Apps</SectionLabel>
                {(initial?.connectedApps??[]).length===0
                  ?<div style={{fontSize:12,color:"#cbd5e1",fontStyle:"italic"}}>No apps connected yet</div>
                  :(initial?.connectedApps??[]).map((a,i)=>(
                    <span key={i} style={{display:"inline-block",background:"#EFF6FF",borderRadius:8,padding:"4px 10px",fontSize:12,color:"#3B82F6",marginRight:6,marginBottom:4}}>{a}</span>
                  ))
                }
              </div>
              <div style={{background:"#F0FDF4",border:"1px solid #c3e6d4",borderRadius:10,padding:"10px 14px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:fiveOn?8:0}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"#1a2332"}}>Five-Account System</div>
                    <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Profit First budgeting method</div>
                  </div>
                  <Toggle on={fiveOn} onChange={setFiveOn}/>
                </div>
                {fiveOn&&<div style={{fontSize:11,color:"#0F6E56",background:"#dcfce7",borderRadius:6,padding:"6px 10px"}}>
                  ✓ Box will display bank transactions and 5-account math.</div>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <button style={{padding:"9px 0",borderRadius:8,border:"none",background:"#64748b",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  Create Equation
                </button>
                <button onClick={openAddRule} style={{padding:"9px 0",borderRadius:8,border:"none",background:"#64748b",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  Create Color Rule
                </button>
              </div>
              {rules.length>0&&(
                <div>
                  <SectionLabel>Active Color Rules</SectionLabel>
                  {rules.map(r=>(
                    <div key={r.id} style={{background:"#F8FAFC",borderRadius:10,padding:"8px 12px",marginBottom:7,border:"1px solid #e2e8f0"}}>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                            <span style={{width:10,height:10,borderRadius:"50%",background:MS[r.color].bg,flexShrink:0,display:"inline-block"}}/>
                            <span style={{fontSize:12,fontWeight:600,color:"#1a2332",textTransform:"capitalize"}}>{r.color}</span>
                          </div>
                          <div style={{fontSize:11,color:"#64748b"}}>{ruleDesc(r)} → color = {r.color}</div>
                        </div>
                        <div style={{display:"flex",gap:6,marginLeft:8}}>
                          <button onClick={()=>openEditRule(r)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#3B82F6",padding:0}}>Edit</button>
                          <button onClick={()=>removeRule(r.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#E85D75",padding:0}}>✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── RIGHT COLUMN ── */}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <SectionLabel>Select Icon</SectionLabel>
                <div style={{marginBottom:6}}>
                  <div onClick={()=>setIcon(ICON_NONE)} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:6,cursor:"pointer",
                    background:icon===ICON_NONE?"#EFF6FF":"#F8FAFC",border:icon===ICON_NONE?"1.5px solid #3B82F6":"1.5px solid #e2e8f0",fontSize:12,color:"#64748b"}}>
                    No icon
                  </div>
                </div>
                <div style={{height:108,overflowY:"auto",border:"1px solid #e2e8f0",borderRadius:10,padding:"4px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:3}}>
                    {ICONS_ALL.map(ic=>(
                      <div key={ic} onClick={()=>setIcon(ic)} style={{width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:15,cursor:"pointer",background:icon===ic?"#EFF6FF":"transparent",
                        border:icon===ic?"1.5px solid #3B82F6":"1.5px solid transparent",transition:"background 0.1s",flexShrink:0}}>
                        {ic}
                      </div>
                    ))}
                  </div>
                </div>
                {icon&&icon!==ICON_NONE&&(
                  <div style={{marginTop:6,fontSize:12,color:"#64748b"}}>Selected: <span style={{fontSize:16}}>{icon}</span></div>
                )}
              </div>
              <div>
                <SectionLabel>Select Graph Type</SectionLabel>
                {graphTypes.map(([g,l])=><Radio key={g} checked={graphType===g} onChange={()=>setGraphType(g)} label={l}/>)}
              </div>
            </div>
          </div>

          <button onClick={handleSave} style={{width:"100%",padding:"13px 0",borderRadius:8,border:"none",marginTop:24,
            background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
            Save
          </button>

          {(initial||onDelete)&&(
            <button onClick={()=>{if(window.confirm("Delete this metric box?")&&onDelete){onDelete();onClose();}}}
              style={{width:"100%",padding:"10px 0",borderRadius:8,border:"1.5px solid #fecaca",background:"transparent",
                color:"#E85D75",fontSize:13,fontWeight:500,cursor:"pointer",marginTop:8}}>
              Delete Metric Box
            </button>
          )}
        </div>
      </div>
    </div>
    {showRuleModal&&<AddColorRuleModal existing={editingRule} onSave={saveRule} onClose={()=>setShowRuleModal(false)}/>}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT/ADD ROW MODAL
// ═══════════════════════════════════════════════════════════════════════════

function EditAddRowModal({initial,onSave,onClose}:{initial?:string;onSave:(name:string)=>void;onClose:()=>void}) {
  const [name,setName]=useState(initial??"");
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,padding:"28px 28px 24px",width:"90%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,0.18)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <h3 style={{margin:0,fontSize:18,fontWeight:700,color:"#1a2332"}}>Edit/Add Row</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>×</button>
        </div>
        <label style={{fontSize:13,color:"#64748b",display:"block",marginBottom:6}}>Label</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Row Name"
          style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:14,outline:"none",boxSizing:"border-box",marginBottom:24}}/>
        <button onClick={()=>{if(name.trim()){onSave(name.trim());onClose();}}}
          style={{width:"100%",padding:"11px 0",borderRadius:8,border:"none",
            background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
          Save
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADD TEAM MODAL
// ═══════════════════════════════════════════════════════════════════════════

function AddTeamModal({onClose}:{onClose:()=>void}) {
  const [members,setMembers]=useState([{email:"",access:"View"}]);
  const addRow=()=>setMembers(p=>[...p,{email:"",access:"View"}]);
  const update=(i:number,field:"email"|"access",val:string)=>setMembers(p=>p.map((m,j)=>j===i?{...m,[field]:val}:m));
  const accessLevels=["View","Edit","Admin"];
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,padding:"32px",width:"100%",maxWidth:480,boxShadow:"0 24px 64px rgba(0,0,0,0.18)"}}>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>×</button>
        </div>
        <h2 style={{margin:"0 0 8px",fontSize:22,fontWeight:700,color:"#1a2332",textAlign:"center"}}>Add your team</h2>
        <p style={{margin:"0 0 24px",fontSize:13,color:"#94a3b8",textAlign:"center",lineHeight:1.5}}>
          You can set permission levels for each team member, and give access to different metrics to only the people that need to see them.
        </p>
        {members.map((m,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:12,marginBottom:12,alignItems:"center"}}>
            <input value={m.email} onChange={e=>update(i,"email",e.target.value)} placeholder="Email"
              style={{padding:"9px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:13,outline:"none"}}/>
            <div>
              <div style={{fontSize:11,color:"#94a3b8",marginBottom:2}}>Level Access</div>
              <select value={m.access} onChange={e=>update(i,"access",e.target.value)}
                style={{padding:"7px 10px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:13,outline:"none",background:"#fff",cursor:"pointer"}}>
                {accessLevels.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button onClick={addRow} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#3B82F6",padding:"4px 0",marginBottom:20,display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:18,lineHeight:1}}>+</span> Add more
        </button>
        <button onClick={onClose} style={{width:"100%",padding:"12px 0",borderRadius:8,border:"none",
          background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
          Add
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC BLOCK
// ═══════════════════════════════════════════════════════════════════════════

function MetricBlock({metric,onRemove,onClick,onEdit,onDragStart,onDragOver,onDrop,isDragOver}:{
  metric:Metric;onRemove:()=>void;onClick:()=>void;onEdit:()=>void;
  onDragStart:()=>void;onDragOver:(e:React.DragEvent)=>void;onDrop:()=>void;isDragOver:boolean;
}) {
  const activeColor = resolveColor(metric);
  const s=MS[activeColor];
  const [hov,setHov]=useState(false);
  const hasIcon = metric.icon && metric.icon !== ICON_NONE;
  return(
    <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={e=>{e.preventDefault();onDrop();}}
      onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{width:140,minHeight:140,borderRadius:16,background:s.bg,padding:"16px 14px",
        display:"flex",flexDirection:"column",justifyContent:"space-between",cursor:"grab",position:"relative",flexShrink:0,
        transform:hov?"translateY(-3px)":"none",transition:"transform 0.15s,box-shadow 0.15s",
        boxShadow:hov?"0 10px 28px rgba(0,0,0,0.15)":"0 2px 8px rgba(0,0,0,0.06)",
        outline:isDragOver?"3px dashed rgba(59,130,246,0.6)":"3px solid transparent"}}>
      <div style={{fontSize:12,fontWeight:600,color:s.text,lineHeight:1.3}}>{metric.label}</div>
      {hasIcon&&(
        <div style={{width:44,height:44,borderRadius:"50%",background:s.iconBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,margin:"8px 0",alignSelf:"flex-start"}}>
          <span style={{color:s.text}}>{metric.icon}</span>
        </div>
      )}
      <div style={{fontSize:15,fontWeight:700,color:s.text,marginTop:hasIcon?0:"auto"}}>{metric.value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROW CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════

function RowMenu({onRename,onDelete,onClose}:{onRename:()=>void;onDelete:()=>void;onClose:()=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))onClose();};
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[onClose]);
  return(
    <div ref={ref} style={{position:"absolute",top:36,right:0,background:"#fff",borderRadius:10,
      boxShadow:"0 8px 24px rgba(0,0,0,0.12)",border:"1px solid #e2e8f0",zIndex:100,minWidth:150,overflow:"hidden"}}>
      {[{label:"✏️  Rename row",action:onRename},{label:"🗑️  Delete row",action:onDelete}].map(item=>(
        <div key={item.label} onClick={()=>{item.action();onClose();}} style={{padding:"10px 16px",fontSize:13,cursor:"pointer",color:"#1a2332"}}
          onMouseEnter={e=>(e.currentTarget.style.background="#f8fafc")}
          onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>{item.label}</div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SECTION
// ═══════════════════════════════════════════════════════════════════════════

function DashSection({section,onAddMetric,onRemoveMetric,onUpdateMetric,onRenameSection,onRemoveSection,onClickMetric,
  onMetricDragStart,onMetricDrop,dragOverMetric,onSectionDragStart,onSectionDragOver,onSectionDrop,isSectionDragOver}:{
  section:Section;onAddMetric:(sid:string,m:Omit<Metric,"id">)=>void;
  onRemoveMetric:(sid:string,mid:string)=>void;
  onUpdateMetric:(sid:string,mid:string,m:Omit<Metric,"id">)=>void;
  onRenameSection:(sid:string,name:string)=>void;
  onRemoveSection:(sid:string)=>void;onClickMetric:(m:MetricModalData)=>void;
  onMetricDragStart:(sid:string,mid:string)=>void;onMetricDrop:(tsid:string,tmid:string)=>void;
  dragOverMetric:string|null;onSectionDragStart:()=>void;onSectionDragOver:(e:React.DragEvent)=>void;
  onSectionDrop:()=>void;isSectionDragOver:boolean;
}) {
  const [showAdd,setShowAdd]=useState(false);
  const [editingMetric,setEditingMetric]=useState<Metric|null>(null);
  const [showRowModal,setShowRowModal]=useState(false);
  const [showMenu,setShowMenu]=useState(false);

  const handleRenameFromMenu=()=>{ setShowMenu(false); setShowRowModal(true); };

  return(
    <div onDragOver={onSectionDragOver} onDrop={onSectionDrop} style={{marginBottom:32,position:"relative",
      outline:isSectionDragOver?"2px dashed #3B82F6":"none",borderRadius:8,padding:isSectionDragOver?"4px":"0"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div draggable onDragStart={onSectionDragStart} style={{cursor:"grab",color:"#cbd5e1",fontSize:16,padding:"0 2px",flexShrink:0}} title="Drag to reorder">⠿</div>
        <h2 style={{margin:0,fontSize:22,fontWeight:700,color:"#1a2332"}}>{section.title}</h2>
        <div style={{width:18,height:18,borderRadius:3,background:"#1a2332",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
          <span style={{color:"#fff",fontSize:10}}>↗</span></div>
        <div style={{display:"flex",marginLeft:4,paddingLeft:6}}>
          {section.avatars.map(a=>(
            <div key={a} style={{width:32,height:32,borderRadius:"50%",background:"#4C9FE8",color:"#fff",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,
              border:"2px solid #fff",marginLeft:-6,flexShrink:0}}>{a}</div>
          ))}
        </div>
        <div style={{width:32,height:32,borderRadius:"50%",marginLeft:-6,background:"#4C9FE8",border:"2px solid #fff",
          display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#fff",fontSize:18}}>+</div>
        <div style={{position:"relative"}}>
          <div onClick={()=>setShowMenu(v=>!v)} style={{width:28,height:28,borderRadius:"50%",background:"#F1F5F9",
            display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:14,color:"#94a3b8"}}>···</div>
          {showMenu&&<RowMenu onRename={handleRenameFromMenu} onDelete={()=>onRemoveSection(section.id)} onClose={()=>setShowMenu(false)}/>}
        </div>
        <div style={{flex:1}}/>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <div style={{width:32,height:32,borderRadius:"50%",border:"1.5px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#94a3b8",flexShrink:0,marginRight:8}}>›</div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          {section.metrics.map(m=>(
            <MetricBlock key={m.id} metric={m}
              onRemove={()=>onRemoveMetric(section.id,m.id)}
              onClick={()=>onClickMetric(m.modal)}
              onEdit={()=>setEditingMetric(m)}
              onDragStart={()=>onMetricDragStart(section.id,m.id)}
              onDragOver={e=>{e.preventDefault();e.stopPropagation();}}
              onDrop={()=>onMetricDrop(section.id,m.id)}
              isDragOver={dragOverMetric===`${section.id}:${m.id}`}/>
          ))}
          <div onClick={()=>setShowAdd(true)} style={{width:48,height:48,borderRadius:"50%",border:"1.5px solid #e2e8f0",
            display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#94a3b8",fontSize:22,alignSelf:"center"}}>+</div>
        </div>
      </div>
      <div style={{height:1,background:"#f1f5f9",marginTop:24}}/>

      {showAdd&&<MetricBoxSettingsModal
        onSave={m=>onAddMetric(section.id,m)}
        onClose={()=>setShowAdd(false)}/>}

      {editingMetric&&<MetricBoxSettingsModal
        initial={editingMetric}
        onSave={m=>onUpdateMetric(section.id,editingMetric.id,m)}
        onDelete={()=>onRemoveMetric(section.id,editingMetric.id)}
        onClose={()=>setEditingMetric(null)}/>}

      {showRowModal&&<EditAddRowModal
        initial={section.title}
        onSave={name=>onRenameSection(section.id,name)}
        onClose={()=>setShowRowModal(false)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: GOALS (list + expanded view)
// ═══════════════════════════════════════════════════════════════════════════

function GoalsPage({goals, setGoals}:{goals:any[];setGoals:(g:any[])=>void}) {
  const [view,setView]=useState<"list"|"expanded">("list");
  return(
    <div style={{padding:"clamp(16px,4vw,32px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:28,flexWrap:"wrap"}}>
        <h1 style={{margin:0,fontSize:"clamp(20px,4vw,26px)",fontWeight:700,color:"#1a2332"}}>Company Goals</h1>
        <div style={{display:"flex",gap:8,marginLeft:8}}>
          {(["list","expanded"] as const).map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"6px 16px",borderRadius:20,border:"none",fontSize:13,cursor:"pointer",fontWeight:500,
              background:view===v?"#3B82F6":"#e2e8f0",color:view===v?"#fff":"#64748b",textTransform:"capitalize"}}>{v==="list"?"List":"Expanded"}</button>
          ))}
        </div>
        <button style={{padding:"8px 20px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",marginLeft:"auto"}}>
          ⊕ Add Goal
        </button>
      </div>

      {view==="list"?(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {goals.map((g,i)=>(
            <div key={i} style={{background:"#fff",borderRadius:16,padding:"18px 20px",border:"1px solid #f1f5f9"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,flexWrap:"wrap"}}>
                <div style={{width:20,height:20,borderRadius:"50%",border:"1.5px solid #d1d5db",flexShrink:0}}/>
                <div style={{fontSize:15,fontWeight:600,color:"#1a2332",flex:1}}>{g.label}</div>
                <button style={{background:"none",border:"none",fontSize:13,color:"#3B82F6",cursor:"pointer",padding:0}}>Edit</button>
              </div>
              <div style={{fontSize:12,color:"#94a3b8",marginBottom:6}}>Progress - {g.pct}%</div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,height:10,borderRadius:99,background:"#e5e7eb",overflow:"hidden"}}>
                  <div style={{width:`${g.pct}%`,height:"100%",borderRadius:99,background:"#4CAF7D"}}/>
                </div>
                <span style={{fontSize:12,color:"#94a3b8",flexShrink:0}}>Due: {g.due}</span>
              </div>
            </div>
          ))}
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:20}}>
          {goals.map((g,i)=>(
            <div key={i} style={{background:"#fff",borderRadius:16,padding:24,border:"1px solid #f1f5f9"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{fontSize:15,fontWeight:700,color:"#1a2332",flex:1}}>{g.label}</div>
                <button style={{background:"none",border:"none",fontSize:13,color:"#3B82F6",cursor:"pointer",padding:0}}>Edit</button>
              </div>
              <div style={{fontSize:12,color:"#94a3b8",marginBottom:4}}>Progress - {g.pct}%</div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                <div style={{flex:1,height:10,borderRadius:99,background:"#e5e7eb",overflow:"hidden"}}>
                  <div style={{width:`${g.pct}%`,height:"100%",borderRadius:99,background:"#4CAF7D"}}/>
                </div>
                <span style={{fontSize:12,color:"#94a3b8",flexShrink:0}}>Due: {g.due}</span>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:"#1a2332",marginBottom:10}}>Projections:</div>
              {g.projections.map((p:any,pi:any)=>(
                <div key={pi} style={{marginBottom:10}}>
                  <div style={{fontSize:12,color:"#94a3b8"}}>{p.label}</div>
                  <div style={{fontSize:16,fontWeight:700,color:"#1a2332"}}>{p.value}</div>
                </div>
              ))}
              <div style={{fontSize:13,fontWeight:700,color:"#1a2332",marginTop:14,marginBottom:10}}>Metrics Tracking This Goal:</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {g.metrics.map((m:any,mi:any)=>(
                  <div key={mi} style={{background:MS[m.color as MetricColor].bg,borderRadius:10,padding:"8px 12px",minWidth:80}}>
                    <div style={{fontSize:11,color:MS[m.color as MetricColor].text,fontWeight:600}}>{m.label}</div>
                    <div style={{fontSize:14,fontWeight:700,color:MS[m.color as MetricColor].text,marginTop:2}}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TASKS
// ═══════════════════════════════════════════════════════════════════════════

function TasksPage({tasks, setTasks}:{tasks:any[];setTasks:(t:any[])=>void}) {
  const [filter,setFilter]=useState<"all"|"active"|"completed">("all");
  const toggle=(id:string)=>{
  const updated=tasks.map((x:any)=>x.id===id?{...x,done:!x.done}:x);
  setTasks(updated);
};
  const filtered=tasks.filter(t=>filter==="all"?true:filter==="active"?!t.done:t.done);
  const suggestedTasks=[
    {text:"Close 5 more calls",tag:"Sales"},
    {text:"Send 13 invoices",tag:"Finance"},
    {text:"Add $3,500 from Overhead",tag:"Cashflow"},
  ];
  return(
    <div style={{padding:"clamp(16px,4vw,32px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:28,flexWrap:"wrap"}}>
        <h1 style={{margin:0,fontSize:"clamp(20px,4vw,26px)",fontWeight:700,color:"#1a2332"}}>Tasks</h1>
        <button style={{padding:"8px 20px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",marginLeft:"auto"}}>
          + Add Task
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) minmax(200px,1fr)",gap:24}}>
        <div>
          <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
            {(["all","active","completed"] as const).map(f=>(
              <div key={f} onClick={()=>setFilter(f)} style={{padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:500,cursor:"pointer",
                background:filter===f?"#3B82F6":"#f1f5f9",color:filter===f?"#fff":"#64748b",textTransform:"capitalize"}}>
                {f}{f==="all"?` (${tasks.length})`:""}
              </div>
            ))}
          </div>
          {filtered.map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:"#fff",
              borderRadius:12,marginBottom:8,border:"1px solid #f1f5f9",opacity:t.done?0.6:1,transition:"opacity 0.2s"}}>
              <div onClick={()=>toggle(t.id)} style={{width:22,height:22,borderRadius:"50%",flexShrink:0,cursor:"pointer",
                border:t.done?"none":"1.5px solid #d1d5db",background:t.done?"#4CAF7D":"transparent",
                display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12}}>
                {t.done?"✓":""}</div>
              <div style={{flex:1,fontSize:14,color:"#1a2332",textDecoration:t.done?"line-through":"none"}}>{t.text}</div>
              <div style={{fontSize:12,color:"#94a3b8",flexShrink:0}}>Due {t.due}</div>
              <Av initials={t.assignee} size={28}/>
            </div>
          ))}
        </div>
        <div>
          <SectionCard title="Suggested Tasks ✦">
            <div style={{fontSize:11,color:"#94a3b8",marginBottom:14}}>Based on your dashboard metrics</div>
            {suggestedTasks.map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#fff",
                borderRadius:10,marginBottom:8,border:"1px solid #f1f5f9"}}>
                <div style={{fontSize:18,color:"#94a3b8",cursor:"pointer"}}>⊕</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,color:"#1a2332"}}>{t.text}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>{t.tag}</div>
                </div>
              </div>
            ))}
          </SectionCard>
          <div style={{marginTop:16}}>
            <SectionCard>
              <div style={{fontSize:14,fontWeight:700,color:"#1a2332",marginBottom:12}}>Task Summary</div>
              {[["Total",tasks.length],["Completed",tasks.filter(t=>t.done).length],["Pending",tasks.filter(t=>!t.done).length]].map(([l,v])=>(
                <div key={l as string} style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:13,color:"#64748b"}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:600,color:"#1a2332"}}>{v}</span>
                </div>
              ))}
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

const APPS = [
  {id:"asana",name:"Asana",logo:"🟧",color:"#F06A35",connected:true,desc:"Task & project management",metrics:["Tasks Completed","Metric Boxes","Workflows"]},
  {id:"trello",name:"Trello",logo:"🟦",color:"#0052CC",connected:true,desc:"Visual project boards",metrics:["Tasks Completed","Metric Boxes","Workflows"]},
  {id:"analytics",name:"Google Analytics",logo:"📊",color:"#E37400",connected:false,desc:"Website traffic & engagement",metrics:["Data Synced","Metric Boxes","Workflows"]},
  {id:"quickbooks",name:"QuickBooks",logo:"🟩",color:"#2CA01C",connected:true,desc:"Accounting & invoicing",metrics:["Data Synced","Metric Boxes","Workflows"]},
  {id:"hubspot",name:"HubSpot",logo:"🟠",color:"#FF7A59",connected:false,desc:"CRM & marketing hub",metrics:["Data Synced","Metric Boxes","Workflows"]},
  {id:"plaid",name:"Plaid",logo:"🔗",color:"#111827",connected:false,desc:"Bank account linking",metrics:["Data Synced","Metric Boxes","Workflows"]},
];

function IntegrationsPage({onSelectApp}:{onSelectApp:(app:typeof APPS[0])=>void}) {
  const [search,setSearch]=useState("");
  const [showAddModal,setShowAddModal]=useState(false);
  const filtered=APPS.filter(a=>a.name.toLowerCase().includes(search.toLowerCase()));
  return(
    <div style={{padding:"clamp(16px,4vw,32px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24,flexWrap:"wrap"}}>
        <h1 style={{margin:0,fontSize:"clamp(20px,4vw,26px)",fontWeight:700,color:"#1a2332"}}>All Apps</h1>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search apps..."
            style={{padding:"8px 14px",borderRadius:20,border:"1px solid #e2e8f0",fontSize:13,outline:"none",width:180}}/>
          <button onClick={()=>setShowAddModal(true)} style={{padding:"8px 18px",borderRadius:8,border:"none",
            background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>
            + Add Integration
          </button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16,marginBottom:32}}>
        {filtered.map(app=>(
          <div key={app.id} onClick={()=>onSelectApp(app)} style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #f1f5f9",cursor:"pointer",
            transition:"box-shadow 0.15s",boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}
            onMouseEnter={e=>(e.currentTarget.style.boxShadow="0 8px 24px rgba(0,0,0,0.1)")}
            onMouseLeave={e=>(e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.04)")}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div style={{fontSize:28}}>{app.logo}</div>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:"#1a2332"}}>{app.name}</div>
                <div style={{fontSize:12,color:"#94a3b8"}}>{app.desc}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:12,padding:"3px 10px",borderRadius:99,fontWeight:600,
                background:app.connected?"#DCFCE7":"#F1F5F9",color:app.connected?"#15803D":"#94a3b8"}}>
                {app.connected?"Connected":"Not Connected"}
              </span>
              <span style={{fontSize:12,color:"#3B82F6",cursor:"pointer"}}>{app.connected?"Manage →":"Connect →"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{background:"#EEF9F4",border:"1px solid #c3e6d4",borderRadius:16,padding:24}}>
        <div style={{fontSize:16,fontWeight:700,color:"#0F6E56",marginBottom:8}}>🏦 Phase 3: Live Bank Integration via Plaid</div>
        <p style={{margin:"0 0 12px",fontSize:13,color:"#1e6b4e",lineHeight:1.6}}>
          Connect your real bank account through Plaid and Dashello will automatically calculate your Five-Account balances.
        </p>
        <button style={{padding:"10px 24px",borderRadius:8,border:"none",background:"#0F6E56",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>
          Connect Bank Account →
        </button>
      </div>

      {showAddModal&&(
        <div onClick={()=>setShowAddModal(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:24,padding:"36px 32px",width:"100%",maxWidth:560,boxShadow:"0 32px 80px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:4}}>
              <button onClick={()=>setShowAddModal(false)} style={{background:"none",border:"none",fontSize:26,cursor:"pointer",color:"#1a2332"}}>×</button>
            </div>
            <h2 style={{margin:"0 0 8px",fontSize:24,fontWeight:700,color:"#1a2332",textAlign:"center"}}>Add your metrics</h2>
            <p style={{margin:"0 0 24px",fontSize:13,color:"#94a3b8",textAlign:"center",lineHeight:1.6}}>
              Select the apps you use or search for your favourite apps. This will help us integrate Dashello with them. Your apps will create and fill your metric blocks.
            </p>
            <input placeholder='Search "Salesforce"....' style={{width:"100%",padding:"10px 16px",borderRadius:20,border:"1.5px solid #e2e8f0",fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:20}}/>
            {APPS.map(app=>(
              <div key={app.id} style={{display:"flex",alignItems:"center",gap:16,marginBottom:14}}>
                <div style={{fontSize:22}}>{app.logo}</div>
                <div style={{flex:1,fontSize:15,fontWeight:600,color:"#1a2332"}}>{app.name}</div>
                <button style={{padding:"10px 28px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",color:"#1a2332"}}>
                  {app.connected?"Connected":"Connect"}
                </button>
              </div>
            ))}
            <div style={{textAlign:"center",marginBottom:20}}>
              <button style={{background:"none",border:"none",fontSize:13,color:"#94a3b8",cursor:"pointer"}}>See more...</button>
            </div>
            <button onClick={()=>setShowAddModal(false)} style={{width:"100%",padding:"13px 0",borderRadius:8,border:"none",
              background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppDetailPage({app,onBack}:{app:typeof APPS[0];onBack:()=>void}) {
  const sampleMetrics=[
    {label:"Tasks Completed",value:"127",change:"+12%",color:"green" as MetricColor},
    {label:"Active Projects",value:"8",change:"+2",color:"yellow" as MetricColor},
    {label:"Overdue Items",value:"3",change:"-5",color:"red" as MetricColor},
  ];
  return(
    <div style={{padding:"clamp(16px,4vw,32px)"}}>
      <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:"#3B82F6",fontSize:14,marginBottom:20,display:"flex",alignItems:"center",gap:4}}>
        ← Back to All Apps
      </button>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24,flexWrap:"wrap"}}>
        <div style={{fontSize:36}}>{app.logo}</div>
        <div>
          <h1 style={{margin:0,fontSize:"clamp(20px,4vw,26px)",fontWeight:700,color:"#1a2332"}}>{app.name}</h1>
          <div style={{fontSize:13,color:"#94a3b8"}}>{app.desc}</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:10}}>
          {app.connected
            ?<button style={{padding:"8px 20px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",fontSize:13,cursor:"pointer",color:"#E85D75"}}>Disconnect</button>
            :<button style={{padding:"8px 20px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Connect {app.name}</button>
          }
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16,marginBottom:28}}>
        {sampleMetrics.map((m,i)=>(
          <div key={i} style={{background:MS[m.color].bg,borderRadius:16,padding:20}}>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.8)",marginBottom:6}}>{m.label}</div>
            <div style={{fontSize:28,fontWeight:700,color:"#fff"}}>{m.value}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.7)",marginTop:4}}>{m.change} this month</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:20}}>
        <SectionCard title="Data Synced">
          <div style={{border:"1px solid #e2e8f0",borderRadius:12,padding:"6px 10px",marginBottom:12}}><Sparkline/></div>
          <div style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>Last synced: 10:23AM today</div>
        </SectionCard>
        <SectionCard title="Workflows">
          {["Auto-create tasks from overdue invoices","Notify team on lead stage change","Weekly summary to Slack"].map((w,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:i<2?"1px solid #f1f5f9":"none"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#4CAF7D",flexShrink:0}}/>
              <span style={{fontSize:13,color:"#1a2332",flex:1}}>{w}</span>
              <Toggle on={i<2} onChange={()=>{}}/>
            </div>
          ))}
        </SectionCard>
        <SectionCard>
          <div style={{display:"inline-block",background:"#3B82F6",color:"#fff",borderRadius:99,padding:"6px 18px",fontSize:13,fontWeight:600,marginBottom:16}}>Suggestions</div>
          {["Connect to 2 more metrics","Set up auto-sync daily","Link to Cashflow row"].map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{fontSize:18,color:"#94a3b8"}}>⊕</span>
              <span style={{fontSize:13,color:"#1a2332"}}>{s}</span>
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: TEAM
// ═══════════════════════════════════════════════════════════════════════════

function TeamPage() {
  const [showInvite,setShowInvite]=useState(false);
  const members=[
    {name:"Alex Johnson",role:"Owner",initials:"AJ",email:"alex@company.com",tasks:12,color:"#4C9FE8"},
    {name:"Beth Kim",role:"Marketing",initials:"BK",email:"beth@company.com",tasks:8,color:"#7B68EE"},
    {name:"Chris Lee",role:"Sales",initials:"CL",email:"chris@company.com",tasks:15,color:"#48C78E"},
    {name:"Dana Miller",role:"Finance",initials:"DM",email:"dana@company.com",tasks:5,color:"#F5A623"},
    {name:"Emma Nash",role:"Operations",initials:"EN",email:"emma@company.com",tasks:9,color:"#E85D75"},
    {name:"Frank Owen",role:"Dev",initials:"FO",email:"frank@company.com",tasks:11,color:"#06B6D4"},
  ];
  return(
    <div style={{padding:"clamp(16px,4vw,32px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:28,flexWrap:"wrap"}}>
        <h1 style={{margin:0,fontSize:"clamp(20px,4vw,26px)",fontWeight:700,color:"#1a2332"}}>Team</h1>
        <button onClick={()=>setShowInvite(true)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#3B82F6,#06B6D4)",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",marginLeft:"auto"}}>
          + Invite Member
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:16,marginBottom:28}}>
        {members.map((m,i)=>(
          <div key={i} style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #f1f5f9",textAlign:"center"}}>
            <div style={{width:56,height:56,borderRadius:"50%",background:m.color,display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:20,fontWeight:700,color:"#fff",margin:"0 auto 12px"}}>{m.initials}</div>
            <div style={{fontSize:15,fontWeight:700,color:"#1a2332"}}>{m.name}</div>
            <div style={{fontSize:12,color:"#94a3b8",marginBottom:8}}>{m.role}</div>
            <div style={{fontSize:12,color:"#3B82F6",marginBottom:12}}>{m.email}</div>
            <div style={{fontSize:18,fontWeight:700,color:"#1a2332"}}>{m.tasks}</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>Tasks</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16}}>
        {[{color:"green" as MetricColor,label:"Team",value:"6 members"},{color:"yellow" as MetricColor,label:"Open Tasks",value:"60"},{color:"gray" as MetricColor,label:"Completed",value:"2 this week"}].map((b,i)=>(
          <div key={i} style={{background:MS[b.color].bg,borderRadius:16,padding:20}}>
            <div style={{fontSize:13,color:MS[b.color].text,opacity:0.8}}>{b.label}</div>
            <div style={{fontSize:22,fontWeight:700,color:MS[b.color].text,marginTop:4}}>{b.value}</div>
          </div>
        ))}
      </div>
      {showInvite&&<AddTeamModal onClose={()=>setShowInvite(false)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

function ProfileField({ label, value, onChange, disabled }: {
  label: string; value: string; onChange?: (v: string) => void; disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, color: "#64748b", display: "block", marginBottom: 4 }}>{label}</label>
      <input value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        style={{ width: "100%", padding: "9px 14px", borderRadius: 8,
          border: "1.5px solid #e2e8f0", fontSize: 14, outline: "none",
          boxSizing: "border-box" as const,
          background: disabled ? "#f8fafc" : "#fff",
          color: disabled ? "#94a3b8" : "#1a2332" }} />
    </div>
  );
}

function SettingsPage({userId, userEmail, onProfileSaved}:{
  userId:string; userEmail:string; onProfileSaved:(p:any)=>void;
}) {
  const [localProfile, setLocalProfile] = useState({
    full_name:"", company:"", street:"", city:"",
    state:"", zip:"", country:"", avatar_url:"",
    five_account_enabled:false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [plan, setPlan] = useState("Pro");
  const [notif, setNotif] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load profile once on mount
  useEffect(() => {
    if (!userId) return;
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle().then(({ data }) => {
      if (data) setLocalProfile({
        full_name: data.full_name ?? "",
        company: data.company ?? "",
        street: data.street ?? "",
        city: data.city ?? "",
        state: data.state ?? "",
        zip: data.zip ?? "",
        country: data.country ?? "",
        avatar_url: data.avatar_url ?? "",
        five_account_enabled: data.five_account_enabled ?? false,
      });
    });
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      full_name: localProfile.full_name,
      company: localProfile.company,
      street: localProfile.street,
      city: localProfile.city,
      state: localProfile.state,
      zip: localProfile.zip,
      country: localProfile.country,
      avatar_url: localProfile.avatar_url,
      five_account_enabled: localProfile.five_account_enabled,
      updated_at: new Date().toISOString(),
    });
   if (!error) {
      onProfileSaved({...localProfile});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

 const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${userId}/avatar.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (!error) {
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      console.log("Upload success, new URL:", urlData.publicUrl);
      const newUrl = `https://rhkrkdwqrzzmakxxsozg.supabase.co/storage/v1/object/public/avatars/${path}?t=${Date.now()}`;      const updated = { ...localProfile, avatar_url: newUrl };
      setLocalProfile(updated);
      await supabase.from("profiles").upsert({
        id: userId,
        avatar_url: newUrl,
        updated_at: new Date().toISOString(),
      });
      onProfileSaved(updated);
    }
    setUploading(false);
  };

  return (
    <div style={{ padding: "clamp(16px,4vw,32px)", maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(20px,4vw,26px)", fontWeight: 700, color: "#1a2332" }}>Profile</h1>
        <div style={{ marginLeft: "auto", padding: "6px 16px", borderRadius: 20,
          background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600 }}>
          {plan} Plan
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>

        {/* Profile card */}
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>

          {/* Avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <div onClick={() => fileRef.current?.click()}
              style={{ width: 64, height: 64, borderRadius: "50%", background: "#4C9FE8", cursor: "pointer",
                overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, fontWeight: 700, color: "#fff", flexShrink: 0, position: "relative" }}>
              {localProfile.avatar_url
                ? <img src={localProfile.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : (localProfile.full_name?.[0]?.toUpperCase() ?? "👤")}
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex",
                alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0")}>
                <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>Change</span>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: "none" }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2332" }}>{localProfile.full_name || "Your Name"}</div>
              <button onClick={() => fileRef.current?.click()}
                style={{ fontSize: 12, color: "#3B82F6", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                {uploading ? "Uploading..." : "Change photo"}
              </button>
            </div>
          </div>

          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Account</h3>
          <ProfileField label="Full Name" value={localProfile.full_name}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, full_name: v }))} />
          <ProfileField label="Email" value={userEmail} disabled />
          <ProfileField label="Company" value={localProfile.company}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, company: v }))} />

          <h3 style={{ margin: "20px 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Address</h3>
          <ProfileField label="Street Address" value={localProfile.street}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, street: v }))} />
          <ProfileField label="City" value={localProfile.city}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, city: v }))} />
          <ProfileField label="State" value={localProfile.state}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, state: v }))} />
          <ProfileField label="ZIP Code" value={localProfile.zip}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, zip: v }))} />
          <ProfileField label="Country" value={localProfile.country}
            onChange={(v:string) => setLocalProfile((p: any) => ({ ...p, country: v }))} />

          <button onClick={handleSave} disabled={saving}
            style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none",
              background: saved ? "#4CAF7D" : "linear-gradient(135deg,#3B82F6,#06B6D4)",
              color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Plan + Preferences */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Plan</h3>
            {[{ name: "Free", price: "$0/mo", features: "3 rows, 10 metrics" },
              { name: "Pro", price: "$29/mo", features: "Unlimited rows, integrations" },
              { name: "Business", price: "$79/mo", features: "Team access, all apps" }].map(p => (
              <div key={p.name} onClick={() => setPlan(p.name)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  borderRadius: 10, marginBottom: 8, cursor: "pointer",
                  background: plan === p.name ? "#EFF6FF" : "#F8FAFC",
                  border: plan === p.name ? "1.5px solid #3B82F6" : "1.5px solid transparent" }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid",
                  borderColor: plan === p.name ? "#3B82F6" : "#d1d5db",
                  background: plan === p.name ? "#3B82F6" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {plan === p.name && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2332" }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{p.features}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#3B82F6" }}>{p.price}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #f1f5f9" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#1a2332" }}>Preferences</h3>
            {[
              { label: "Email notifications", sub: "Daily digest of key metrics", on: notif, set: setNotif },
              { label: "Dark mode", sub: "Switch to dark theme", on: darkMode, set: setDarkMode },
              { label: "Two-factor auth (coming soon)", sub: "Require 2FA on login", on: false, set: () => {} },
              { label: "Five-Account System", sub: "Enable Profit First method globally",
                on: localProfile.five_account_enabled,
                set: (v: boolean) => setLocalProfile((p: any) => ({ ...p, five_account_enabled: v })) },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0", borderBottom: i < 3 ? "1px solid #f1f5f9" : "none" }}>
                <div>
                  <div style={{ fontSize: 14, color: i === 2 ? "#94a3b8" : "#1a2332" }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{item.sub}</div>
                </div>
                <Toggle on={item.on} onChange={item.set} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════════════
// CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════════

function ChatPanel({sections,onClose}:{sections:Section[];onClose:()=>void}) {
  const channels=["General",...sections.map(s=>s.title)];
  const [active,setActive]=useState("General");
  const sampleMsgs:Record<string,{name:string;time:string;text:string}[]>={
    General:[{name:"Julia",time:"14:27",text:"Sounds good @Bryan."},{name:"Bryan",time:"14:23",text:"Thanks @Julia. When can you have it transferred over by?"}],
    Cashflow:[{name:"Julia",time:"14:27",text:"Sounds good @Bryan."},{name:"Bryan",time:"14:23",text:"Thanks @Julia. When can you have it transferred over by?"}],
    Sales:[{name:"Julia",time:"15:53",text:"@Bryan, that's right. our sales are up by 20%, let's celebrate!"},{name:"Bryan",time:"15:56",text:"@Julia, I'll go get the ice-cream cake!"}],
    Marketing:[{name:"Julia",time:"14:20",text:"@Bryan. How come?"},{name:"Bryan",time:"14:39",text:"@Julia, A couple of the Marketing Team members are sick so things are behind..."}],
  };
  const msgs=sampleMsgs[active]??sampleMsgs["General"];
  return(
    <div style={{position:"fixed",right:0,top:0,bottom:0,width:"clamp(280px,30vw,360px)",background:"#fff",
      boxShadow:"-4px 0 32px rgba(0,0,0,0.12)",zIndex:1500,display:"flex",flexDirection:"column",animation:"slideIn 0.2s ease"}}>
      <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      <div style={{padding:"16px 20px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:16,fontWeight:700,color:"#1a2332"}}>Chat</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>×</button>
      </div>
      {/* Channel tabs */}
      <div style={{display:"flex",gap:4,padding:"8px 12px",borderBottom:"1px solid #f1f5f9",overflowX:"auto"}}>
        {channels.map(ch=>(
          <button key={ch} onClick={()=>setActive(ch)} style={{padding:"4px 10px",borderRadius:20,fontSize:12,fontWeight:500,border:"none",cursor:"pointer",flexShrink:0,
            background:active===ch?"#3B82F6":"#f1f5f9",color:active===ch?"#fff":"#64748b"}}>{ch}</button>
        ))}
      </div>
      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:"16px"}}>
        <div style={{textAlign:"center",marginBottom:16}}>
          <span style={{background:"#f1f5f9",borderRadius:99,padding:"4px 14px",fontSize:11,color:"#94a3b8"}}>Wednesday, March 8th</span>
        </div>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",gap:10,marginBottom:14,alignItems:"flex-start"}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:"#4C9FE8",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:600,color:"#fff"}}>
              {m.name[0]}
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#1a2332",marginBottom:2}}>{m.name} <span style={{color:"#94a3b8",fontWeight:400}}>{m.time}</span></div>
              <div style={{fontSize:13,color:"#475569",lineHeight:1.5}}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Input */}
      <div style={{padding:"12px 16px",borderTop:"1px solid #f1f5f9"}}>
        <input placeholder="Type Response..." style={{width:"100%",padding:"10px 16px",borderRadius:99,border:"1.5px solid #e2e8f0",fontSize:13,outline:"none",boxSizing:"border-box",background:"#f8fafc"}}/>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR (collapsible)
// ═══════════════════════════════════════════════════════════════════════════

const NAV=[
  {icon:"⊞",label:"Home",        page:"home"         as Page},
  {icon:"◎",label:"Goals",       page:"goals"        as Page},
  {icon:"✓",label:"Tasks",       page:"tasks"        as Page},
  {icon:"⛓",label:"Integrations",page:"integrations" as Page},
  {icon:"👥",label:"Team",       page:"team"         as Page},
  {icon:"⚙",label:"Settings",   page:"settings"     as Page},
];

function Sidebar({active,onNav,collapsed,onToggle,avatarUrl,firstName}:{active:Page;onNav:(p:Page)=>void;collapsed:boolean;onToggle:()=>void;avatarUrl?:string;firstName?:string}) {
  const w=collapsed?60:185;
  return(
    <aside style={{width:w,flexShrink:0,background:"linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)",
      display:"flex",flexDirection:"column",padding:collapsed?"20px 8px":"24px 12px 20px",
      boxShadow:"4px 0 20px rgba(33,150,243,0.2)",transition:"width 0.25s ease",overflow:"hidden",position:"relative",zIndex:10,
      overflowY:"auto",scrollbarWidth:"none",msOverflowStyle:"none"} as React.CSSProperties}>
      <style>{`aside::-webkit-scrollbar{display:none}`}</style>

      {/* Collapse toggle */}
      <button onClick={onToggle} style={{position:"absolute",top:12,right:collapsed?8:10,background:"rgba(255,255,255,0.2)",border:"none",
        borderRadius:"50%",width:24,height:24,cursor:"pointer",color:"#fff",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {collapsed?"›":"‹"}
      </button>

      {/* Profile */}
      {!collapsed&&(
        <div style={{textAlign:"center",marginBottom:24,marginTop:8}}>
          <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,0.3)",margin:"0 auto 10px",
            border:"3px solid rgba(255,255,255,0.6)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              : "👤"}
          </div>
          <div style={{color:"#fff",fontSize:12,fontWeight:500,lineHeight:1.4}}>
            {firstName ? `Welcome ${firstName} to your dashboard` : "Welcome to your dashboard"}
          </div>
        </div>
      )}
      {collapsed&&(
        <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.3)",margin:"36px auto 20px",
          border:"2px solid rgba(255,255,255,0.5)",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
          {avatarUrl?<img src={avatarUrl} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"👤"}
        </div>
      )}
      {/* Nav */}
      <nav style={{flex:1}}>
        {NAV.map(item=>(
          <div key={item.label} onClick={()=>onNav(item.page)} title={collapsed?item.label:undefined}
            style={{display:"flex",alignItems:"center",gap:collapsed?0:8,padding:collapsed?"10px 0":"9px 12px",
              borderRadius:10,marginBottom:2,cursor:"pointer",justifyContent:collapsed?"center":"flex-start",
              background:active===item.page?"rgba(255,255,255,0.25)":"transparent",
              color:"#fff",fontSize:13,fontWeight:active===item.page?600:400,transition:"background 0.15s"}}>
            <span style={{fontSize:collapsed?20:14,flexShrink:0}}>{item.icon}</span>
            {!collapsed&&<span style={{whiteSpace:"nowrap",overflow:"hidden"}}>{item.label}</span>}
          </div>
        ))}
      </nav>

      {/* Health bar */}
      {!collapsed&&(
        <div style={{marginBottom:16}}>
          <div style={{color:"rgba(255,255,255,0.85)",fontSize:12,marginBottom:6}}>Health — <strong>50%</strong></div>
          <div style={{height:8,borderRadius:99,background:"rgba(255,255,255,0.25)"}}>
            <div style={{width:"50%",height:"100%",borderRadius:99,background:"#4ADE80"}}/>
          </div>
        </div>
      )}

      {/* Tasks widget */}
      {!collapsed&&(
        <div style={{background:"rgba(255,255,255,0.15)",borderRadius:12,padding:"12px 10px"}}>
          <div style={{background:"#3B82F6",borderRadius:8,padding:"4px 10px",color:"#fff",fontSize:12,fontWeight:600,marginBottom:10,display:"inline-block"}}>Your Tasks</div>
          {[1,2,3,4,5].map(i=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
              <div style={{width:14,height:14,borderRadius:"50%",border:"1.5px solid rgba(255,255,255,0.5)",flexShrink:0}}/>
              <div style={{height:7,borderRadius:99,flex:1,background:"rgba(255,255,255,0.35)"}}/>
            </div>
          ))}
          <div style={{color:"rgba(255,255,255,0.75)",fontSize:11,marginTop:4,cursor:"pointer"}} onClick={()=>onNav("tasks")}>View All</div>
        </div>
      )}

      {/* Logo + Sign Out */}
      <div style={{marginTop:16,textAlign:"center"}}>
        {collapsed
          ? <div style={{color:"rgba(255,255,255,0.7)",fontSize:12,fontWeight:700}}>●●</div>
          : <img
              src="https://dashello.co/wp-content/uploads/2023/08/White-Logo-Full.png"
              alt="Dashello"
              style={{height:32,objectFit:"contain",maxWidth:"100%"}}
            />
        }
      </div>
      {!collapsed&&(
        <button
          onClick={()=>supabase.auth.signOut()}
          style={{marginTop:10,width:"100%",padding:"8px 0",borderRadius:8,border:"1.5px solid rgba(255,255,255,0.4)",
            background:"transparent",color:"rgba(255,255,255,0.85)",fontSize:12,fontWeight:600,cursor:"pointer"}}>
          Sign Out
        </button>
      )}
      {collapsed&&(
        <div onClick={()=>supabase.auth.signOut()} title="Sign Out"
          style={{marginTop:10,textAlign:"center",fontSize:18,cursor:"pointer",color:"rgba(255,255,255,0.7)"}}>
          ⏻
        </div>
      )}
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════════════════════════════════════

function HomePage({sections,setSections,setModal}:{sections:Section[];setSections:React.Dispatch<React.SetStateAction<Section[]>>;setModal:(m:MetricModalData)=>void}) {
  const dragMetric=useRef<{sid:string;mid:string}|null>(null);
  const dragSection=useRef<string|null>(null);
  const [dragOverMetric,setDragOverMetric]=useState<string|null>(null);
  const [dragOverSection,setDragOverSection]=useState<string|null>(null);
  const [showAddRow,setShowAddRow]=useState(false);

  const addSection=(name:string)=>setSections(p=>[...p,{id:crypto.randomUUID(),title:name,avatars:[],metrics:[]}]);
  const renameSection=(sid:string,name:string)=>setSections(p=>p.map(s=>s.id===sid?{...s,title:name}:s));
  const removeSection=(sid:string)=>setSections(p=>p.filter(s=>s.id!==sid));
  const addMetric=(sid:string,m:Omit<Metric,"id">)=>setSections(p=>p.map(s=>s.id===sid?{...s,metrics:[...s.metrics,{...m,id:crypto.randomUUID()}]}:s));
  const removeMetric=(sid:string,mid:string)=>setSections(p=>p.map(s=>s.id===sid?{...s,metrics:s.metrics.filter(m=>m.id!==mid)}:s));
  const updateMetric=(sid:string,mid:string,updated:Omit<Metric,"id">)=>setSections(p=>p.map(s=>s.id===sid?{...s,metrics:s.metrics.map(m=>m.id===mid?{...updated,id:mid}:m)}:s));

  const handleMetricDrop=useCallback((tSid:string,tMid:string)=>{
    if(!dragMetric.current)return;
    const{sid:fSid,mid:fMid}=dragMetric.current;
    if(fSid===tSid&&fMid===tMid){dragMetric.current=null;return;}
    setSections(prev=>{
      const moving=prev.find(s=>s.id===fSid)!.metrics.find(m=>m.id===fMid)!;
      const without=prev.map(s=>s.id===fSid?{...s,metrics:s.metrics.filter(m=>m.id!==fMid)}:s);
      return without.map(s=>{if(s.id!==tSid)return s;const idx=s.metrics.findIndex(m=>m.id===tMid);const ms=[...s.metrics];ms.splice(idx,0,moving);return{...s,metrics:ms};});
    });
    dragMetric.current=null;setDragOverMetric(null);
  },[setSections]);

  const handleSectionDrop=useCallback((tSid:string)=>{
    if(!dragSection.current||dragSection.current===tSid)return;
    const fSid=dragSection.current;
    setSections(prev=>{const a=[...prev];const fi=a.findIndex(s=>s.id===fSid);const ti=a.findIndex(s=>s.id===tSid);const[m]=a.splice(fi,1);a.splice(ti,0,m);return a;});
    dragSection.current=null;setDragOverSection(null);
  },[setSections]);

  return(
    <div style={{flex:1,overflowY:"auto",padding:"clamp(16px,4vw,28px) clamp(16px,4vw,32px)"}}>
      {sections.map(s=>(
        <DashSection key={s.id} section={s}
          onAddMetric={addMetric} onRemoveMetric={removeMetric} onUpdateMetric={updateMetric}
          onRenameSection={renameSection} onRemoveSection={removeSection}
          onClickMetric={setModal}
          onMetricDragStart={(sid,mid)=>{dragMetric.current={sid,mid};dragSection.current=null;}}
          onMetricDrop={handleMetricDrop} dragOverMetric={dragOverMetric}
          onSectionDragStart={()=>{dragSection.current=s.id;dragMetric.current=null;}}
          onSectionDragOver={e=>{e.preventDefault();setDragOverSection(s.id);}}
          onSectionDrop={()=>handleSectionDrop(s.id)}
          isSectionDragOver={dragOverSection===s.id}/>
      ))}
      <div onClick={()=>setShowAddRow(true)} style={{display:"flex",alignItems:"center",gap:10,color:"#94a3b8",fontSize:14,cursor:"pointer",padding:"8px 0"}}>
        <div style={{width:28,height:28,borderRadius:"50%",border:"1.5px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#94a3b8"}}>+</div>
        New Row
      </div>
      {showAddRow&&<EditAddRowModal onSave={addSection} onClose={()=>setShowAddRow(false)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════════════

export default function DashelloDashboard() {
  const [page, setPage] = useState<Page>("home");
  const [sections, setSections] = useState<Section[]>([]);
  const [modal, setModal] = useState<MetricModalData | null>(null);
  const [editingFromModal, setEditingFromModal] = useState(false);
  const [selectedApp, setSelectedApp] = useState<typeof APPS[0] | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [dbReady, setDbReady] = useState(false);
  const [profile, setProfile] = useState({
    full_name: "", company: "", street: "", city: "",
    state: "", zip: "", country: "", avatar_url: "",
    five_account_enabled: false,
  });

  // ── Get current user ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? "");
      }
    });
  }, []);

  // ── Load all data on login ────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
  async function load() {
      const [savedSections, savedTasks, savedGoals] = await Promise.all([
        loadUserData("sections", userId!),
        loadUserData("tasks", userId!),
        loadUserData("goals", userId!),
      ]);
      if (savedSections) setSections(savedSections);
      else setSections([]);
      if (savedTasks) setTasksData(savedTasks);
      if (savedGoals) setGoalsData(savedGoals);

      // Load profile
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .maybeSingle();
      if (prof) setProfile({
        full_name: prof.full_name ?? "",
        company: prof.company ?? "",
        street: prof.street ?? "",
        city: prof.city ?? "",
        state: prof.state ?? "",
        zip: prof.zip ?? "",
        country: prof.country ?? "",
        avatar_url: prof.avatar_url ?? "",
        five_account_enabled: prof.five_account_enabled ?? false,
      });

      setDbReady(true);
    }
    load();
  }, [userId]);

  // ── Shared task + goal state (lifted up so we can save them) ─────────
  const [tasksData, setTasksData] = useState([
    { id: "1", text: "Review Q3 financials", done: false, assignee: "AJ", due: "Mar 15" },
    { id: "2", text: "Follow up with 5 leads", done: true, assignee: "BK", due: "Mar 12" },
    { id: "3", text: "Update marketing report", done: false, assignee: "CL", due: "Mar 18" },
    { id: "4", text: "Team standup notes", done: true, assignee: "AJ", due: "Mar 11" },
    { id: "5", text: "Invoice client #4821", done: false, assignee: "DM", due: "Mar 20" },
    { id: "6", text: "Send 34 quotes", done: false, assignee: "BK", due: "Mar 22" },
    { id: "7", text: "Add $9,756 to Tax account", done: false, assignee: "AJ", due: "Mar 14" },
  ]);

  const [goalsData, setGoalsData] = useState([
    { label: "Increase Sales by 25%", current: "$235,000", target: "$1,200,000", pct: 20, due: "May 26th",
      projections: [{ label: "Projected Sales This Month", value: "<27" }, { label: "Projected Income From Sales", value: "<$10,000" }, { label: "Projected New Customers", value: "<250" }],
      metrics: [{ label: "Leads", value: "12", color: "red" }, { label: "Emails Opened", value: "789", color: "green" }, { label: "Invoices In Progress", value: "$10,050.76", color: "gray" }] },
    { label: "Fully Fund Business Emergency - $200k", current: "$70,000", target: "$200,000", pct: 35, due: "Dec 17th",
      projections: [{ label: "Projected Funded Date", value: "Mar. 17/25" }, { label: "Projected Monthly Save", value: "$20,000" }],
      metrics: [{ label: "Overhead", value: "$79,941", color: "green" }, { label: "Profit", value: "$235K", color: "yellow" }, { label: "Tax", value: "$23,750", color: "gray" }] },
    { label: "500 New Sign Ups Per Month", current: "125", target: "500", pct: 25, due: "30th",
      projections: [{ label: "Projected New Sign Ups", value: "350" }, { label: "Projected Click Conversion", value: "4.2%" }],
      metrics: [{ label: "Website", value: "67%", color: "green" }] },
  ]);

  // ── Auto-save whenever data changes ──────────────────────────────────
  useEffect(() => {
    if (!userId || !dbReady) return;
    saveUserData("sections", userId, sections);
  }, [sections, userId, dbReady]);

  useEffect(() => {
    if (!userId || !dbReady) return;
    saveUserData("tasks", userId, tasksData);
  }, [tasksData, userId, dbReady]);

  useEffect(() => {
    if (!userId || !dbReady) return;
    saveUserData("goals", userId, goalsData);
  }, [goalsData, userId, dbReady]);

  // ── Mobile detection ──────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleSelectApp = (app: typeof APPS[0]) => { setSelectedApp(app); setPage("app-detail"); };
  const handleEditFromModal = () => { setEditingFromModal(true); setModal(null); };
  const handleNav = (p: Page) => {
    setPage(p); setSelectedApp(null);
    if (isMobile) setMobileMenuOpen(false);
  };

  // ── Loading screen ────────────────────────────────────────────────────
  if (!dbReady) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg,#2196F3 0%,#00BCD4 100%)", fontSize: 18, color: "#fff",
      fontFamily: "Inter, sans-serif" }}>
      Loading your dashboard...
    </div>
  );

  const sidebarEl = (
    <Sidebar active={page} onNav={handleNav}
      collapsed={isMobile ? false : sidebarCollapsed}
      onToggle={isMobile ? () => setMobileMenuOpen(false) : () => setSidebarCollapsed(v => !v)}
      avatarUrl={profile.avatar_url}
      firstName={profile.full_name?.split(" ")[0] ?? ""}/>
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter',system-ui,sans-serif", background: "#F8FAFC", position: "relative" }}>

      {isMobile && mobileMenuOpen && (
        <div onClick={() => setMobileMenuOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 900 }} />
      )}

      {isMobile ? (
        <div style={{ position: "fixed", left: mobileMenuOpen ? 0 : -220, top: 0, bottom: 0, zIndex: 1000, transition: "left 0.25s ease" }}>
          {sidebarEl}
        </div>
      ) : sidebarEl}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px clamp(12px,3vw,28px)", borderBottom: "1px solid #E8EDF2", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
          {isMobile && (
            <button onClick={() => setMobileMenuOpen(v => !v)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#1a2332", padding: 0, marginRight: 4 }}>☰</button>
          )}
          {page === "home" && (
            <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              {["Row", "Column"].map((lbl, i) => (
                <div key={lbl} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                  background: i === 0 ? "#3B82F6" : "#fff", color: i === 0 ? "#fff" : "#94a3b8" }}>{lbl}</div>
              ))}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div onClick={() => setShowChat(v => !v)} style={{ padding: "7px 18px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 13, color: "#64748b", cursor: "pointer", background: showChat ? "#EFF6FF" : "#fff" }}>Chat</div>
          <div style={{ padding: "8px clamp(12px,2vw,22px)", borderRadius: 8, background: "linear-gradient(135deg,#3B82F6,#06B6D4)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Customize</div>
        </div>

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {page === "home" && <HomePage sections={sections} setSections={setSections} setModal={setModal} />}
          {page === "goals" && <div style={{ flex: 1, overflowY: "auto" }}><GoalsPage goals={goalsData} setGoals={setGoalsData} /></div>}
          {page === "tasks" && <div style={{ flex: 1, overflowY: "auto" }}><TasksPage tasks={tasksData} setTasks={setTasksData} /></div>}
          {page === "integrations" && <div style={{ flex: 1, overflowY: "auto" }}><IntegrationsPage onSelectApp={handleSelectApp} /></div>}
          {page === "app-detail" && selectedApp && <div style={{ flex: 1, overflowY: "auto" }}><AppDetailPage app={selectedApp} onBack={() => setPage("integrations")} /></div>}
          {page === "team" && <div style={{ flex: 1, overflowY: "auto" }}><TeamPage /></div>}
          {page === "settings" && <div style={{ flex: 1, overflowY: "auto" }}><SettingsPage userId={userId!} userEmail={userEmail} onProfileSaved={(p:any)=>setProfile(p)}/></div>}
        </div>
      </div>

      {showChat && <ChatPanel sections={sections} onClose={() => setShowChat(false)} />}
      {modal && <MetricModal data={modal} onClose={() => setModal(null)} onEdit={handleEditFromModal} />}
      {editingFromModal && <MetricBoxSettingsModal
        onSave={() => setEditingFromModal(false)}
        onClose={() => setEditingFromModal(false)} />}
    </div>
  );
}
