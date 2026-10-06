
class Component extends DCLogic {
  SERVICES = {
      'Express Hand Wash':        { price: 45,  dur: 35,  list: ['Exterior rinse','Hand wash','Wheel cleaning','Hand dry & towel','Glass & windows'] },
      'Premium Hand Wash + Interior': { price: 129, dur: 75, list: ['Exterior pre-rinse','Two-bucket hand wash','Wheel & tire cleaning','Tire shine','Interior vacuum','Dashboard & console wipe','Streak-free windows','Final inspection'] },
      'Premium Hand Wash + Interior Refresh': { price: 139, dur: 75, list: ['Exterior pre-rinse','Two-bucket hand wash','Wheel & tire cleaning','Tire shine','Interior vacuum','Dashboard & vents wipe','Leather seat refresh','Streak-free windows','Final inspection'] },
      'Executive Detail':         { price: 260, dur: 90,  list: ['Foam pre-soak','Two-bucket hand wash','Clay bar treatment','Wheel & caliper detail','Tire dressing','Full interior vacuum','Leather conditioning','Dashboard & vents detail','Streak-free glass','Spray sealant','Final inspection'] },
      'Executive Detail + Ceramic': { price: 420, dur: 120, list: ['Foam pre-soak','Two-bucket hand wash','Iron decontamination','Clay bar treatment','Ceramic spray coat','Wheel & caliper detail','Full interior detail','Leather conditioning','Streak-free glass','Final inspection'] },
      'Full Detail':              { price: 320, dur: 120, list: ['Engine bay degrease','Foam pre-soak','Hand wash','Clay bar','Wheel deep clean','Carpet shampoo','Full interior vacuum','Leather treatment','Glass polish','Wax & seal','Final inspection'] },
      'Ceramic Maintenance + Wax': { price: 180, dur: 60, list: ['Pre-rinse','pH-neutral hand wash','Ceramic boost spray','Hand-applied wax','Wheel cleaning','Tire dressing','Glass treatment','Final inspection'] },
      'Exotic Detail Package':    { price: 650, dur: 150, list: ['Hand-dry pre-inspection','Waterless decon','Two-bucket hand wash','Paint correction pass','Ceramic seal','Wheel & caliper detail','Full interior detail','Leather conditioning','Glass & trim restore','Photographic handover'] },
      'Family Wash + Pet Hair':   { price: 95,  dur: 50,  list: ['Exterior rinse','Hand wash','Pet hair removal','Interior vacuum','Dashboard wipe','Windows','Odor neutralize','Final inspection'] },
  };
  ADDONS = [
      ['Interior deep clean',60],['Pet hair removal',35],['Leather conditioning',45],['Wax',40],['Clay bar',50],
      ['Odor removal',30],['Engine bay cleaning',55],['Ceramic maintenance',120],['Rain repellent',25],['Wheel deep clean',40]
  ];
  ADDON_TASKS = {
    'Interior deep clean':['Deep vacuum seats & carpets','Steam clean vents & cupholders','Wipe door jambs & panels'],
    'Pet hair removal':['Rubber-brush pet hair','Lint-roll upholstery','Vacuum seat seams'],
    'Leather conditioning':['Clean leather surfaces','Apply conditioner','Buff to matte finish'],
    'Wax':['Apply carnauba wax','Buff off haze'],
    'Clay bar':['Lubricate panels','Clay bar paint','Wipe residue'],
    'Odor removal':['Enzyme treatment on fabrics','Odor neutralizer cycle'],
    'Engine bay cleaning':['Cover electricals','Degrease engine bay','Dress plastics'],
    'Ceramic maintenance':['Ceramic boost spray','Buff & level coating'],
    'Rain repellent':['Clean glass','Apply rain repellent to windshield'],
    'Wheel deep clean':['Remove wheel fallout','Clean barrels & calipers','Seal wheel faces'],
  };
  HIST = [['Premium Hand Wash + Interior','Bi-weekly regular',129,true],['Express Hand Wash','Quick turnaround',45,false],['Executive Detail','Pre-trip deep clean',260,false]];
  DEF_HOURS = [{open:true,from:'9:00 AM',to:'3:00 PM'},{open:true,from:'8:00 AM',to:'6:00 PM'},{open:true,from:'8:00 AM',to:'6:00 PM'},{open:true,from:'8:00 AM',to:'6:00 PM'},{open:true,from:'8:00 AM',to:'6:00 PM'},{open:true,from:'8:00 AM',to:'6:00 PM'},{open:true,from:'8:00 AM',to:'5:00 PM'}];
  DEF_CLOSURES = [{date:'2026-05-25',name:'Memorial Day',type:'closed'},{date:'2026-06-03',name:'Weather closure',type:'closed'},{date:'2026-07-04',name:'Independence Day',type:'closed'},{date:'2026-09-07',name:'Labor Day',type:'reduced',from:'10:00 AM',to:'2:00 PM'},{date:'2026-11-26',name:'Thanksgiving',type:'closed'},{date:'2026-12-24',name:'Christmas Eve',type:'reduced',from:'8:00 AM',to:'1:00 PM'},{date:'2026-12-25',name:'Christmas Day',type:'closed'}];
  POOL_NAMES = ['Olivia Hart','Ethan Morales','Chloe Bennett','Mateo Silva','Hannah Kim','Isaac Patel','Zoe Laurent','Andre Thompson','Camila Reyes','Noah Fischer','Leah Goldberg','Omar Haddad','Ruby Castillo','Victor Nguyen','Ava Sinclair','Diego Ramos','Nina Petrova','Caleb Owens','Mia Torres','Julian Brooks'];
  POOL_VEH = [[2022,'BMW','X5','Carbon Black'],[2021,'Toyota','4Runner','Lunar Rock'],[2023,'Audi','e-tron GT','Tactical Green'],[2020,'Honda','Accord','Platinum White'],[2024,'Rivian','R1S','Glacier White'],[2019,'Mercedes-Benz','C300','Selenite Grey'],[2022,'Ford','Bronco','Cactus Gray'],[2023,'Porsche','911 Carrera','GT Silver'],[2021,'Kia','Telluride','Gravity Gray'],[2022,'Tesla','Model 3','Deep Blue'],[2024,'Lexus','GX 550','Wind Chill Pearl'],[2023,'Genesis','GV80','Uyuni White']];
  BASE = new Date(2026,5,13);
  ghostRef = React.createRef();

  state = (() => {
    const NOW = 10 * 60 + 36; // 10:36 AM
    const ls = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const ov = ls('oasis-checklists');
    if (ov) { Object.keys(ov.packages || {}).forEach(n => { if (this.SERVICES[n]) this.SERVICES[n].list = ov.packages[n]; }); Object.assign(this.ADDON_TASKS, ov.addons || {}); }
    Object.values(this.SERVICES).forEach(s => { s.list = s.list.filter(x => !/inspection/i.test(x)); });
    const services = this.SERVICES, ADDONS = this.ADDONS;
    this._ls = { hours: ls('oasis-hours'), closures: ls('oasis-closures'), emergency: ls('oasis-emergency') };

    const base = [
      { id:'a1', day:0, time:'8:30 AM', status:'completed', staff:'Lena K.',
        cust:{name:'Maria Delgado', phone:'(305) 412-8890'}, veh:{year:2021,make:'Audi',model:'Q5',color:'Pearl White',plate:'KLP-8842'},
        svc:'Express Hand Wash', bay:2, member:'Essential', pay:'paid', addons:['Wax'], tip:8, pickup:'collected' },
      { id:'a2', day:0, time:'9:15 AM', status:'completed', staff:'Marco R.',
        cust:{name:'David Okafor', phone:'(786) 220-1144'}, veh:{year:2019,make:'Ford',model:'F-150',color:'Magnetic Gray',plate:'FRD-1190'},
        svc:'Full Detail', bay:1, member:null, pay:'paid', addons:['Engine bay cleaning'], tip:20, pickup:'collected' },
      { id:'a3', day:0, time:'9:45 AM', status:'completed', staff:'Lena K.', notified:true, pickup:'pending',
        cust:{name:'Priya Nair', phone:'(305) 778-3321'}, veh:{year:2022,make:'Tesla',model:'Model Y',color:'Midnight Silver',plate:'TES-2210'},
        svc:'Premium Hand Wash + Interior', bay:2, member:'Premium', pay:'unpaid', addons:['Rain repellent'],
        notes:'Customer prefers no fragrance products. Parked in the south lot.' },
      { id:'a4', day:0, time:'10:00 AM', status:'cleaning', staff:'Marco R.', startedAgo:27, vip:true,
        cust:{name:'Jonathan Franco', phone:'(305) 904-7781'}, veh:{year:2023,make:'Mercedes-Benz',model:'GLE',color:'Obsidian Black',plate:'ABC-1234'},
        svc:'Premium Hand Wash + Interior Refresh', bay:1, member:'Premium Care', pay:'paid', addons:['Leather conditioning'],
        notes:'Regular — every other Saturday. Likes a text when 10 min out.' },
      { id:'a5', day:0, time:'10:30 AM', status:'arrived', staff:'Sofia D.', geoIn:'10:27 AM',
        cust:{name:'Sofia Marchetti', phone:'(786) 551-9080'}, veh:{year:2024,make:'Porsche',model:'Macan',color:'Carmine Red',plate:'POR-9911'},
        svc:'Executive Detail', bay:2, member:'Executive', pay:'deposit', deposit:50, addons:[],
        notes:'New ceramic coating — pH-neutral products only.' },
      { id:'a6', day:0, time:'10:45 AM', status:'confirmed', staff:'Marco R.', vip:true, eta:12,
        cust:{name:'Liam Chen', phone:'(305) 233-7765'}, veh:{year:2020,make:'BMW',model:'M340i',color:'Alpine White',plate:'BMW-3401'},
        svc:'Ceramic Maintenance + Wax', bay:1, member:null, pay:'paid', addons:[] },
      { id:'a7', day:0, time:'10:15 AM', status:'confirmed', staff:'Unassigned', late:true,
        cust:{name:'Marcus Webb', phone:'(786) 119-4420'}, veh:{year:2017,make:'Jeep',model:'Wrangler',color:'Sarge Green',plate:'JEP-7720'},
        svc:'Family Wash + Pet Hair', bay:null, member:null, pay:'deposit', deposit:20, addons:['Odor removal'] },
      { id:'a8', day:0, time:'11:00 AM', status:'booked', staff:'Sofia D.', eta:22,
        cust:{name:'Grace Adeyemi', phone:'(305) 660-2231'}, veh:{year:2018,make:'Lexus',model:'RX 350',color:'Silver Lining',plate:'LEX-0455'},
        svc:'Express Hand Wash', bay:2, member:null, pay:'unpaid', addons:[] },
      { id:'a9', day:0, time:'12:00 PM', status:'confirmed', staff:'Marco R.',
        cust:{name:'Aisha Rahman', phone:'(786) 442-1209'}, veh:{year:2023,make:'Range Rover',model:'Sport',color:'Santorini Black',plate:'RR-5567'},
        svc:'Executive Detail + Ceramic', bay:1, member:'Exotic', pay:'paid', addons:['Ceramic maintenance'] },
      { id:'a10', day:0, time:'1:30 PM', status:'confirmed', staff:'Sofia D.',
        cust:{name:'Tom Bradley', phone:'(305) 887-0042'}, veh:{year:2016,make:'Honda',model:'Civic',color:'Aegean Blue',plate:'HND-2218'},
        svc:'Express Hand Wash', bay:2, member:null, pay:'unpaid', addons:[] },
      { id:'a11', day:0, time:'3:00 PM', status:'booked', staff:'Marco R.', vip:true,
        cust:{name:'Elena Volkov', phone:'(786) 998-0001'}, veh:{year:2022,make:'Lamborghini',model:'Urus',color:'Giallo Inti',plate:'URS-0001'},
        svc:'Exotic Detail Package', bay:1, member:'Exotic', pay:'unpaid', addons:[],
        special:'Hand-dry only — no automated equipment near paint. Owner inspects before release.' },
      { id:'a12', day:1, time:'9:00 AM', status:'confirmed', staff:'Lena K.',
        cust:{name:'Nathan Brooks', phone:'(305) 320-7788'}, veh:{year:2021,make:'Chevrolet',model:'Tahoe',color:'Summit White',plate:'CHV-6610'},
        svc:'Family Wash + Pet Hair', bay:2, member:'Essential', pay:'paid', addons:['Pet hair removal'] },
    ];

    const ORDER = ['booked','confirmed','arrived','cleaning','completed'];
    const frac = { booked:0, confirmed:0, arrived:0, cleaning:0.5, completed:1 };

    const histPool = [
      ['Premium Hand Wash + Interior','Bi-weekly regular',129,true],
      ['Express Hand Wash','Quick turnaround',45,false],
      ['Executive Detail','Pre-trip deep clean',260,false],
      ['Ceramic Maintenance + Wax','Coating top-up',180,false],
    ];

    const appts = base.map((a, idx) => {
      const sv = services[a.svc];
      const addonObjs = (a.addons||[]).map(n => { const f = ADDONS.find(x=>x[0]===n); return { name:n, price:f?f[1]:0 }; });
      const visitN = 3 + (idx % 9);
      return {
        ...a,
        whatsapp:true,
        price: sv.price, dur: sv.dur, baseList: sv.list,
        addons: addonObjs,
        checks: this.initChecks(a.svc, a.addons || [], frac[a.status] ?? 0),
        notes: a.notes || 'No special instructions on file.',
        special: a.special || null,
        notified: a.notified !== undefined ? a.notified : true,
        pickup: a.pickup || (a.status==='completed' ? 'pending' : null),
        tip: a.tip || 0,
        startedAt: a.startedAgo ? Date.now() - a.startedAgo*60000 : null,
        photos: { arrival: a.status==='booked'?0:2, before: ['cleaning','completed'].includes(a.status)?3:0, after: ['completed'].includes(a.status)?2:0, issue: idx%4===0?1:0 },
        visits: visitN,
        history: histPool.slice(0, 3 + (idx%2)).map((h,i)=>({ day:String(2+i*5).padStart(2,'0'), mon:['MAY','APR','MAR','FEB'][i], service:h[0], note:h[1], amount:'$'+h[2], fav:h[3] })),
        messages: null, log: null, // built lazily
      };
    });

    return {
      NOW, ORDER, services, ADDONS,
      theme:(()=>{ try { return localStorage.getItem('oasis-theme') || 'light'; } catch(e) { return 'light'; } })(), view:'timeline', search:'', range:'next24',
      appts, selectedId:null, modalTab:'overview', newOpen:false, newTitle:'New Appointment',
      pickedService:'Premium Hand Wash + Interior', pickedSlot:'2:30 PM',
      tick:0, toast:null, dragId:null, dropTarget:null, ghost:null, calMode:'day', calOffset:0, calAppts:[],
      hours:this._ls.hours, closures:this._ls.closures, emergency:this._ls.emergency,
    };
  })();

  componentDidMount() {
    this._t = setInterval(() => this.setState(s => ({ tick: s.tick + 1 })), 1000);
    this._key = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key==='Escape') e.target.blur(); return; }
      if (e.key === 'Escape') { this.setState({ selectedId:null, newOpen:false }); return; }
      if (e.key === '/') { e.preventDefault(); const el=document.getElementById('oa-search'); if(el) el.focus(); return; }
      if (e.key.toLowerCase()==='n') { this.setState({ newOpen:true }); return; }
      if (this.state.view === 'calendar' && !this.state.selectedId) {
        if (e.key === 'ArrowLeft') { this.calNav(-1); return; }
        if (e.key === 'ArrowRight') { this.calNav(1); return; }
        if (e.key.toLowerCase() === 't') { this.setState({ calOffset: 0 }); return; }
      }
      const sel = this.state.selectedId;
      if (sel) {
        const k = e.key.toLowerCase();
        if (k==='m') this.flash('Message composer opened','WhatsApp to '+this.byId(sel).cust.name);
        if (k==='p') this.setState({ modalTab:'payments' });
        if (k==='s' || k==='r') this.advance(sel);
      }
    };
    window.addEventListener('keydown', this._key);
    this._tb = (e) => { if (this._g && this._g.mode) e.preventDefault(); };
    document.addEventListener('touchmove', this._tb, { passive: false });
  }
  componentWillUnmount(){ clearInterval(this._t); window.removeEventListener('keydown', this._key); document.removeEventListener('touchmove', this._tb); this.gEnd(); }

  // ---------- checklist: package + add-ons ----------
  checklistFor(a){
    const sv=this.SERVICES[a.svc];
    const out=[{ title:a.svc, kind:'Package', items:(sv?sv.list:[]).map(l=>({key:'pkg|'+l,label:l})) }];
    (a.addons||[]).forEach(ad=>{ const n=ad.name||ad; const t=this.ADDON_TASKS[n]||[n]; out.push({ title:n, kind:'Add-on', items:t.map(x=>({key:'ad|'+n+'|'+x,label:x})) }); });
    return out;
  }
  initChecks(svc,addons,fr){ const keys=this.checklistFor({svc,addons}).flatMap(s=>s.items.map(i=>i.key)); const n=Math.round(keys.length*fr); const o={}; keys.slice(0,n).forEach(k=>o[k]=true); return o; }
  setFrac(a,fr){ a.checks=this.initChecks(a.svc,a.addons,fr); }
  prepBay(id){ const a=this.byId(id); if(!a) return; const clock=this.nowClock();
    this.update(id,x=>{ this.ensureActivity(x); x.prepped=true; x.log=[...x.log,{time:clock,text:'Bay '+(x.bay||'')+' prepped for arrival',channel:'Internal'}]; return x; });
    this.flash('Bay '+(a.bay||'')+' prepped', (a.vip?'VIP ':'')+a.cust.name+' arrives in '+a.eta+' min'); }
  simArrive(id){ const a=this.byId(id); if(!a) return; const clock=this.nowClock();
    this.update(id,x=>{ this.ensureActivity(x); x.status='arrived'; x.geoIn=clock; x.eta=null; x.late=false;
      x.log=[...x.log,{time:clock,text:'Auto check-in · geofence',channel:'Automation'}];
      x.messages=[...x.messages,{from:'system',text:'Welcome to Oasis! You\u2019re checked in'+(x.bay?' \u2014 pull into Bay '+x.bay:'')+'.',time:clock,channel:'WhatsApp'}]; return x; });
    this.flash('Checked in automatically', a.cust.name+' · welcome message sent'); }
  toggleCheckKey(id,key){ this.update(id,a=>{ a.checks={...a.checks,[key]:!a.checks[key]}; return a; }); }
  checkAll(id,keys,val,quiet){ this.update(id,a=>{ const c={...a.checks}; keys.forEach(k=>{ if(val) c[k]=true; else delete c[k]; }); a.checks=c; return a; }); if(!quiet) this.flash(val?'All tasks checked':'Checklist cleared', keys.length+' tasks '+(val?'marked done':'reset')); }
  checkVM(sa){
    const secs=this.checklistFor(sa), ch=sa.checks||{}, dark=this.state.theme==='dark';
    const all=secs.flatMap(x=>x.items.map(i=>i.key)); const done=all.filter(k=>ch[k]).length, tot=all.length, allDone=tot>0&&done===tot, pct=tot?Math.round(done/tot*100):0;
    return {
      checkDone:done, checkTotal:tot, checkPct:pct+'%', checkPctLabel:pct+'%',
      checkAllLabel: allDone?'Clear all':'Check all', checkAllToggle:()=>this.checkAll(sa.id,all,!allDone),
      checkAllStyle:{ height:'46px',padding:'0 20px',borderRadius:'12px',fontWeight:800,fontSize:'14px',flex:'none', background: allDone?'var(--panel2)':'var(--accent)', color: allDone?'var(--ink2)':'#fff', border: allDone?'1px solid var(--line)':'1px solid var(--accent)' },
      checkSections: secs.map(sc=>{ const keys=sc.items.map(i=>i.key); const d=keys.filter(k=>ch[k]).length; const full=d===keys.length; const pk=sc.kind==='Package';
        return { title:sc.title, kind:sc.kind, countLabel:d+' / '+keys.length,
          kindStyle:{ fontSize:'10.5px',fontWeight:800,padding:'4px 8px',borderRadius:'6px',textTransform:'uppercase',letterSpacing:'0.04em',flex:'none', background:pk?'var(--accentSoft)':this.hexA('#B07908',dark?0.22:0.14), color:pk?'var(--accentInk)':(dark?this.lighten('#B07908'):'#8A5A06') },
          btnLabel: full?'Clear':'Check all', toggle:()=>this.checkAll(sa.id,keys,!full,true),
          items: sc.items.map(it=>{ const on=!!ch[it.key]; return { label:it.label, done:on, toggle:()=>this.toggleCheckKey(sa.id,it.key),
            rowStyle:{ display:'flex',alignItems:'center',gap:'13px',width:'100%',minHeight:'52px',textAlign:'left',padding:'12px 15px',background: on?'var(--accentSoft)':'var(--panel)',border:'1px solid '+(on?'var(--accentBrd)':'var(--line)'),borderRadius:'12px' },
            boxStyle:{ width:'24px',height:'24px',borderRadius:'7px',flex:'none',display:'flex',alignItems:'center',justifyContent:'center', background: on?'var(--accent)':'transparent', border: on?'none':'2px solid var(--ink3)' },
            labelStyle:{ fontSize:'14px',fontWeight:600, color: on?'var(--ink2)':'var(--ink)', textDecoration: on?'line-through':'none' } }; }) };
      }),
    };
  }

  // ---------- calendar data ----------
  dateFor(o){ return new Date(2026,5,13+o); }
  offFor(d){ return Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-this.BASE)/86400000); }
  iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  rng(seed){ let t=seed>>>0; return ()=>{ t+=0x6D2B79F5; let r=Math.imul(t^(t>>>15),1|t); r^=r+Math.imul(r^(r>>>7),61|r); return ((r^(r>>>14))>>>0)/4294967296; }; }
  dayInfo(d){
    const cl=(this.state.closures||this.DEF_CLOSURES).find(c=>c.date===this.iso(d));
    if(cl && cl.type==='closed') return { closed:cl.name };
    const h=(this.state.hours||this.DEF_HOURS)[d.getDay()];
    if(!h || !h.open) return { closed:'Regular day off' };
    const f=cl?cl.from:h.from, t=cl?cl.to:h.to;
    return { h0:Math.floor(this.parseT(f)/60), h1:Math.ceil(this.parseT(t)/60), from:f, to:t, note:cl?cl.name+' · reduced hours':'' };
  }
  dayCount(o,inf){ const d=this.dateFor(o); const rnd=this.rng(o*7919+104729); let n=Math.max(2,[4,6,6,7,7,9,10][d.getDay()]+Math.floor(rnd()*4)-1); if(inf.note) n=Math.ceil(n/2); return {n,rnd}; }
  countFor(o){ const s=this.state; if(o===0) return s.appts.filter(a=>a.day===0).length; const inf=this.dayInfo(this.dateFor(o)); if(inf.closed) return 0; return this.dayCount(o,inf).n+(o===1?s.appts.filter(a=>a.day===1).length:0); }
  hydrate(a,idx){
    const sv=this.SERVICES[a.svc]; const addons=(a.addons||[]).map(n=>{ const f=this.ADDONS.find(x=>x[0]===n); return {name:n,price:f?f[1]:0}; });
    return { ...a, whatsapp:true, price:sv.price, dur:sv.dur, baseList:sv.list, addons, checks:this.initChecks(a.svc,addons,a.status==='completed'?1:0),
      notes:'No special instructions on file.', special:null, notified:true, startedAt:null,
      photos:{arrival:a.status==='booked'?0:2,before:a.status==='completed'?3:0,after:a.status==='completed'?2:0,issue:0}, visits:3+(idx%9),
      history:this.HIST.map((h,i)=>({day:String(2+i*5).padStart(2,'0'),mon:['MAY','APR','MAR'][i],service:h[0],note:h[1],amount:'$'+h[2],fav:h[3]})), messages:null, log:null };
  }
  genDay(o){
    const s=this.state; this._gen=this._gen||{};
    if(!this._gen[o]){ const d=this.dateFor(o), inf=this.dayInfo(d); let list=[];
      if(!inf.closed){ const {n,rnd}=this.dayCount(o,inf);
        const start=Math.max(inf.h0*60, o===1?11*60:0), end=Math.max(start,inf.h1*60-60); const slots=[]; for(let m=start;m<=end;m+=30) slots.push(m);
        const svcs=Object.keys(this.SERVICES), staff=['Marco R.','Lena K.','Sofia D.'], past=o<0;
        const picks=Array.from({length:n},()=>slots[Math.floor(rnd()*slots.length)]).sort((x,y)=>x-y);
        list=picks.map((m,i)=>{ const nm=this.POOL_NAMES[Math.floor(rnd()*this.POOL_NAMES.length)], v=this.POOL_VEH[Math.floor(rnd()*this.POOL_VEH.length)];
          return this.hydrate({ id:'g'+o+'_'+i, day:o, time:this.fmtT(m), status:past?'completed':(rnd()<0.7?'confirmed':'booked'), staff:staff[i%3],
            cust:{name:nm, phone:'(305) '+(200+Math.floor(rnd()*700))+'-'+(1000+Math.floor(rnd()*8999))},
            veh:{year:v[0],make:v[1],model:v[2],color:v[3],plate:v[1].slice(0,3).toUpperCase()+'-'+(1000+Math.floor(rnd()*8999))},
            svc:svcs[Math.floor(rnd()*svcs.length)], bay:(i%2)+1, member:rnd()<0.35?['Essential','Premium','Executive'][Math.floor(rnd()*3)]:null,
            pay:past?'paid':(rnd()<0.45?'paid':(rnd()<0.5?'deposit':'unpaid')), deposit:25,
            addons:rnd()<0.4?[this.ADDONS[Math.floor(rnd()*this.ADDONS.length)][0]]:[], tip:past?5*Math.floor(rnd()*4):0, pickup:past?'collected':null }, i); }); }
      this._gen[o]=list; }
    let out=this._gen[o].map(a=>s.calAppts.find(x=>x.id===a.id)||a);
    if(o===1) out=[...s.appts.filter(a=>a.day===1),...out];
    return out;
  }
  known(id){ const s=this.state; return s.appts.some(x=>x.id===id)||s.calAppts.some(x=>x.id===id); }
  materialize(a){ if(!this.known(a.id)) this.setState(st=>({ calAppts:[...st.calAppts,{...a}] })); }
  openAppt(a,tab){ if(Date.now()-(this._sup||0)<450) return; this.materialize(a); this.setState({ selectedId:a.id, modalTab:tab||'overview' }); }
  calNav(dir){ const s=this.state; if(s.calMode==='day') this.setState({calOffset:s.calOffset+dir}); else if(s.calMode==='week') this.setState({calOffset:s.calOffset+7*dir}); else { const d=this.dateFor(s.calOffset); this.setState({calOffset:this.offFor(new Date(d.getFullYear(),d.getMonth()+dir,1))}); } }
  reschedule(a,hr){
    if(!this.canDrag(a)){ this.flash('Can\u2019t move this job','It\u2019s already in progress or done'); return; }
    const nt=this.fmtT(hr*60+this.parseT(a.time)%60); if(nt===a.time) return; const clock=this.nowClock();
    this.materialize(a);
    this.update(a.id,x=>{ this.ensureActivity(x); x.messages=[...x.messages,{from:'system',text:'Your appointment has been moved to '+nt+'. Reply if that doesn\u2019t work.',time:clock,channel:'WhatsApp'}]; x.log=[...x.log,{time:clock,text:'Rescheduled to '+nt,channel:'Internal'}]; x.time=nt; x.late=false; return x; });
    this.flash('Moved to '+nt, a.cust.name+' notified via WhatsApp');
  }

  calVM(){
    const s=this.state, off=s.calOffset, mode=s.calMode, cd=this.dateFor(off);
    const MON=['January','February','March','April','May','June','July','August','September','October','November','December'], DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], DOWL=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const modeBtn=(k,l)=>({ label:l, onClick:()=>this.setState({calMode:k}), style:{ height:'36px',padding:'0 16px',borderRadius:'9px',fontSize:'13px',fontWeight:700, background:mode===k?'var(--panel)':'transparent', color:mode===k?'var(--ink)':'var(--ink2)', boxShadow:mode===k?'var(--shadow)':'none', border:mode===k?'1px solid var(--line)':'1px solid transparent' } });
    let calLabel='', calSub='', calRows=[], calWeek=[], calMonth=[], calClosed=false, calClosedReason='';
    const cell=(o)=>{ const d=this.dateFor(o), inf=this.dayInfo(d); return { o, d, closed:o!==0&&inf.closed?inf.closed:null, n:(o!==0&&inf.closed)?0:this.countFor(o) }; };
    if(mode==='day'){
      const inf=this.dayInfo(cd);
      calLabel=DOWL[cd.getDay()]+', '+MON[cd.getMonth()]+' '+cd.getDate()+(cd.getFullYear()!==2026?', '+cd.getFullYear():'');
      if(off!==0 && inf.closed){ calClosed=true; calClosedReason=inf.closed; calSub='Closed'; }
      else {
        const list=(off===0?s.appts.filter(a=>a.day===0):this.genDay(off)).slice().sort((x,y)=>this.parseT(x.time)-this.parseT(y.time));
        const h0=inf.h0||8, h1=inf.h1||17;
        for(let h=h0;h<h1;h++){
          const items=list.filter(a=>Math.floor(this.parseT(a.time)/60)===h).map(a=>this.cardVM(a));
          const ap=h>=12?'PM':'AM'; let hh=h%12; if(hh===0) hh=12; const hov=!!s.dragId && s.dropTarget==='hr:'+h;
          calRows.push({ time:String(hh), ampm:ap, items, empty:items.length===0, drop:'hr:'+h,
            rowStyle:{ display:'flex',gap:'16px',borderTop:'1px solid var(--line2)',padding:'11px 8px',minHeight:'66px',borderRadius:hov?'12px':'0',background:hov?'var(--accentSoft)':'transparent',outline:hov?'2px dashed var(--accent)':'none',transition:'background .12s ease' } });
        }
        calSub=(off===0?'Today · ':'')+list.length+' appointment'+(list.length===1?'':'s')+' · '+(inf.note?inf.note+' · ':'')+this.fmtT(h0*60)+' – '+this.fmtT(h1*60);
      }
    } else if(mode==='week'){
      const start=off-cd.getDay(), e0=this.dateFor(start), e1=this.dateFor(start+6); let tot=0;
      calLabel=MON[e0.getMonth()].slice(0,3)+' '+e0.getDate()+' – '+(e0.getMonth()!==e1.getMonth()?MON[e1.getMonth()].slice(0,3)+' ':'')+e1.getDate()+', '+e1.getFullYear();
      for(let i=0;i<7;i++){ const c=cell(start+i); tot+=c.n; const isT=c.o===0;
        calWeek.push({ dow:DOW[i], num:String(c.d.getDate()), count:String(c.n), countLabel:c.n===1?'appointment':'appointments', open:!c.closed, closed:!!c.closed, reason:c.closed||'', isToday:isT,
          onClick:()=>this.setState({calMode:'day',calOffset:c.o}),
          style:{ display:'flex',flexDirection:'column',alignItems:'flex-start',textAlign:'left',padding:'16px',borderRadius:'16px',minHeight:'190px', background:c.closed?'var(--panel3)':(isT?'var(--accentSoft)':'var(--panel2)'), border:'1px solid '+(isT?'var(--accentBrd)':'var(--line)'), touchAction:'manipulation' } }); }
      calSub=tot+' appointments this week · tap a day to open it';
    } else {
      const y=cd.getFullYear(), m=cd.getMonth(), first=new Date(y,m,1), fo=this.offFor(first), lead=first.getDay(), dim=new Date(y,m+1,0).getDate(), cells=Math.ceil((lead+dim)/7)*7; let tot=0;
      calLabel=MON[m]+' '+y;
      for(let i=0;i<cells;i++){ const c=cell(fo-lead+i); const inM=c.d.getMonth()===m; if(inM) tot+=c.n; const isT=c.o===0;
        calMonth.push({ num:String(c.d.getDate()), showCount:!c.closed&&c.n>0, countLabel:c.n+(c.n===1?' appt':' appts'), closed:!!c.closed&&inM, reason:c.closed||'',
          onClick:()=>this.setState({calMode:'day',calOffset:c.o}),
          numStyle:{ width:'28px',height:'28px',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'13px', background:isT?'var(--accent)':'transparent', color:isT?'#fff':(inM?'var(--ink)':'var(--ink3)') },
          pillStyle:{ fontSize:'12px',fontWeight:800,padding:'4px 9px',borderRadius:'8px', background:inM?'var(--accentSoft)':'var(--panel3)', color:inM?'var(--accentInk)':'var(--ink3)' },
          style:{ display:'flex',flexDirection:'column',alignItems:'flex-start',padding:'8px 9px 10px',borderRadius:'12px',textAlign:'left',minHeight:'72px', background:c.closed&&inM?'var(--panel3)':(inM?'var(--panel2)':'transparent'), border:'1px solid '+(isT?'var(--accentBrd)':(inM?'var(--line)':'var(--line2)')), opacity:inM?1:0.55, touchAction:'manipulation' } }); }
      calSub=tot+' appointments in '+MON[m]+' · tap a date to open it';
    }
    return { calLabel, calSub, calRows, calWeek, calMonth, calClosed, calClosedReason,
      calHint: mode==='day'?'Drag or long-press to reschedule · swipe for next day':'Swipe or use ← → to move',
      calModes:[modeBtn('day','Day'),modeBtn('week','Week'),modeBtn('month','Month')], calDow:DOW,
      calIsDay:mode==='day', calIsWeek:mode==='week', calIsMonth:mode==='month',
      calPrev:()=>this.calNav(-1), calNext:()=>this.calNav(1), calToday:()=>this.setState({calOffset:0}),
      calSwipeStart:(e)=>{ if(e.pointerType==='mouse') return; this._cs={x:e.clientX,y:e.clientY,t:Date.now()}; },
      calSwipeEnd:(e)=>{ const c=this._cs; this._cs=null; if(!c || (this._g && this._g.mode==='drag')) return; const dx=e.clientX-c.x, dy=e.clientY-c.y; if(Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.5 && Date.now()-c.t<800){ this._sup=Date.now(); this.calNav(dx<0?1:-1); } } };
  }

  // ---------- touch / pointer gestures ----------
  canDrag(a){ return !this.inFacility(a) && a.status!=='completed'; }
  gStart(e,a,ctx){
    if(e.button>0) return; this.gEnd();
    const g={ id:a.id, a, ctx, x0:e.clientX, y0:e.clientY, x:e.clientX, y:e.clientY, touch:e.pointerType!=='mouse', el:e.currentTarget, mode:null, can:this.canDrag(a) };
    this._g=g;
    if(g.touch && g.can) g.timer=setTimeout(()=>{ if(this._g===g && !g.mode) this.beginDrag(g); },380);
    window.addEventListener('pointermove',this._gm); window.addEventListener('pointerup',this._gu); window.addEventListener('pointercancel',this._gc);
  }
  _gm=(e)=>{ const g=this._g; if(!g) return; g.x=e.clientX; g.y=e.clientY; const dx=g.x-g.x0, dy=g.y-g.y0;
    if(!g.mode){
      if(!g.touch){ if(g.can && Math.hypot(dx,dy)>6) this.beginDrag(g); return; }
      if(Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*1.4){ clearTimeout(g.timer); if(g.ctx==='tl') g.mode='swipe'; else { this.gEnd(); return; } }
      else if(Math.hypot(dx,dy)>12){ this.gEnd(); return; }
    }
    if(g.mode==='drag'){ this.moveGhost(); this.hoverTarget(); }
    else if(g.mode==='swipe'){ g.el.style.transition='none'; g.el.style.transform='translateX('+Math.max(-150,Math.min(150,dx))+'px)'; }
  };
  _gu=()=>{ const g=this._g; if(!g) return;
    if(g.mode==='drag'){ const t=this.state.dropTarget; this._sup=Date.now(); this.gEnd(); if(t) this.dropOn(g,t); }
    else if(g.mode==='swipe'){ const dx=g.x-g.x0; this._sup=Date.now(); g.el.style.transition='transform .22s ease'; g.el.style.transform=''; this.gEnd(); if(dx>90) this.advance(g.id); else if(dx<-90) this.setState({selectedId:g.id,modalTab:'messages'}); }
    else this.gEnd();
  };
  _gc=()=>{ const g=this._g; if(g&&g.mode==='swipe'){ g.el.style.transition='transform .22s ease'; g.el.style.transform=''; } this.gEnd(); };
  gEnd(){ const g=this._g; if(g) clearTimeout(g.timer); this._g=null; window.removeEventListener('pointermove',this._gm); window.removeEventListener('pointerup',this._gu); window.removeEventListener('pointercancel',this._gc); document.body.style.userSelect=''; if(this.state.dragId) this.setState({dragId:null,dropTarget:null}); }
  beginDrag(g){ g.mode='drag'; document.body.style.userSelect='none'; try{ navigator.vibrate && navigator.vibrate(12); }catch(_){}
    this.setState({ dragId:g.id, dropTarget:null, ghost:{ name:g.a.cust.name, vehicle:g.a.veh.year+' '+g.a.veh.make+' '+g.a.veh.model, hint:g.ctx==='cal'?'Drop on a new time':'Drop on an open bay' } },()=>this.moveGhost()); }
  moveGhost(){ const g=this._g, el=this.ghostRef.current; if(g&&el) el.style.transform='translate('+(g.x-140)+'px,'+(g.y-36)+'px) rotate(-2deg)'; }
  hoverTarget(){ const g=this._g; const el=document.elementFromPoint(g.x,g.y); const t=el&&el.closest?el.closest('[data-drop]'):null; const v=t?t.getAttribute('data-drop'):null; if(v!==this.state.dropTarget) this.setState({dropTarget:v}); }
  dropOn(g,t){ const [k,v]=t.split(':'); if(k==='bay') this.assignToBay(g.id,+v); else if(k==='hr') this.reschedule(this.byId(g.id)||g.a,+v); }

  // ---------- helpers ----------
  byId(id){ return this.state.appts.find(a=>a.id===id) || this.state.calAppts.find(a=>a.id===id); }
  money(n){ return '$' + Math.round(n).toLocaleString('en-US'); }
  parseT(s){ const m=s.match(/(\d+):(\d+)\s*(AM|PM)/i); let h=+m[1]%12; if(/pm/i.test(m[3]))h+=12; return h*60+ +m[2]; }
  fmtT(mins){ mins=((mins%1440)+1440)%1440; let h=Math.floor(mins/60), m=mins%60; const ap=h>=12?'PM':'AM'; h=h%12; if(h===0)h=12; return h+':'+String(m).padStart(2,'0')+' '+ap; }
  absMin(a){ return a.day*1440 + this.parseT(a.time); }
  nowClock(){ const d=new Date(); let h=d.getHours(), m=d.getMinutes(); const ap=h>=12?'PM':'AM'; h=h%12; if(h===0)h=12; return h+':'+String(m).padStart(2,'0')+' '+ap; }
  stMeta(s){ return ({
    booked:{l:'Booked',c:'#6B7280'}, confirmed:{l:'Confirmed',c:'#2563EB'}, arrived:{l:'Arrived',c:'#7C3AED'},
    cleaning:{l:'In Wash',c:'#C2740B'}, completed:{l:'Completed',c:'#0E9E6E'},
    canceled:{l:'Canceled',c:'#9F1239'}, noshow:{l:'No-Show',c:'#B91C1C'},
  }[s]||{l:s,c:'#6B7280'}); }
  hexA(hex,a){ const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return `rgba(${r},${g},${b},${a})`; }
  isLate(a){ return a.late && !['arrived','cleaning','completed'].includes(a.status); }
  inFacility(a){ return a.status==='cleaning'; }

  total(a){ const addon=(a.addons||[]).reduce((s,x)=>s+x.price,0); const sub=a.price+addon; const credit=a.member?Math.min(a.price,a.member==='Exotic'?0:0):0; const tax=Math.round((sub-credit)*0.07); return { sub, addon, credit, tax, tip:a.tip||0, grand: sub-credit+tax+(a.tip||0) }; }
  balance(a){ const t=this.total(a); if(a.pay==='paid') return 0; if(a.pay==='deposit') return t.grand-(a.deposit||0); return t.grand; }

  memberMeta(m){ if(!m) return null; const k=m.split(' ')[0]; return ({
    Essential:{c:'#7A8B73', bg:'#E9EDE4'}, Premium:{c:'#8A6D3B', bg:'#F2E9D6'},
    Executive:{c:'#3B5A8A', bg:'#E0E8F4'}, Exotic:{c:'#7A3B8A', bg:'#EEDFF2'},
  }[k] || {c:'#8A6D3B', bg:'#F2E9D6'}); }

  // ---------- activity (lazy) ----------
  ensureActivity(a){
    if(a.messages && a.log) return a;
    const order=this.state.ORDER; const ci=order.indexOf(a.status);
    const t0=this.parseT(a.time);
    const auto={ confirmed:['Confirmation + reminder sent','WhatsApp','Your appointment at Oasis Auto Spa is confirmed for '+a.time+'. Reply C to confirm.'],
      arrived:['Arrival logged','Internal',null],
      checkedin:['Check-in message sent','WhatsApp','Your '+a.veh.make+' has been checked in. We\u2019ll keep you posted.'],
      cleaning:['In-progress message sent','WhatsApp','Good news \u2014 your vehicle is now being cleaned.'],
      qc:['Quality inspection started','Internal',null],
      ready:['Ready-for-pickup sent','WhatsApp','Your vehicle is ready for pickup! See you soon.'],
      paid:['Receipt sent','Email + WhatsApp','Payment received \u2014 receipt on its way. Thank you!'],
      completed:['Job closed \u00b7 review request scheduled','Automation','Thanks for visiting Oasis Auto Spa! How did we do? \u2b50'] };
    const msgs=[{from:'staff',text:'Hi '+a.cust.name.split(' ')[0]+', thanks for booking with Oasis Auto Spa.',time:'Yesterday 4:02 PM',channel:'WhatsApp'}];
    const log=[{time:'Yesterday 4:02 PM',text:'Booking created \u00b7 deposit link sent',channel:'System'}];
    let off=0;
    order.forEach((st,i)=>{ if(i===0||i>ci) return; const a2=auto[st]; if(!a2) return;
      const tt = st==='confirmed' ? 'Yesterday 4:12 PM' : this.fmtT(t0+off); if(st!=='confirmed') off+=Math.max(2,Math.round(a.dur/6));
      log.push({time:tt,text:a2[0],channel:a2[1]});
      if(a2[2]) msgs.push({from:'system',text:a2[2],time:tt,channel:a2[1]});
    });
    a.messages=msgs; a.log=log; return a;
  }

  // ---------- mutations ----------
  update(id, fn){ this.setState(s=> s.appts.some(a=>a.id===id) ? { appts: s.appts.map(a=> a.id===id ? fn({...a}) : a) } : { calAppts: s.calAppts.map(a=> a.id===id ? fn({...a}) : a) }); }
  flash(title,desc){ this.setState({toast:{title,desc}}); clearTimeout(this._tt); this._tt=setTimeout(()=>this.setState({toast:null}),3200); }

  nextStep(a){
    switch(a.status){
      case 'booked': return {label:'Confirm Appointment', to:'confirmed'};
      case 'confirmed': return {label:'Mark Arrived', to:'arrived'};
      case 'arrived': return {label:'Start Cleaning', to:'cleaning'};
      case 'cleaning': return {label:'Mark Complete', to:'completed'};
      case 'completed': return this.balance(a)>0 ? {label:'Collect Payment', to:'pay'} : null;
      default: return null;
    }
  }

  advance(id){
    const a=this.byId(id); if(!a) return; const step=this.nextStep(a); if(!step) return;
    const auto={ confirmed:['Confirmation + reminder sent','WhatsApp','Your appointment is confirmed for '+a.time+'.'],
      arrived:['Arrival logged','Internal',null],
      cleaning:['In-progress message sent','WhatsApp','Your vehicle is now being cleaned.'],
      completed:['Ready-for-pickup sent','WhatsApp','Your vehicle is ready for pickup!'] };
    const clock=this.nowClock();
    this.update(id, a=>{
      this.ensureActivity(a);
      a.messages=[...a.messages]; a.log=[...a.log];
      if(step.to==='pay'){
        a.pay='paid';
        a.log.push({time:clock,text:'Payment captured \u00b7 receipt sent',channel:'Email + WhatsApp'});
        a.messages.push({from:'system',text:'Payment received \u2014 receipt sent. Thank you!',time:clock,channel:'WhatsApp'});
      } else {
        a.status=step.to;
        if(step.to==='cleaning') a.startedAt=Date.now();
        if(step.to==='completed'){ a.pickup=a.pickup||'pending'; a.notified=true; }
        if(step.to==='completed') this.setFrac(a,1);
        const x=auto[step.to];
        if(x){ a.log.push({time:clock,text:x[0],channel:x[1]}); if(x[2]) a.messages.push({from:'system',text:x[2],time:clock,channel:x[1]}); }
      }
      return a;
    });
    const labels={confirmed:'Confirmation sent',arrived:'Marked arrived',cleaning:'Cleaning started',completed:'Job completed',pay:'Payment collected'};
    const descs={confirmed:'Reminder via WhatsApp',arrived:'Internal team notified',cleaning:'In-progress message sent',completed:'Ready-for-pickup sent \u00b7 moved to pickup',pay:'Receipt sent'};
    this.flash(labels[step.to]||'Updated', descs[step.to]||'');
  }

  assignToBay(id,num){
    if(!id) return; const a=this.byId(id); if(!a) return;
    if(this.inFacility(a)){ this.flash('Already in a bay','That vehicle is in Bay '+a.bay); return; }
    const occ=this.state.appts.find(x=>x.bay===num && this.inFacility(x));
    if(occ){ this.flash('Bay '+num+' is busy','Finish '+occ.cust.name.split(' ')[0]+'\u2019s vehicle first'); return; }
    const clock=this.nowClock();
    this.update(id, a=>{ this.ensureActivity(a); a.messages=[...a.messages]; a.log=[...a.log];
      a.bay=num; a.status='cleaning'; a.startedAt=Date.now();
      a.log.push({time:clock,text:'Assigned to Bay '+num+' \u00b7 cleaning started',channel:'Internal'});
      a.messages.push({from:'system',text:'Your '+a.veh.make+' is now being cleaned.',time:clock,channel:'WhatsApp'});
      return a; });
    this.flash('Moved to Bay '+num, a.cust.name+' \u00b7 cleaning started');
  }
  togglePay(id){ const a=this.byId(id); if(!a) return; const now=a.pay==='paid'; const clock=this.nowClock();
    this.update(id, a=>{ this.ensureActivity(a); a.messages=[...a.messages]; a.log=[...a.log];
      a.pay = now ? 'unpaid' : 'paid';
      if(!now){ a.log.push({time:clock,text:'Payment captured \u00b7 receipt sent',channel:'Email + WhatsApp'}); a.messages.push({from:'system',text:'Payment received \u2014 receipt sent. Thank you!',time:clock,channel:'WhatsApp'}); }
      else { a.log.push({time:clock,text:'Marked unpaid \u00b7 balance reopened',channel:'Internal'}); }
      return a; });
    this.flash(now?'Marked unpaid':'Payment collected', now?'Balance reopened':'Receipt sent to customer');
  }
  togglePickup(id){ const a=this.byId(id); if(!a) return; const now=a.pickup==='collected'; const clock=this.nowClock();
    this.update(id, a=>{ this.ensureActivity(a); a.log=[...a.log];
      a.pickup = now ? 'pending' : 'collected';
      a.log.push({time:clock,text: now?'Pickup reopened':'Vehicle released to customer',channel:'Internal'});
      return a; });
    this.flash(now?'Pickup reopened':'Vehicle picked up', now?'Back to ready for pickup':'Released to '+a.cust.name.split(' ')[0]);
  }


  toggleAddon(id,name,price){ this.update(id,a=>{ const has=a.addons.find(x=>x.name===name); a.addons = has? a.addons.filter(x=>x.name!==name) : [...a.addons,{name,price}]; return a; });
    this.flash('Invoice + checklist updated', (this.byId(id).addons.find(x=>x.name===name)?'Removed ':'Added ')+name); }
  collect(id){ this.update(id,a=>{ this.ensureActivity(a); a.pay='paid'; if(a.status==='ready')a.status='paid'; a.messages=[...a.messages,{from:'system',text:'Payment received \u2014 receipt sent. Thank you!',time:this.nowClock(),channel:'WhatsApp'}]; a.log=[...a.log,{time:this.nowClock(),text:'Payment captured \u00b7 receipt sent',channel:'Email + WhatsApp'}]; return a; }); this.flash('Payment collected','Receipt sent to customer'); }
  sendTemplate(id,text){ this.update(id,a=>{ this.ensureActivity(a); a.messages=[...a.messages,{from:'staff',text,time:this.nowClock(),channel:'WhatsApp'}]; a.log=[...a.log,{time:this.nowClock(),text:'Staff message sent',channel:'WhatsApp'}]; return a; }); this.flash('Message sent','Delivered via WhatsApp'); }
  notify(id){ this.update(id,a=>{ this.ensureActivity(a); a.notified=true; a.messages=[...a.messages,{from:'system',text:'Your vehicle is ready for pickup!',time:this.nowClock(),channel:'WhatsApp'}]; a.log=[...a.log,{time:this.nowClock(),text:'Ready-for-pickup sent',channel:'WhatsApp'}]; return a; }); this.flash('Customer notified','Ready-for-pickup sent via WhatsApp'); }

  // ---------- view models ----------
  badgeStyle(c){ return { display:'inline-flex',alignItems:'center',gap:'5px',padding:'3px 9px',borderRadius:'7px',fontSize:'11px',fontWeight:800,whiteSpace:'nowrap',background:this.hexA(c,this.state.theme==='dark'?0.18:0.12),color:this.state.theme==='dark'?this.lighten(c):c,letterSpacing:'0.01em' }; }
  lighten(hex){ const h=hex.replace('#',''); let r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); r=Math.round(r+(255-r)*0.45);g=Math.round(g+(255-g)*0.45);b=Math.round(b+(255-b)*0.45); return `rgb(${r},${g},${b})`; }

  cardVM(a){
    const meta=this.stMeta(a.status); const late=this.isLate(a);
    const c = late ? '#C2410C' : meta.c;
    const mm=this.memberMeta(a.member);
    const step=this.nextStep(a);
    const bal=this.balance(a);
    const dark=this.state.theme==='dark';
    return {
      id:a.id,
      name:a.cust.name,
      vehicleLine:`${a.veh.year} ${a.veh.make} ${a.veh.model} · ${a.veh.color}`,
      short:`${a.veh.make} ${a.veh.model}`,
      service:a.svc,
      time:a.time,
      statusColor:c,
      badgeLabel: late ? 'Late' : meta.l,
      badgeStyle: this.badgeStyle(c),
      vip: !!a.vip,
      member: !!a.member,
      memberLabel: a.member ? a.member.split(' ')[0] : '',
      memberPlain: a.member || 'Non-member',
      memberStyle: mm ? { fontSize:'10px',fontWeight:800,padding:'2px 7px',borderRadius:'6px',background:dark?this.hexA(mm.c,0.2):mm.bg,color:dark?this.lighten(mm.c):mm.c,textTransform:'uppercase',letterSpacing:'0.03em' } : {},
      bayLabel: a.bay ? 'Bay '+a.bay : 'No bay',
      durLabel: 'Est. '+a.dur+' min',
      payLabel: a.pay==='paid'?'Paid':(a.pay==='deposit'?'Deposit · '+this.money(bal)+' due':this.money(bal)+' due'),
      payStyle: { fontSize:'11.5px',fontWeight:800, color: a.pay==='paid' ? (dark?'#5FC9A6':'#0D9488') : '#C2410C' },
      hasNotes: a.special || (a.notes && !a.notes.startsWith('No special')),
      hasPhotos: (a.photos.before+a.photos.after)>0,
      hasAddons: a.addons.length>0,
      addonCount: a.addons.length,
      iconWrap: { display:'inline-flex',alignItems:'center',gap:'6px' },
      nextLabel: step ? step.label : 'Completed',
      nextColor: step ? (dark?'var(--accentInk)':'var(--accent)') : 'var(--ink3)',
      nextStyle: { display:'flex',alignItems:'center',gap:'8px',marginTop:'10px',paddingTop:'10px',borderTop:'1px solid var(--line2)' },
      cardStyle: { position:'relative',zIndex:1,width:'100%',textAlign:'left',background:'var(--panel)',border:'1px solid var(--line)',borderRadius:'15px',padding:'13px 15px 13px 17px',boxShadow:'var(--shadow)',cursor:this.canDrag(a)?'grab':'pointer',transition:'transform .12s ease',touchAction:'pan-y',userSelect:'none',WebkitUserSelect:'none',WebkitTouchCallout:'none',opacity:this.state.dragId===a.id?0.45:1 },
      railStyle: { position:'absolute',left:0,top:'10px',bottom:'10px',width:'4px',borderRadius:'4px',background:c },
      chipStyle: { display:'inline-flex',alignItems:'center',gap:'9px',minHeight:'44px',padding:'8px 14px',background:'var(--panel2)',border:'1px solid var(--line)',borderLeft:'3px solid '+c,borderRadius:'11px',touchAction:'pan-y',userSelect:'none',WebkitUserSelect:'none',WebkitTouchCallout:'none',cursor:this.canDrag(a)?'grab':'pointer',opacity:this.state.dragId===a.id?0.45:1 },
      onPointerDown:(e)=>this.gStart(e,a,'tl'),
      onQDown:(e)=>this.gStart(e,a,'q'),
      onCalDown:(e)=>this.gStart(e,a,'cal'),
      open: () => this.openAppt(a),
      doNext: () => this.advance(a.id),
    };
  }

  renderVals(){
    const s=this.state; const dark=s.theme==='dark';
    const tabBtn=(active)=>({ height:'38px',padding:'0 16px',borderRadius:'10px',fontSize:'13px',fontWeight:700, background: active?'var(--panel)':'transparent', color: active?'var(--ink)':'var(--ink2)', boxShadow: active?'var(--shadow)':'none', border: active?'1px solid var(--line)':'1px solid transparent' });

    // range/search filter
    const q=s.search.trim().toLowerCase();
    const match=(a)=> !q || [a.cust.name,a.cust.phone,a.veh.make,a.veh.model,a.veh.color,a.veh.plate,a.svc].join(' ').toLowerCase().includes(q);
    let pool=s.appts.filter(match);
    if(s.range==='today') pool=pool.filter(a=>a.day===0);
    if(s.range==='tomorrow') pool=pool.filter(a=>a.day===1);

    const sorted=[...pool].sort((x,y)=>this.absMin(x)-this.absMin(y)||(y.vip?1:0)-(x.vip?1:0));

    // KPIs (always full day-0/1 set, not filtered)
    const all=s.appts;
    const day0=all.filter(a=>a.day===0);
    const active=all.filter(a=>a.status==='cleaning');
    const ready=all.filter(a=>a.status==='completed' && a.pickup!=='collected');
    const unpaid=all.filter(a=>a.day===0 && a.pay!=='paid' && !['canceled','noshow'].includes(a.status));
    const unpaidSum=unpaid.reduce((t,a)=>t+this.balance(a),0);
    const members=day0.filter(a=>a.member);
    const revenue=day0.filter(a=>a.pay==='paid').reduce((t,a)=>t+this.total(a).grand,0);
    const acc=['var(--accent)','#C2740B','#0E9E6E','#C2410C','#2563EB','#7A3B8A','#0D9488'];
    const kpis=[
      {label:'Appointments 24h',value:String(all.length),sub:'12 booked',accent:acc[0]},
      {label:'Active jobs',value:String(active.length),sub:'in bays',accent:acc[1]},
      {label:'Ready for pickup',value:String(ready.length),sub:ready.length?'notify':'clear',accent:acc[2]},
      {label:'Pending payments',value:String(unpaid.length),sub:this.money(unpaidSum),accent:acc[3]},
      {label:'Bay time free',value:'3.5h',sub:'today',accent:acc[4]},
      {label:'Members today',value:String(members.length),sub:'of '+day0.length,accent:acc[5]},
      {label:'Revenue today',value:this.money(revenue),sub:'paid',accent:acc[6]},
    ];

    // timeline groups (upcoming only — in-bay cars live in the Bays column, finished cars in Completed)
    const tlList=sorted.filter(a=>a.status!=='completed' && !this.inFacility(a));
    const groups=[]; let lastKey=null, lastDay=null;
    tlList.forEach(a=>{ const key=a.day+'|'+a.time;
      if(key!==lastKey){ const [hr,ap]=a.time.split(' '); groups.push({ key, day:a.day, time:hr, ampm:ap, items:[],
        dividerLabel: a.day===1 && lastDay!==1 ? 'Tomorrow' : (groups.length===0?'Today':''),
        dividerStyle: (a.day===1 && lastDay!==1) || groups.length===0 ? { fontSize:'11px',fontWeight:800,color:'var(--ink3)',textTransform:'uppercase',letterSpacing:'0.07em',padding:'6px 2px 8px' } : { display:'none' } });
        lastKey=key; lastDay=a.day; }
      groups[groups.length-1].items.push(this.cardVM(a));
    });

    // bays
    const bayVM=(num)=>{
      const occ=s.appts.find(a=>a.bay===num && this.inFacility(a));
      if(!occ){ const next=sorted.find(a=>a.bay===num && !this.inFacility(a) && a.status!=='completed');
        return { name:'Bay '+num, free:true, occupied:false,
          tagStyle:{ padding:'5px 12px',borderRadius:'9px',background:'var(--panel2)',border:'1px solid var(--line)',fontWeight:800,fontSize:'13px',color:'var(--ink2)' },
          nextUp: next? 'Next: '+next.cust.name+' · '+next.time : 'No vehicles queued',
          drop:'bay:'+num,
          shellStyle:{ background:'var(--panel)',border:'1px solid '+((s.dragId&&s.dropTarget==='bay:'+num)?'var(--accent)':(s.dragId?'var(--accentBrd)':'var(--line)')),borderRadius:'20px',padding:'20px',boxShadow:'var(--shadow)',transition:'border-color .12s ease' },
          dropZoneStyle:{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'30px 0 26px',textAlign:'center',borderRadius:'14px',border:'2px dashed '+((s.dragId&&s.dropTarget==='bay:'+num)?'var(--accent)':(s.dragId?'var(--accentBrd)':'transparent')),background:(s.dragId&&s.dropTarget==='bay:'+num)?'var(--accentSoft)':'transparent',transition:'all .12s ease' },
          assign: ()=> next? this.setState({selectedId:next.id,modalTab:'overview'}) : this.flash('Nothing queued','No vehicles waiting for Bay '+num) };
      }
      const meta=this.stMeta(occ.status); const step=this.nextStep(occ);
      const showProg = occ.status==='cleaning';
      const elapsedMs = occ.startedAt ? Date.now()-occ.startedAt : 0;
      const elapMin = Math.floor(elapsedMs/60000); const elapSec=Math.floor(elapsedMs/1000)%60;
      const pct = Math.min(100, occ.startedAt ? (elapsedMs/60000)/occ.dur*100 : 0);
      const etaMin = this.parseT(occ.time)+occ.dur;
      return { name:'Bay '+num, occupied:true, free:false,
        tagStyle:{ padding:'5px 12px',borderRadius:'9px',background:this.hexA(meta.c,dark?0.2:0.12),color:dark?this.lighten(meta.c):meta.c,fontWeight:800,fontSize:'13px' },
        badgeLabel:meta.l, badgeStyle:this.badgeStyle(meta.c),
        vehicle:`${occ.veh.year} ${occ.veh.make} ${occ.veh.model}`,
        customer:occ.cust.name, plate:occ.veh.plate, service:occ.svc, statusColor:meta.c,
        worker:occ.staff, workerInitials:occ.staff.split(' ').map(w=>w[0]).join(''),
        showProgress:showProg,
        elapsed: showProg ? `${elapMin}:${String(elapSec).padStart(2,'0')}` : '—',
        eta:this.fmtT(etaMin),
        progressStyle:{ height:'100%',width:pct+'%',background:meta.c,borderRadius:'6px',transition:'width 1s linear' },
        progressLabel: Math.round(pct)+'% complete',
        durLabel: occ.dur+' min',
        drop:'bay:'+num,
        shellStyle:{ background:'var(--panel)',border:'1px solid var(--line)',borderLeft:'4px solid '+meta.c,borderRadius:'20px',padding:'20px',boxShadow:'var(--shadow)',outline:(s.dragId&&s.dropTarget==='bay:'+num)?'2px dashed #C2410C':'none' },
        nextLabel: step?step.label:'Completed',
        primaryStyle:{ flex:1,height:'52px',background:'var(--accent)',color:'#fff',borderRadius:'13px',fontWeight:800,fontSize:'15px',boxShadow:'0 8px 18px var(--accentSoft)' },
        open:()=>this.setState({selectedId:occ.id,modalTab:'overview'}),
        doNext:()=>this.advance(occ.id) };
    };
    const bays=[bayVM(1),bayVM(2)];
    const arrivals=s.appts.filter(a=>a.eta&&['confirmed','booked'].includes(a.status)).sort((x,y)=>(y.vip?1:0)-(x.vip?1:0)||x.eta-y.eta).map(a=>({
      title:(a.vip?'VIP arriving in ':'Arriving in ')+a.eta+' min · '+a.cust.name,
      desc:'Geofence ETA · '+a.veh.year+' '+a.veh.make+' '+a.veh.model+' · '+a.svc.split(' + ')[0]+(a.bay?' · Bay '+a.bay:''),
      style:{ display:'flex',alignItems:'center',gap:'12px',padding:'13px 14px',borderRadius:'16px',flexWrap:'wrap',background:a.vip?(dark?'rgba(122,59,138,.2)':'#F3E8F6'):'var(--panel)',border:'1px solid '+(a.vip?'rgba(122,59,138,.4)':'var(--line)') },
      dot:{ width:'10px',height:'10px',borderRadius:'50%',flex:'none',background:a.vip?'#7A3B8A':'#2563EB' },
      prepLabel:a.prepped?'Bay '+(a.bay||'')+' ready ✓':'Prep Bay '+(a.bay||'—'),
      prepStyle:{ height:'44px',padding:'0 14px',borderRadius:'11px',fontWeight:800,fontSize:'12.5px',background:a.prepped?'var(--accentSoft)':(a.vip?'#7A3B8A':'var(--accent)'),color:a.prepped?'var(--accentInk)':'#fff' },
      prep:()=>this.prepBay(a.id), arrive:()=>this.simArrive(a.id) }));
    const inFac=s.appts.filter(a=>this.inFacility(a)).length;

    // queue (bay view)
    const queue=sorted.filter(a=>!this.inFacility(a) && a.status!=='completed' && a.status!=='paid').sort((x,y)=>(y.vip?1:0)-(x.vip?1:0)).slice(0,6).map(a=>this.cardVM(a));

    // completed / pickup column (column 3)
    const completedList=sorted.filter(a=>a.status==='completed');
    const completedJobs=completedList.map(a=>{
      const paid=a.pay==='paid'; const collected=a.pickup==='collected';
      const accent = (collected && paid) ? '#0E9E6E' : (!paid ? '#C2410C' : '#B07908');
      const chip=(active,c)=>({ height:'34px',padding:'0 13px',borderRadius:'9px',fontWeight:800,fontSize:'12px',display:'inline-flex',alignItems:'center',gap:'6px',cursor:'pointer',
        background: active?this.hexA(c,dark?0.22:0.14):'var(--panel)', color: active?(dark?this.lighten(c):c):'var(--ink3)', border:'1px solid '+(active?this.hexA(c,0.32):'var(--line)') });
      return { id:a.id, name:a.cust.name, vehicleLine:`${a.veh.year} ${a.veh.make} ${a.veh.model} · ${a.veh.color}`, service:a.svc, time:a.time, accent,
        shellStyle:{ position:'relative',padding:'14px 15px 14px 18px',background:'var(--panel2)',border:'1px solid var(--line)',borderRadius:'15px' },
        payChipLabel: paid?'Paid':'Unpaid · collect', payChipStyle: chip(!paid,'#C2410C'),
        pickupChipLabel: collected?'Picked up':'Needs pickup', pickupChipStyle: chip(!collected,'#0E7A63'),
        togglePay:()=>this.togglePay(a.id), togglePickup:()=>this.togglePickup(a.id),
        open:()=>this.setState({selectedId:a.id,modalTab:'overview'}) };
    });
    const completedCount=completedJobs.length;

    // alerts
    const alerts=[];
    const A=(o)=>alerts.push(o);
    const tone={ red:{c:'#C2410C',bg:dark?'rgba(194,65,12,.14)':'#FBEAE0'}, amber:{c:'#B07908',bg:dark?'rgba(176,121,8,.14)':'#FAF0D8'}, blue:{c:'#2563EB',bg:dark?'rgba(37,99,235,.14)':'#E5EEFD'}, green:{c:'#0E9E6E',bg:dark?'rgba(14,158,110,.14)':'#DCF1E8'}, violet:{c:'#7A3B8A',bg:dark?'rgba(122,59,138,.16)':'#F0E3F4'} };
    const mkAlert=(t,glyph,title,desc,actionLabel,fn,id)=>{ const tn=tone[t]; A({
      shellStyle:{ padding:'13px 14px',background:tn.bg,border:'1px solid '+this.hexA(tn.c,0.2),borderRadius:'14px' },
      iconStyle:{ width:'34px',height:'34px',borderRadius:'10px',background:this.hexA(tn.c,dark?0.28:0.16),color:dark?this.lighten(tn.c):tn.c,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'16px',flex:'none' },
      glyph, title, desc, actionLabel,
      actionStyle:{ height:'38px',padding:'0 15px',background:tn.c,color:'#fff',borderRadius:'10px',fontWeight:700,fontSize:'12.5px' },
      action:fn, pri:(id&&this.byId(id)&&this.byId(id).vip)?1:0, open:()=> id?this.setState({selectedId:id,modalTab:'overview'}):null });
    };
    s.appts.forEach(a=>{
      if(a.status==='completed' && a.pickup!=='collected') mkAlert('green','↑','Ready for pickup',`${a.cust.name}'s ${a.veh.make} is done`+(a.pay!=='paid'?' · payment due':''),'Mark picked up',()=>this.togglePickup(a.id),a.id);
      if(this.isLate(a)) mkAlert('red','!',`Running late · ${a.cust.name}`,`${a.time} ${a.veh.make} ${a.veh.model} — no arrival logged`,'Message customer',()=>this.flash('Reminder sent','WhatsApp to '+a.cust.name),a.id);
      if(a.bay===null && a.status!=='completed') mkAlert('amber','◳','Needs bay assignment',`${a.cust.name} · ${a.svc}`,'Assign bay',()=>this.setState({selectedId:a.id,modalTab:'overview'}),a.id);
      if(a.status==='confirmed' && !a.eta && this.absMin(a)-s.NOW>0 && this.absMin(a)-s.NOW<=15) mkAlert('blue','→','Arriving soon',`${a.cust.name} in ${this.absMin(a)-s.NOW} min · ${a.veh.make} ${a.veh.model}`,'Prep bay '+(a.bay||'—'),()=>this.flash('Bay prepped','Ready for '+a.cust.name),a.id);
      if(a.status==='booked') mkAlert('amber','?','Unconfirmed',`${a.cust.name} · ${a.time} hasn't confirmed`,'Send reminder',()=>this.advance(a.id),a.id);
      if(a.special) mkAlert('violet','★','Special instructions',`${a.cust.name}: ${a.special.slice(0,46)}…`,'View file',()=>this.setState({selectedId:a.id,modalTab:'overview'}),a.id);
    });
    s.appts.forEach(a=>{
      if(a.eta && ['confirmed','booked'].includes(a.status)) mkAlert(a.vip?'violet':'blue','◎',(a.vip?'VIP arriving in ':'Arriving in ')+a.eta+' min · '+a.cust.name,'Geofence ETA · '+a.veh.make+' '+a.veh.model+(a.bay?' · Bay '+a.bay:''),a.prepped?'Bay ready ✓':'Prep bay '+(a.bay||'—'),()=>this.prepBay(a.id),a.id);
      if(a.geoIn && a.status==='arrived') mkAlert('green','✓','Auto checked in · '+a.cust.name,'Geofence at '+a.geoIn+' · vehicle in the lot','Start cleaning',()=>this.advance(a.id),a.id);
    });
    // membership credit upsell
    const pm=s.appts.find(a=>a.member==='Premium' && a.status==='completed' && a.pay!=='paid');
    if(pm) mkAlert('blue','◆','Member credit available',`${pm.cust.name} has 1 unused Premium credit this cycle`,'Apply credit',()=>this.flash('Credit applied','1 Premium credit redeemed'),pm.id);

    alerts.sort((x,y)=>(y.pri||0)-(x.pri||0));
    // staff columns
    const staffNames=['Marco R.','Lena K.','Sofia D.','Unassigned'];
    const roles={'Marco R.':'Lead Detailer','Lena K.':'Detailer','Sofia D.':'Front Desk','Unassigned':'Queue'};
    const avatarColors={'Marco R.':'#2563EB','Lena K.':'#0E9E6E','Sofia D.':'#7A3B8A','Unassigned':'#6B7280'};
    const staffCols=staffNames.map(nm=>{ const jobs=sorted.filter(a=>a.staff===nm).map(a=>this.cardVM(a));
      return { name:nm==='Unassigned'?'Unassigned':nm, role:roles[nm], initials:nm==='Unassigned'?'—':nm.split(' ').map(w=>w[0]).join(''),
        avatarStyle:{ width:'40px',height:'40px',borderRadius:'12px',background:this.hexA(avatarColors[nm],dark?0.22:0.14),color:dark?this.lighten(avatarColors[nm]):avatarColors[nm],display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'14px',flex:'none' },
        count:jobs.length, jobs, empty:jobs.length===0 }; });

    const cal=this.calVM();

    // range + view tabs
    const ranges=[['next24','Next 24h'],['today','Today'],['tomorrow','Tomorrow'],['week','Week']];
    const rangeTabs=ranges.map(([k,l])=>({ label:l, onClick:()=>this.setState({range:k}),
      style:{ height:'36px',padding:'0 14px',borderRadius:'10px',fontSize:'13px',fontWeight:700, background: s.range===k?'var(--accent)':'transparent', color: s.range===k?'#fff':'var(--ink2)', whiteSpace:'nowrap' } }));
    const ic={
      timeline:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      bay:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="8" height="16" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="4" width="8" height="16" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
      staff:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.5M18 13a5 5 0 013 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      calendar:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    };
    const renderIcon=(svg)=>React.createElement('span',{dangerouslySetInnerHTML:{__html:svg}});
    const views=[['timeline','Timeline'],['bay','Bay Board'],['staff','Staff'],['calendar','Calendar']];
    const viewTabs=views.map(([k,l])=>({ label:l, icon:renderIcon(ic[k]), onClick:()=>this.setState({view:k}),
      style:{ display:'flex',alignItems:'center',gap:'8px',height:'40px',padding:'0 18px',borderRadius:'11px',fontSize:'13.5px',fontWeight:700, background:s.view===k?'var(--panel2)':'transparent', color:s.view===k?'var(--ink)':'var(--ink2)', border:s.view===k?'1px solid var(--line)':'1px solid transparent' } }));

    // selected modal VM
    const sa=s.selectedId?this.byId(s.selectedId):null;
    let sel=null;
    if(sa){ this.ensureActivity(sa);
      const meta=this.stMeta(sa.status); const mm=this.memberMeta(sa.member); const step=this.nextStep(sa);
      const t=this.total(sa); const bal=this.balance(sa);
      const order=s.ORDER; const stageLabels={booked:'Booked',confirmed:'Confirmed',arrived:'Arrived',cleaning:'In Wash',completed:'Done'};
      const curIdx=order.indexOf(sa.status);
      const stages=order.map((st,i)=>{ const done=i<curIdx, cur=i===curIdx; const c='var(--accent)';
        return { label:stageLabels[st],
          mark: done?'✓':String(i+1),
          dotStyle:{ width:'30px',height:'30px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:'12px', background: cur?'var(--accent)':(done?'var(--accentSoft)':'var(--panel3)'), color: cur?'#fff':(done?'var(--accentInk)':'var(--ink3)'), border: cur?'2px solid var(--accent)':'none' },
          labelStyle:{ fontSize:'10.5px',fontWeight:700,textAlign:'center',color: (cur||done)?'var(--ink)':'var(--ink3)' },
          lineStyle:{ width:'18px',height:'2px',background: i<order.length-1 ? (i<curIdx?'var(--accent)':'var(--line)') : 'transparent' } };
      });
      const ckv=this.checkVM(sa); const checkDone=ckv.checkDone; const checkTotal=ckv.checkTotal;
      const pct = checkTotal?Math.round(checkDone/checkTotal*100):0;
      const tabIcons={
        overview:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
        checklist:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6l2 2 3-3M4 13l2 2 3-3M4 20l2 2 3-3M13 6h7M13 13h7M13 20h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        addons:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        photos:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="2"/><path d="M8 6l1.5-2h5L16 6" stroke="currentColor" stroke-width="2"/></svg>',
        messages:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
        payments:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>',
        membership:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 16.5 7.1 21l.9-5.5-4-3.9 5.5-.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
        history:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v3h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      };
      const tabDefs=[['overview','Overview',null],['checklist','Checklist',checkDone+'/'+checkTotal],['addons','Add-ons',sa.addons.length||null],['photos','Photos',null],['messages','Messages',sa.messages.length],['payments','Payments',null],['membership','Membership',null],['history','History',null]];
      const tabs=tabDefs.map(([k,l,cnt])=>({ label:l, count:cnt, icon:renderIcon(tabIcons[k]),
        countStyle:{ minWidth:'20px',height:'20px',padding:'0 6px',borderRadius:'7px',background: s.modalTab===k?'var(--accent)':'var(--panel3)', color: s.modalTab===k?'#fff':'var(--ink3)', fontSize:'11px',fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center' },
        style:{ display:'flex',alignItems:'center',gap:'11px',height:'44px',padding:'0 14px',borderRadius:'12px',fontSize:'14px',fontWeight:700, background: s.modalTab===k?'var(--accentSoft)':'transparent', color: s.modalTab===k?'var(--accentInk)':'var(--ink2)' },
        onClick:()=>this.setState({modalTab:k}) }));

      const payRows=[
        {label:sa.svc, val:this.money(t.sub-t.addon), kind:'item'},
        ...sa.addons.map(x=>({label:'+ '+x.name, val:this.money(x.price), kind:'addon'})),
        ...(t.tip?[{label:'Tip', val:this.money(t.tip), kind:'item'}]:[]),
        {label:'Tax (7%)', val:this.money(t.tax), kind:'item'},
        {label:'Total', val:this.money(t.grand), kind:'total'},
        ...(sa.pay==='deposit'?[{label:'Deposit paid', val:'– '+this.money(sa.deposit), kind:'paid'}]:[]),
      ].map(r=>({ label:r.label, val:r.val,
        style:{ display:'flex',justifyContent:'space-between',alignItems:'center',padding: r.kind==='total'?'14px 0 6px':'8px 0', borderTop: r.kind==='total'?'1px solid var(--line)':'none', marginTop: r.kind==='total'?'6px':'0' },
        labelStyle:{ fontSize: r.kind==='total'?'15px':'13.5px', fontWeight: r.kind==='total'?800:600, color: r.kind==='addon'?'var(--accentInk)':(r.kind==='paid'?'#0E9E6E':'var(--ink2)') },
        valStyle:{ fontSize: r.kind==='total'?'18px':'14px', fontWeight: r.kind==='total'?800:700, color: r.kind==='paid'?'#0E9E6E':'var(--ink)', fontFamily: r.kind==='total'?"'Bricolage Grotesque',sans-serif":'inherit' } }));

      const perksByPlan={ Essential:['2 express washes / month','Priority booking','10% off add-ons','Free vacuum anytime'],
        Premium:['2 premium washes / month','Skip-the-line priority','15% off all add-ons','Monthly interior refresh','Free rain repellent'],
        Executive:['Unlimited express washes','2 executive details / month','20% off add-ons','Dedicated detailer','Loaner coordination'],
        Exotic:['Unlimited hand washes','Concierge pickup & delivery','Paint protection reviews','25% off all services','Private appointment windows'] };
      const planKey=sa.member?sa.member.split(' ')[0]:null;
      const planTint={ Essential:'#5E7A52', Premium:'#8A6D3B', Executive:'#3B5A8A', Exotic:'#7A3B8A' }[planKey]||'#8A6D3B';

      sel={
        id:sa.id, name:sa.cust.name, initials:sa.cust.name.split(' ').map(w=>w[0]).join('').slice(0,2),
        vehicle:`${sa.veh.year} ${sa.veh.make} ${sa.veh.model}`, vehicleLine:`${sa.veh.year} ${sa.veh.make} ${sa.veh.model} · ${sa.veh.color}`,
        color:sa.veh.color, plate:sa.veh.plate, phone:sa.cust.phone,
        when: (sa.day===1?'Tomorrow ':'Today ')+sa.time+' · '+sa.svc.split(' + ')[0],
        time:sa.time, service:sa.svc, durLabel:sa.dur+' min', bayLabel:sa.bay?'Bay '+sa.bay:'Unassigned', worker:sa.staff,
        badgeLabel: this.isLate(sa)?'Late':meta.l, badgeStyle:this.badgeStyle(this.isLate(sa)?'#C2410C':meta.c),
        member:!!sa.member, noMember:!sa.member, memberLabel:sa.member?sa.member.split(' ')[0]:'', memberPlain:sa.member||'Non-member',
        memberStyle: mm?{ fontSize:'11px',fontWeight:800,padding:'3px 9px',borderRadius:'7px',background:dark?this.hexA(mm.c,0.2):mm.bg,color:dark?this.lighten(mm.c):mm.c,textTransform:'uppercase',letterSpacing:'0.03em' }:{},
        vip:!!sa.vip, notes:sa.notes, special:sa.special,
        payLabel: sa.pay==='paid'?'Paid in full':(sa.pay==='deposit'?'Deposit · '+this.money(bal)+' due':this.money(bal)+' due'),
        payColor: sa.pay==='paid'?(dark?'#5FC9A6':'#0D9488'):'#C2410C',
        stages,
        // tabs
        tabs,
        tabOverview:s.modalTab==='overview', tabChecklist:s.modalTab==='checklist', tabAddons:s.modalTab==='addons',
        tabPhotos:s.modalTab==='photos', tabMessages:s.modalTab==='messages', tabPayments:s.modalTab==='payments',
        tabMembership:s.modalTab==='membership', tabHistory:s.modalTab==='history',
        ...ckv,
        // addons
        addonTotal:this.money(t.addon),
        addonCatalog:s.ADDONS.map(([name,price])=>{ const on=!!sa.addons.find(x=>x.name===name);
          return { name, price:this.money(price), on, toggle:()=>this.toggleAddon(sa.id,name,price),
            rowStyle:{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 15px',background: on?'var(--accentSoft)':'var(--panel)',border:'1px solid '+(on?'var(--accentBrd)':'var(--line)'),borderRadius:'12px' },
            boxStyle:{ width:'22px',height:'22px',borderRadius:'7px',flex:'none',display:'flex',alignItems:'center',justifyContent:'center', background:on?'var(--accent)':'transparent', border:on?'none':'2px solid var(--ink3)' } }; }),
        // photos
        photoSections:[
          { title:'Arrival', count:sa.photos.arrival+' photos', tag:'Captured', tagStyle:this.tagS(dark,'#0E9E6E'), slots:this.slots(sa.photos.arrival) },
          { title:'Before', count:sa.photos.before+' photos', tag:sa.photos.before?'Captured':'Pending', tagStyle:this.tagS(dark,sa.photos.before?'#0E9E6E':'#6B7280'), slots:this.slots(sa.photos.before) },
          { title:'After', count:sa.photos.after+' photos', tag:sa.photos.after?'Captured':'Pending', tagStyle:this.tagS(dark,sa.photos.after?'#0E9E6E':'#6B7280'), slots:this.slots(sa.photos.after) },
          { title:'Damage / Issues', count:sa.photos.issue+' notes', tag:sa.photos.issue?'Flagged':'None', tagStyle:this.tagS(dark,sa.photos.issue?'#C2410C':'#6B7280'), slots:this.slots(sa.photos.issue) },
        ],
        // messages
        messages:sa.messages.map(m=>{ const out=m.from==='staff'||m.from==='system';
          return { text:m.text, time:m.time, channelTag: m.from==='system'?'Automated · '+m.channel:(m.from==='staff'?null:null),
            rowStyle:{ display:'flex', justifyContent: out?'flex-end':'flex-start' },
            bubbleStyle:{ maxWidth:'78%',padding:'11px 14px',borderRadius: out?'15px 15px 4px 15px':'15px 15px 15px 4px', background: m.from==='system'?'var(--accentSoft)':(out?'var(--accent)':'var(--panel)'), color: m.from==='system'?'var(--accentInk)':(out?'#fff':'var(--ink)'), border: out&&m.from!=='system'?'none':'1px solid var(--line)' },
            tagStyle:{ fontSize:'10px',fontWeight:800,textTransform:'uppercase',letterSpacing:'0.04em',opacity:0.7,marginBottom:'4px' },
            timeStyle:{ fontSize:'10.5px',fontWeight:600,marginTop:'5px',opacity:0.65 } }; }),
        templates:[
          ['Confirmed','Your appointment is confirmed. See you soon!'],
          ['We\u2019re ready','We\u2019re ready for you — come on in!'],
          ['Checked in','Your vehicle has been checked in.'],
          ['Being cleaned','Your vehicle is now being cleaned.'],
          ['Ready for pickup','Your vehicle is ready for pickup!'],
          ['Approve add-on?','We recommend an add-on — would you like to approve it?'],
          ['Payment link','Here is your secure payment link.'],
        ].map(([label,text])=>({ label, send:()=>this.sendTemplate(sa.id,text) })),
        // payments
        payRows,
        payStatusLabel: sa.pay==='paid'?'Paid in full':(sa.pay==='deposit'?'Balance due':'Awaiting payment'),
        payBig: sa.pay==='paid'?this.money(t.grand):this.money(bal),
        payMethod: sa.pay==='paid'?'Visa ···· 4421':'No payment on file',
        payCardStyle:{ padding:'20px',borderRadius:'16px', background: sa.pay==='paid'?'var(--accentSoft)':'var(--ink)', color: sa.pay==='paid'?'var(--accentInk)':'var(--bg)' },
        showCollect: sa.pay!=='paid', isPaid: sa.pay==='paid',
        collect:()=>this.collect(sa.id), sendLink:()=>this.flash('Payment link sent','Secure link via WhatsApp'),
        // membership
        memberCardStyle:{ padding:'24px',borderRadius:'18px',background:`linear-gradient(135deg, ${planTint}, ${this.hexA(planTint,0.78)})`,color:'#fff',boxShadow:'0 12px 30px '+this.hexA(planTint,0.35) },
        renewDate:'Jul 12, 2026', creditsLeft: planKey==='Executive'||planKey==='Exotic'?'∞':String(1), creditsUsed:String(planKey==='Premium'?1:0), memberMonths:String(8+(sa.visits%6)),
        perks:(perksByPlan[planKey]||[]),
        riskStyle:{ padding:'16px',borderRadius:'14px',background: sa.visits>6?'var(--accentSoft)':'#FBEAE0', color: sa.visits>6?'var(--accentInk)':'#C2410C' },
        riskLabel: sa.visits>6?'Loyal · low risk':'Watch · 1 missed visit',
        riskDesc: sa.visits>6?'Consistent monthly usage — strong retention':'Down from 3 to 1 visit last month',
        // history
        history:sa.history, visitCount:String(sa.visits), lifetimeSpend:this.money(sa.visits*148), avgFreq:'18 days',
        // actions
        nextLabel: step?step.label:'', hasNext:!!step, done:!step,
        nextHint: step? this.hintFor(sa,step) : 'Job complete — closed and archived',
        doNext:()=>this.advance(sa.id),
        quickMsg:()=>{ this.setState({modalTab:'messages'}); },
      };
    }

    const newServices=Object.keys(s.services).slice(0,5).map(name=>({ name, dur:'Est. '+s.services[name].dur+' min', price:this.money(s.services[name].price),
      pick:()=>this.setState({pickedService:name}),
      style:{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 15px',borderRadius:'12px',background: s.pickedService===name?'var(--accentSoft)':'var(--panel)',border:'1px solid '+(s.pickedService===name?'var(--accentBrd)':'var(--line)') } }));
    const slotTimes=['10:30 AM','11:00 AM','11:30 AM','12:30 PM','1:00 PM','2:30 PM','4:00 PM','4:30 PM'];
    const blocked=['11:00 AM','1:00 PM'], vipHeld=['11:30 AM','12:30 PM'];
    const newSlots=slotTimes.map(t=>{ const off=blocked.includes(t), held=vipHeld.includes(t);
      return { label:held?t+' · VIP':t, pick:()=> off?this.flash('Slot unavailable','Would overbook a bay — override required'):(held?this.flash('Held for VIP clients','Releases to everyone 48h before · VIP clients can book it now'):this.setState({pickedSlot:t})),
        style:{ height:'42px',borderRadius:'11px',fontSize:'13px',fontWeight:700, cursor:off?'not-allowed':'pointer',
          background: off?'var(--panel3)':(s.pickedSlot===t?'var(--accent)':'var(--panel)'), color: off?'var(--ink3)':(s.pickedSlot===t?'#fff':'var(--ink)'), border:'1px solid '+(s.pickedSlot===t&&!off?'var(--accent)':'var(--line)'), opacity:off?0.6:1 } }; });

    return {
      theme:s.theme, isDark:dark, isLight:!dark,
      toggleTheme:()=>{ const t=dark?'light':'dark'; try{ localStorage.setItem('oasis-theme',t); }catch(e){} this.setState({theme:t}); },
      showRange:s.view!=='calendar',
      dragging:!!s.dragId, ghostRef:this.ghostRef, ghostName:s.ghost?s.ghost.name:'', ghostVehicle:s.ghost?s.ghost.vehicle:'', ghostHint:s.ghost?s.ghost.hint:'',
      preventCtx:(e)=>e.preventDefault(),
      emergencyOn:!!(s.emergency&&s.emergency.active), emergencyText:s.emergency&&s.emergency.summary?s.emergency.summary:'',
      view:s.view, isTimeline:s.view==='timeline', isBay:s.view==='bay', isStaff:s.view==='staff', isCalendar:s.view==='calendar',
      search:s.search, onSearch:(e)=>this.setState({search:e.target.value}),
      rangeTabs, viewTabs,
      openNew:()=>this.setState({newOpen:true,newTitle:'New Appointment'}),
      openWalkin:()=>this.setState({newOpen:true,newTitle:'Walk-in Booking'}),
      closeNew:()=>this.setState({newOpen:false}), newOpen:s.newOpen, newTitle:s.newTitle,
      newServices, newSlots, createAppt:()=>{ this.setState({newOpen:false}); this.flash('Appointment booked',s.pickedService+' · '+s.pickedSlot); },
      kpis, groups, apptCount:tlList.length, bays, arrivals, inFacilityLabel:inFac+' in facility',
      completedJobs, completedCount, noCompleted: completedJobs.length===0,
      queue, alerts, alertCount:alerts.length, staffCols, ...cal,
      clockLabel:'Live · '+this.nowClock(),
      dateLabel:'Saturday, June 13',
      modalOpen:!!sa, sel, closeModal:()=>this.setState({selectedId:null}), stop:(e)=>e.stopPropagation(),
      toast:s.toast, toastTitle:s.toast?s.toast.title:'', toastDesc:s.toast?s.toast.desc:'',
    };
  }

  hintFor(a,step){
    const m={ confirmed:'Customer hasn\u2019t confirmed — send the reminder',
      arrived:'Mark arrived once the customer pulls in',
      cleaning:'Drag the card onto an open bay, or start the wash here',
      completed:'Wash finished — mark complete and move it to pickup',
      pay:'Collect '+this.money(this.balance(a))+' before release' };
    return m[step.to]||'';
  }
  tagS(dark,c){ return { fontSize:'11px',fontWeight:800,padding:'3px 9px',borderRadius:'7px',background:this.hexA(c,dark?0.2:0.13),color:dark?this.lighten(c):c,textTransform:'uppercase',letterSpacing:'0.03em' }; }
  slots(n){ const out=[]; for(let i=0;i<3;i++){ if(i<n) out.push({ icon:true, style:{ aspectRatio:'4/3',borderRadius:'11px',background:'var(--panel3)',border:'1px solid var(--line)',display:'flex',alignItems:'center',justifyContent:'center' } }); else { out.push({ add:true, style:{ aspectRatio:'4/3',borderRadius:'11px',background:'var(--panel)',border:'1.5px dashed var(--line)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer' } }); break; } } return out; }
}
