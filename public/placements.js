/* ===================== PLACEMENTS =====================
   Internship placement for students. Not every course has an internship track — it's a per-course flag
   (Course settings > "Offers internship placement"). A placement PARTNER is either DesGro (in-house) or
   an outside company; each partner carries its own list of POSITIONS (role, seats, paid/unpaid stipend).
   A PLACEMENT is one student's journey: Registered (in the pool, waiting) → Placed (interning at a
   partner, optionally against a specific position) → Completed, or Withdrawn. Reviews live on the
   placement itself, one each way: partnerReview (the student rating the partner) and studentReview (the
   partner rating the student). Anu (placements) manages all of it from the Placements module. */
// Placements is for Academics staff (and anyone whose role is placements) plus Leadership, who see every module.
// Mirrors hasPlacementsAccess() in lib/policy.js, which is what the server actually enforces.
function hasPlacementsAccess(emp){ return !!(emp && (emp.dept==='Academics' || /placement/i.test(emp.role||""))); }
// Whoever's role is placements lands straight on the Placements module when they sign in.
function isPlacementRole(emp){ return !!(emp && /placement/i.test(emp.role||"")); }
function canUsePlacements(){ return !!currentUser && (isLeadershipRole(currentUser) || hasPlacementsAccess(currentUser)); }
const PLACEMENT_STATUSES = ["Registered","Placed","Completed","Withdrawn"];
const POSITION_MODES = ["On-site","Remote","Hybrid"];
function placementStatusKind(s){ return {Registered:"warn",Placed:"blue",Completed:"pos",Withdrawn:"neutral"}[s] || "neutral"; }
function courseOffersInternship(name){ return !!courseSettingsOf(name).internship; }
function internshipCourses(){ return COURSES.filter(courseOffersInternship); }
// Partners (each with its own positions) and placements are synced to the server like every other collection.
let placementPartners = [];
let placements = [];
// Next id for a collection, one above the highest existing number (survives reloads and other people's records).
function nextPlacementId(prefix, rows){
  const re = new RegExp('^'+prefix+'-(\\d+)$');
  return prefix+'-'+String(rows.reduce((m,x)=>{ const r = re.exec(String(x && x.id)); return r ? Math.max(m, Number(r[1])) : m; }, 0)+1).padStart(2,'0');
}

const partnerById = id => placementPartners.find(p=>p.id===id);
function positionById(partnerId, posId){ const p = partnerById(partnerId); return p ? (p.positions||[]).find(x=>x.id===posId) : null; }
function placementsOfPartner(pid){ return placements.filter(x=>x.partnerId===pid); }
function activePlacementOf(studentId){ return placements.find(x=>x.studentId===studentId && x.status!=="Withdrawn"); }
function holdsSeat(pl){ return pl.status==="Placed" || pl.status==="Completed"; }
function positionFilled(pos){ return placements.filter(x=>x.positionId===pos.id && holdsSeat(x)).length; }
function positionOpenNow(pos){ return pos.status==="Open" ? Math.max(0,(pos.openings||0)-positionFilled(pos)) : 0; }
function partnerOpenSlots(p){ return (p.positions||[]).reduce((s,x)=>s+positionOpenNow(x),0); }
function partnerOpenRoles(p){ return (p.positions||[]).filter(x=>positionOpenNow(x)>0); }
function partnerStipendLabel(p){
  const open = partnerOpenRoles(p);
  const src = open.length ? open : (p.positions||[]);
  if(!src.length) return "—";
  const paid = src.some(x=>x.stipend==="Paid"), unpaid = src.some(x=>x.stipend==="Unpaid");
  return paid && unpaid ? "Mixed" : (paid ? "Paid" : "Unpaid");
}
function stipendKind(label){ return {Paid:"pos",Unpaid:"neutral",Mixed:"blue"}[label] || "neutral"; }
function stipendText(pos){ return pos.stipend==="Paid" ? inr(pos.stipendAmount)+"/mo" : "Unpaid"; }
function partnerStats(p){
  const L = placementsOfPartner(p.id);
  return {total:L.filter(holdsSeat).length, current:L.filter(x=>x.status==="Placed").length, completed:L.filter(x=>x.status==="Completed").length, withdrawn:L.filter(x=>x.status==="Withdrawn").length};
}
function avgRating(vals){ const v = vals.filter(x=>x>0); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; }
function partnerRating(p){ const rs = placementsOfPartner(p.id).map(x=>x.partnerReview).filter(Boolean).map(r=>r.rating); return {avg:avgRating(rs), n:rs.length}; }
function starsHTML(n){ const k = Math.round(n||0); return `<span style="color:var(--warn);letter-spacing:1px;">${"★".repeat(k)}<span style="color:var(--line);">${"★".repeat(5-k)}</span></span>`; }
function ratingCell(avg, n){ return avg==null ? '<span class="faint">No reviews</span>' : `${starsHTML(avg)} <span class="mono" style="font-size:12px;">${avg.toFixed(1)}</span> <span class="faint" style="font-size:11px;">(${n})</span>`; }
function placementStudentName(pl){ const s = studentById(pl.studentId); return s ? s.name : "—"; }
function placementPositionLabel(pl){ const pos = pl.partnerId ? positionById(pl.partnerId, pl.positionId) : null; return pos ? pos.title : (pl.partnerId ? "General" : ""); }
function placementDateLabel(pl){
  if(!pl.startDate && !pl.endDate) return '<span class="faint">—</span>';
  return fmtDateShort(pl.startDate) + (pl.endDate ? " → " + fmtDateShort(pl.endDate) : " → ongoing");
}
function partnerLink(pid){ const p = partnerById(pid); return p ? `<a href="javascript:void(0)" onclick="event.stopPropagation();openPartnerDetail('${p.id}')" style="color:var(--brand-strong);font-weight:700;">${esc(p.name)}</a>` : '<span class="faint">—</span>'; }
function pendingPlacementPool(){ return placements.filter(x=>x.status==="Registered"); }

function openPartnerDetail(id){ nav.module = "placements"; nav.detail = {type:'partner', id}; render(); }

/* ---- Overview ---- */
let placementPartnerTypeFilter = "All", placementPartnerStipendFilter = "All";
let placementStatusFilter = "All";
let placementPositionFilter = {stipend:"All", open:"Open"};
function setPlacementPartnerTypeFilter(v){ placementPartnerTypeFilter = v; render(); }
function setPlacementPartnerStipendFilter(v){ placementPartnerStipendFilter = v; render(); }
function setPlacementStatusFilter(v){ placementStatusFilter = v; render(); }
function setPlacementPositionStipendFilter(v){ placementPositionFilter.stipend = v; render(); }
function setPlacementPositionOpenFilter(v){ placementPositionFilter.open = v; render(); }

function placementsOverview(){
  const pool = pendingPlacementPool();
  const activePartners = placementPartners.filter(p=>p.status==="Active");
  const openSeats = placementPartners.filter(p=>p.status==="Active").reduce((s,p)=>s+partnerOpenSlots(p),0);
  const interning = placements.filter(x=>x.status==="Placed").length;
  const completed = placements.filter(x=>x.status==="Completed").length;
  const ranked = placementPartners.map(p=>({p, st:partnerStats(p), r:partnerRating(p)})).filter(x=>x.st.total>0).sort((a,b)=>b.st.total-a.st.total || (b.r.avg||0)-(a.r.avg||0));
  const track = internshipCourses();
  return `
  <div class="toolbar"><div></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn" onclick="openPartnerModal()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add partner</button><button class="btn primary" onclick="openRegisterPlacement()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Register students</button></div></div>
  <div class="kpi-grid cols-5">
    <div class="kpi-card"><div class="kpi-label">Active Partners</div><div class="kpi-value mono">${activePartners.length}</div><div class="kpi-sub">${placementPartners.length} in database</div></div>
    <div class="kpi-card"><div class="kpi-label">Open Seats</div><div class="kpi-value mono">${openSeats}</div><div class="kpi-sub">across active partners</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Awaiting Placement</div><div class="kpi-value mono ${pool.length?'warn':''}">${pool.length}</div></div>
    <div class="kpi-card"><div class="kpi-label">Interning Now</div><div class="kpi-value mono">${interning}</div></div>
    <div class="kpi-card"><div class="kpi-label">Completed</div><div class="kpi-value mono pos">${completed}</div></div>
  </div>
  <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Internship track: ${track.length?track.map(esc).join(' · '):'<b>no course has one yet</b>'}. Turn it on or off per course under Academics &gt; Courses &gt; Course settings — students from other courses can't be registered.</div></div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Awaiting placement</h3><div class="sub">${pool.length} registered student${pool.length===1?'':'s'} without a partner yet</div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Student</th><th>Batch</th><th>Registered</th><th></th></tr></thead>
        <tbody>${pool.length?pool.map(pl=>{ const s = studentById(pl.studentId); return `<tr><td>${studentCell(pl.studentId)}</td><td class="muted">${s?esc(batchLabelFor(s)):'—'}</td><td class="muted">${fmtDateShort(pl.registeredDate)}</td><td><button class="btn btn-sm primary" onclick="openPlacementModal('${pl.id}')">Place</button></td></tr>`; }).join(""):`<tr><td colspan="4"><div class="empty">Nobody is waiting — register students from any batch.</div></td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Where students are placed</h3><div class="sub">Click a partner for details</div></div>
      <div class="panel-body">${ranked.length?ranked.map(x=>`<div class="feed-item row-click" onclick="openPartnerDetail('${x.p.id}')"><div class="feed-dot" style="background:var(--pos);"></div><div style="flex:1;"><div class="feed-text"><strong>${esc(x.p.name)}</strong> · ${x.st.total} placed</div><div class="feed-time">${x.st.current} interning · ${x.st.completed} completed · ${ratingCell(x.r.avg, x.r.n)}</div></div></div>`).join(""):'<div class="empty">No placements yet.</div>'}</div>
    </div>
  </div>`;
}

/* ---- Partners database ---- */
function partnerHasStipend(p, kind){ return partnerOpenRoles(p).some(x=>x.stipend===kind); }
function placementsPartners(){
  let list = placementPartners.slice();
  if(placementPartnerTypeFilter!=="All") list = list.filter(p=>p.type===placementPartnerTypeFilter);
  if(placementPartnerStipendFilter!=="All") list = list.filter(p=>partnerHasStipend(p, placementPartnerStipendFilter));
  list.sort((a,b)=>partnerOpenSlots(b)-partnerOpenSlots(a) || a.name.localeCompare(b.name));
  return `
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Type</span><select class="select-sm" onchange="setPlacementPartnerTypeFilter(this.value)">${["All","In-house","External"].map(t=>`<option ${t===placementPartnerTypeFilter?'selected':''}>${t}</option>`).join('')}</select><span class="filter-label">Open roles that are</span><select class="select-sm" onchange="setPlacementPartnerStipendFilter(this.value)">${[["All","Any"],["Paid","Paid"],["Unpaid","Unpaid"]].map(o=>`<option value="${o[0]}" ${o[0]===placementPartnerStipendFilter?'selected':''}>${o[1]}</option>`).join('')}</select></div>
    <button class="btn primary" onclick="openPartnerModal()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add partner</button>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Placement partners</h3><div class="sub">${list.length} of ${placementPartners.length} · click a partner to see who we've placed there</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Partner</th><th>Type</th><th class="num">Open seats</th><th>Stipend</th><th class="num">Students placed</th><th>Rating</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.length?list.map(p=>{ const st = partnerStats(p), r = partnerRating(p), roles = partnerOpenRoles(p), label = partnerStipendLabel(p);
        return `<tr class="row-click" onclick="openPartnerDetail('${p.id}')"><td><div style="font-weight:700;">${esc(p.name)}</div><div class="subtext">${[p.city,p.industry].filter(Boolean).map(esc).join(' · ')}</div></td><td>${pill(p.type, p.type==='In-house'?'blue':'neutral')}</td><td class="num mono">${partnerOpenSlots(p)}<div class="subtext">${roles.length} role${roles.length===1?'':'s'}</div></td><td>${p.positions&&p.positions.length?pill(label, stipendKind(label)):'<span class="faint">—</span>'}</td><td class="num mono">${st.total}${st.current?`<div class="subtext">${st.current} interning</div>`:''}</td><td>${ratingCell(r.avg, r.n)}</td><td>${pill(p.status, p.status==='Active'?'pos':'warn')}</td><td><button class="btn btn-sm ghost" onclick="event.stopPropagation();openPartnerModal('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></td></tr>`; }).join(""):`<tr><td colspan="8"><div class="empty">No partners match these filters.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}

/* ---- Open positions (across all partners) ---- */
function placementsPositions(){
  let rows = [];
  placementPartners.forEach(p=>(p.positions||[]).forEach(pos=>rows.push({p, pos})));
  if(placementPositionFilter.open==="Open") rows = rows.filter(r=>r.p.status==="Active" && positionOpenNow(r.pos)>0);
  if(placementPositionFilter.stipend!=="All") rows = rows.filter(r=>r.pos.stipend===placementPositionFilter.stipend);
  rows.sort((a,b)=>a.p.name.localeCompare(b.p.name));
  return `
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Show</span><select class="select-sm" onchange="setPlacementPositionOpenFilter(this.value)">${[["Open","With open seats"],["All","All roles"]].map(o=>`<option value="${o[0]}" ${o[0]===placementPositionFilter.open?'selected':''}>${o[1]}</option>`).join('')}</select><span class="filter-label">Stipend</span><select class="select-sm" onchange="setPlacementPositionStipendFilter(this.value)">${["All","Paid","Unpaid"].map(t=>`<option ${t===placementPositionFilter.stipend?'selected':''}>${t}</option>`).join('')}</select></div>
    <span class="faint" style="font-size:12px;">Add or edit roles from a partner's page</span>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Open positions</h3><div class="sub">${rows.length} role${rows.length===1?'':'s'} listed</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Role</th><th>Partner</th><th>For course</th><th class="num">Open / total</th><th>Stipend</th><th>Duration</th><th>Mode</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.length?rows.map(r=>`<tr><td style="font-weight:700;">${esc(r.pos.title)}</td><td>${partnerLink(r.p.id)}</td><td class="muted">${esc(r.pos.course==='Any'?'Any course':r.pos.course)}</td><td class="num mono">${positionOpenNow(r.pos)} / ${r.pos.openings}</td><td>${pill(stipendText(r.pos), r.pos.stipend==='Paid'?'pos':'neutral')}</td><td class="muted">${esc(r.pos.duration||'—')}</td><td class="muted">${esc(r.pos.mode||'—')}</td><td>${pill(r.pos.status, r.pos.status==='Open'?'pos':'neutral')}</td><td><div style="display:flex;gap:6px;"><button class="btn btn-sm" onclick="openPlacementModal(null,'${r.p.id}','${r.pos.id}')">Place student</button><button class="btn btn-sm ghost" onclick="openPositionModal('${r.p.id}','${r.pos.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></div></td></tr>`).join(""):`<tr><td colspan="9"><div class="empty">No roles match these filters.</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}

/* ---- Students in placement ---- */
function placementActionsHTML(pl){
  const btns = [];
  if(pl.status==="Registered") btns.push(`<button class="btn btn-sm primary" onclick="openPlacementModal('${pl.id}')">Place</button>`);
  if(pl.status==="Placed") btns.push(`<button class="btn btn-sm" onclick="completePlacement('${pl.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-check"/></svg>Complete</button>`);
  if(pl.partnerId){
    btns.push(`<button class="btn btn-sm ghost" onclick="openReviewLinks('${pl.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-link"/></svg>Review links (${(pl.partnerReview?1:0)+(pl.studentReview?1:0)}/2)</button>`);
  }
  btns.push(`<button class="btn btn-sm ghost" onclick="openPlacementModal('${pl.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button>`);
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;">${btns.join('')}</div>`;
}
function placementsStudents(){
  const list = placements.filter(x=>placementStatusFilter==="All" || x.status===placementStatusFilter).slice().sort((a,b)=>PLACEMENT_STATUSES.indexOf(a.status)-PLACEMENT_STATUSES.indexOf(b.status) || (b.registeredDate||'').localeCompare(a.registeredDate||''));
  return `
  <div class="toolbar">
    <div class="filter-group"><span class="filter-label">Status</span><select class="select-sm" onchange="setPlacementStatusFilter(this.value)">${["All",...PLACEMENT_STATUSES].map(t=>`<option ${t===placementStatusFilter?'selected':''}>${t}</option>`).join('')}</select></div>
    <button class="btn primary" onclick="openRegisterPlacement()"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Register students</button>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Students in placement</h3><div class="sub">${list.length} of ${placements.length}</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Student</th><th>Course · Batch</th><th>Status</th><th>Placed at</th><th>Stipend</th><th>Dates</th><th></th></tr></thead>
      <tbody>${list.length?list.map(pl=>{ const s = studentById(pl.studentId), pos = pl.partnerId ? positionById(pl.partnerId, pl.positionId) : null;
        return `<tr><td class="row-click" onclick="openStudentDetail('${pl.studentId}')">${studentCell(pl.studentId)}</td><td class="muted">${s?esc(s.course):'—'}<div class="subtext">${s?esc(batchLabelFor(s)):''}</div></td><td>${pill(pl.status, placementStatusKind(pl.status))}</td><td>${pl.partnerId?`${partnerLink(pl.partnerId)}<div class="subtext">${esc(placementPositionLabel(pl))}</div>`:'<span class="faint">—</span>'}</td><td class="muted">${pos?esc(stipendText(pos)):'—'}</td><td class="muted">${placementDateLabel(pl)}</td><td>${placementActionsHTML(pl)}</td></tr>`; }).join(""):`<tr><td colspan="7"><div class="empty">${placements.length?'No students with this status.':'No students registered for placement yet.'}</div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}

/* ---- Reviews ---- */
function reviewRowsHTML(list, kind){
  if(!list.length) return `<div class="empty">No reviews yet.</div>`;
  return `<div class="stack" style="gap:10px;">${list.map(x=>{ const r = kind==='partner' ? x.pl.partnerReview : x.pl.studentReview;
    const title = kind==='partner' ? `${esc(x.partner.name)}` : `${esc(placementStudentName(x.pl))}`;
    const sub = kind==='partner' ? `by ${esc(r.by||placementStudentName(x.pl))}` : `at ${esc(x.partner.name)} · by ${esc(r.by||'partner')}`;
    return `<div class="panel" style="box-shadow:none;"><div class="panel-body" style="display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;"><div><span style="font-weight:800;font-size:13.5px;">${title}</span> <span class="faint" style="font-size:12px;">${sub} · ${fmtDateShort(r.date)}</span></div><div style="display:flex;align-items:center;gap:8px;">${starsHTML(r.rating)}<button class="btn btn-sm ghost" title="Remove this review" onclick="removePlacementReview('${x.pl.id}','${kind}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-x"/></svg>Remove</button></div></div>
      ${r.text?`<div style="font-size:13px;color:var(--ink-soft);line-height:1.55;">${esc(r.text)}</div>`:''}
    </div></div>`; }).join("")}</div>`;
}
function placementsReviews(){
  const withPartner = placements.filter(x=>x.partnerId && partnerById(x.partnerId)).map(pl=>({pl, partner:partnerById(pl.partnerId)}));
  const partnerReviews = withPartner.filter(x=>x.pl.partnerReview).sort((a,b)=>b.pl.partnerReview.date.localeCompare(a.pl.partnerReview.date));
  const studentReviews = withPartner.filter(x=>x.pl.studentReview).sort((a,b)=>b.pl.studentReview.date.localeCompare(a.pl.studentReview.date));
  const pending = withPartner.filter(x=>x.pl.status==="Completed" && (!x.pl.partnerReview || !x.pl.studentReview));
  const avgP = avgRating(partnerReviews.map(x=>x.pl.partnerReview.rating)), avgS = avgRating(studentReviews.map(x=>x.pl.studentReview.rating));
  return `
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Partner rating (by students)</div><div class="kpi-value" style="font-size:18px;">${avgP==null?'—':starsHTML(avgP)+' <span class="mono">'+avgP.toFixed(1)+'</span>'}</div><div class="kpi-sub">${partnerReviews.length} review${partnerReviews.length===1?'':'s'}</div></div>
    <div class="kpi-card"><div class="kpi-label">Student rating (by partners)</div><div class="kpi-value" style="font-size:18px;">${avgS==null?'—':starsHTML(avgS)+' <span class="mono">'+avgS.toFixed(1)+'</span>'}</div><div class="kpi-sub">${studentReviews.length} review${studentReviews.length===1?'':'s'}</div></div>
    <div class="kpi-card hero"><div class="kpi-label">Completed, reviews pending</div><div class="kpi-value mono ${pending.length?'warn':''}">${pending.length}</div></div>
  </div>
  ${pending.length?`<div class="panel"><div class="panel-head"><h3>Reviews to collect</h3><div class="sub">Completed internships still missing a review — send them the link</div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Student</th><th>Partner</th><th>Student's review of partner</th><th>Partner's review of student</th><th></th></tr></thead><tbody>${pending.map(x=>`<tr><td>${studentCell(x.pl.studentId)}</td><td>${partnerLink(x.partner.id)}</td><td>${reviewStatusPill(x.pl,'partner')}</td><td>${reviewStatusPill(x.pl,'student')}</td><td><button class="btn btn-sm primary" onclick="openReviewLinks('${x.pl.id}')">Get links</button></td></tr>`).join('')}</tbody></table></div></div>`:''}
  <div class="grid-2" style="grid-template-columns:1fr 1fr;">
    <div class="panel"><div class="panel-head"><h3>Partner reviews</h3><div class="sub">What students say about the company — sent by them through their link</div></div><div class="modal-body">${reviewRowsHTML(partnerReviews,'partner')}</div></div>
    <div class="panel"><div class="panel-head"><h3>Student reviews</h3><div class="sub">What partners say about our students — sent by them through their link</div></div><div class="modal-body">${reviewRowsHTML(studentReviews,'student')}</div></div>
  </div>`;
}

/* ---- Partner detail page ---- */
function partnerDetailPage(id){
  const p = partnerById(id);
  if(!p) return `<div class="empty">Partner not found.</div>`;
  const st = partnerStats(p), r = partnerRating(p), label = partnerStipendLabel(p);
  const list = placementsOfPartner(p.id).slice().sort((a,b)=>PLACEMENT_STATUSES.indexOf(a.status)-PLACEMENT_STATUSES.indexOf(b.status) || (b.startDate||'').localeCompare(a.startDate||''));
  const partnerReviews = list.filter(x=>x.partnerReview), studentReviews = list.filter(x=>x.studentReview);
  const wrap = x=>({pl:x, partner:p});
  return `
  <div class="toolbar"><button class="btn ghost" onclick="closeDetail()"><svg class="icon" style="width:13px;height:13px"><use href="#i-chevron-left"/></svg>Back</button>
    <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn" onclick="openPositionModal('${p.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-plus"/></svg>Add position</button><button class="btn" onclick="openPlacementModal(null,'${p.id}')">Place a student</button><button class="btn primary" onclick="openPartnerModal('${p.id}')"><svg class="icon" style="width:13px;height:13px"><use href="#i-edit"/></svg>Edit partner</button></div></div>
  <div class="panel">
    <div class="panel-head"><h3>${esc(p.name)}</h3><div class="sub">${[p.type,p.city,p.industry].filter(Boolean).map(esc).join(' · ')}</div></div>
    <div class="modal-body">
      <div class="kpi-grid">
        <div class="kpi-card hero"><div class="kpi-label">Students Placed</div><div class="kpi-value mono">${st.total}</div><div class="kpi-sub">${st.current} interning · ${st.completed} completed${st.withdrawn?` · ${st.withdrawn} withdrew`:''}</div></div>
        <div class="kpi-card"><div class="kpi-label">Open Seats</div><div class="kpi-value mono">${partnerOpenSlots(p)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Stipend</div><div class="kpi-value" style="font-size:18px;">${p.positions&&p.positions.length?pill(label,stipendKind(label)):'—'}</div></div>
        <div class="kpi-card"><div class="kpi-label">Rating</div><div class="kpi-value" style="font-size:16px;">${ratingCell(r.avg, r.n)}</div></div>
      </div>
      <div class="field-row cols-3">
        <div><label class="field-label">Contact</label><div>${esc(p.contactName||'—')}</div></div>
        <div><label class="field-label">Phone</label><div>${esc(p.phone||'—')}</div></div>
        <div><label class="field-label">Email</label><div>${esc(p.email||'—')}</div></div>
        <div><label class="field-label">Status</label><div>${pill(p.status, p.status==='Active'?'pos':'warn')}</div></div>
        <div><label class="field-label">Partner since</label><div>${fmtDate(p.addedDate)}</div></div>
      </div>
      ${p.notes?`<div class="subtext" style="margin:2px 0 14px;">${esc(p.notes)}</div>`:''}
      <div class="section-label" style="display:flex;align-items:center;justify-content:space-between;">Positions<button class="btn btn-sm ghost" onclick="openPositionModal('${p.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-plus"/></svg>Add position</button></div>
      ${(p.positions||[]).length?`<div class="table-wrap"><table class="data"><thead><tr><th>Role</th><th>For course</th><th class="num">Open / total</th><th>Stipend</th><th>Duration</th><th>Mode</th><th>Status</th><th></th></tr></thead><tbody>${p.positions.map(pos=>`<tr><td style="font-weight:700;">${esc(pos.title)}</td><td class="muted">${esc(pos.course==='Any'?'Any course':pos.course)}</td><td class="num mono">${positionOpenNow(pos)} / ${pos.openings}</td><td>${pill(stipendText(pos), pos.stipend==='Paid'?'pos':'neutral')}</td><td class="muted">${esc(pos.duration||'—')}</td><td class="muted">${esc(pos.mode||'—')}</td><td>${pill(pos.status, pos.status==='Open'?'pos':'neutral')}</td><td><button class="btn btn-sm ghost" onclick="openPositionModal('${p.id}','${pos.id}')"><svg class="icon" style="width:12px;height:12px"><use href="#i-edit"/></svg>Edit</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">No positions added yet.</div>`}
      <div class="section-label">Students placed here (${list.length})</div>
      ${list.length?`<div class="table-wrap"><table class="data"><thead><tr><th>Student</th><th>Role</th><th>Status</th><th>Dates</th><th>Student review</th><th>Partner review</th><th></th></tr></thead><tbody>${list.map(pl=>`<tr><td class="row-click" onclick="openStudentDetail('${pl.studentId}')">${studentCell(pl.studentId)}<div class="subtext">${(()=>{ const s=studentById(pl.studentId); return s?esc(s.course):''; })()}</div></td><td class="muted">${esc(placementPositionLabel(pl)||'—')}</td><td>${pill(pl.status, placementStatusKind(pl.status))}</td><td class="muted">${placementDateLabel(pl)}</td><td>${pl.studentReview?starsHTML(pl.studentReview.rating):'<span class="faint">—</span>'}</td><td>${pl.partnerReview?starsHTML(pl.partnerReview.rating):'<span class="faint">—</span>'}</td><td>${placementActionsHTML(pl)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">Nobody placed here yet.</div>`}
      <div class="section-label">Reviews</div>
      <div class="grid-2" style="grid-template-columns:1fr 1fr;">
        <div><div class="field-label" style="margin-bottom:6px;">What students say about ${esc(p.name)}</div>${reviewRowsHTML(partnerReviews.map(wrap),'partner')}</div>
        <div><div class="field-label" style="margin-bottom:6px;">What ${esc(p.name)} says about our students</div>${reviewRowsHTML(studentReviews.map(wrap),'student')}</div>
      </div>
    </div>
  </div>`;
}

/* ---- Partner add / edit ---- */
function openPartnerModal(id){
  const p = id ? partnerById(id) : null;
  const hasHistory = p && placementsOfPartner(p.id).length>0;
  showModal(`
    <div class="modal-head"><h3>${p?'Edit partner':'Add placement partner'}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-partner"><div class="modal-body">
      <div><label class="field-label">Partner name</label><input class="field-input" name="name" required value="${esc(p?p.name:'')}" placeholder="e.g. Lumen Digital"></div>
      <div class="field-row">
        <div><label class="field-label">Type</label><select class="field-input" name="type">${["External","In-house"].map(t=>`<option ${p&&p.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Status</label><select class="field-input" name="status">${["Active","Paused"].map(t=>`<option ${p&&p.status===t?'selected':''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">City</label><input class="field-input" name="city" value="${esc(p?p.city:'')}"></div>
        <div><label class="field-label">Industry</label><input class="field-input" name="industry" value="${esc(p?p.industry:'')}" placeholder="e.g. Digital agency"></div>
      </div>
      <div class="field-row cols-3">
        <div><label class="field-label">Contact person</label><input class="field-input" name="contactName" value="${esc(p?p.contactName:'')}"></div>
        <div><label class="field-label">Phone</label><input class="field-input" name="phone" value="${esc(p?p.phone:'')}"></div>
        <div><label class="field-label">Email</label><input class="field-input" type="email" name="email" value="${esc(p?p.email:'')}"></div>
      </div>
      <div><label class="field-label">Notes</label><textarea class="field-input" name="notes" rows="2">${esc(p?p.notes:'')}</textarea></div>
    </div>
    <div class="modal-foot"><div>${p?(hasHistory?'<span class="faint" style="font-size:12px;">Has placement history — pause instead of deleting</span>':`<button type="button" class="btn danger" onclick="deletePartner('${p.id}')">Delete partner</button>`):''}</div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${p?'Save changes':'Add partner'}</button></div></div>
    </form>`);
  document.getElementById("f-partner").addEventListener("submit", e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {name:(f.get("name")||"").trim(), type:f.get("type"), status:f.get("status"), city:(f.get("city")||"").trim(), industry:(f.get("industry")||"").trim(), contactName:(f.get("contactName")||"").trim(), phone:(f.get("phone")||"").trim(), email:(f.get("email")||"").trim(), notes:(f.get("notes")||"").trim()};
    if(!data.name) return;
    if(p){ Object.assign(p, data); toast("Partner updated"); }
    else { placementPartners.push({id:nextPlacementId("PTN", placementPartners), ...data, addedDate:TODAY, positions:[]}); toast("Partner added — now add the roles they're hiring for"); }
    closeModal(); render();
  });
}
function deletePartner(id){
  if(placementsOfPartner(id).length){ toast("This partner has placements — pause it instead"); return; }
  { const i = placementPartners.findIndex(p=>p.id===id); if(i>=0) placementPartners.splice(i,1); }
  toast("Partner deleted"); closeModal(); if(nav.detail && nav.detail.type==='partner') nav.detail = null; render();
}

/* ---- Position add / edit ---- */
function openPositionModal(partnerId, posId){
  const p = partnerById(partnerId);
  const pos = posId ? positionById(partnerId, posId) : null;
  const used = pos ? placements.filter(x=>x.positionId===pos.id).length : 0;
  const courseOpts = ["Any", ...internshipCourses(), ...(pos && pos.course!=="Any" && !internshipCourses().includes(pos.course) ? [pos.course] : [])];
  showModal(`
    <div class="modal-head"><h3>${pos?'Edit position':'Add position'} — ${esc(p.name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-position"><div class="modal-body">
      <div><label class="field-label">Role title</label><input class="field-input" name="title" required value="${esc(pos?pos.title:'')}" placeholder="e.g. Social Media Intern"></div>
      <div class="field-row">
        <div><label class="field-label">For course</label><select class="field-input" name="course">${courseOpts.map(c=>`<option value="${esc(c)}" ${pos&&pos.course===c?'selected':''}>${c==='Any'?'Any course':esc(c)}</option>`).join('')}</select></div>
        <div><label class="field-label">Seats</label><input class="field-input" type="number" min="1" name="openings" required value="${pos?pos.openings:1}"></div>
      </div>
      <div class="field-row">
        <div><label class="field-label">Stipend</label><select class="field-input" name="stipend" onchange="document.getElementById('pos-amount-wrap').style.display = this.value==='Paid' ? '' : 'none'">${["Paid","Unpaid"].map(t=>`<option ${(pos?pos.stipend:'Paid')===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div id="pos-amount-wrap" style="${pos&&pos.stipend==='Unpaid'?'display:none;':''}"><label class="field-label">Stipend (₹ per month)</label><input class="field-input" type="number" min="0" name="stipendAmount" value="${pos?pos.stipendAmount||0:''}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label class="field-label">Duration</label><input class="field-input" name="duration" value="${esc(pos?pos.duration:'')}" placeholder="e.g. 3 months"></div>
        <div><label class="field-label">Mode</label><select class="field-input" name="mode">${POSITION_MODES.map(t=>`<option ${pos&&pos.mode===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Status</label><select class="field-input" name="status">${["Open","Closed"].map(t=>`<option ${pos&&pos.status===t?'selected':''}>${t}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot"><div>${pos?(used?'<span class="faint" style="font-size:12px;">Has placements — close it instead of deleting</span>':`<button type="button" class="btn danger" onclick="deletePosition('${p.id}','${pos.id}')">Delete position</button>`):''}</div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${pos?'Save changes':'Add position'}</button></div></div>
    </form>`);
  document.getElementById("f-position").addEventListener("submit", e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const stipend = f.get("stipend");
    const data = {title:(f.get("title")||"").trim(), course:f.get("course"), openings:Math.max(1,Number(f.get("openings"))||1), stipend, stipendAmount: stipend==="Paid" ? (Number(f.get("stipendAmount"))||0) : 0, duration:(f.get("duration")||"").trim(), mode:f.get("mode"), status:f.get("status")};
    if(!data.title) return;
    if(pos){ Object.assign(pos, data); toast("Position updated"); }
    else { p.positions = p.positions || []; p.positions.push({id:nextPlacementId("POS", placementPartners.flatMap(x=>x.positions||[])), ...data}); toast("Position added"); }
    closeModal(); render();
  });
}
function deletePosition(partnerId, posId){
  const p = partnerById(partnerId);
  if(placements.some(x=>x.positionId===posId)){ toast("This position has placements — close it instead"); return; }
  p.positions = p.positions.filter(x=>x.id!==posId);
  toast("Position deleted"); closeModal(); render();
}

/* ---- Register students for placement (from any batch on an internship course) ---- */
function registerCandidatesHTML(batchId, preStudentId){
  const cands = batchStudents(batchId).filter(s=>s.status!=="Dropped" && !activePlacementOf(s.id));
  const already = batchStudents(batchId).filter(s=>activePlacementOf(s.id));
  if(!cands.length) return `<div class="empty">${batchStudents(batchId).length?'Everyone eligible in this batch is already registered.':'No students in this batch.'}</div>`;
  return `<div style="display:flex;flex-direction:column;gap:6px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;"><input type="checkbox" onchange="document.querySelectorAll('#reg-student-list input[name=regStudent]').forEach(c=>c.checked=this.checked)"> Select all (${cands.length})</label>
    <div id="reg-student-list" style="display:flex;flex-direction:column;gap:6px;">${cands.map(s=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--line);border-radius:7px;font-size:13px;"><input type="checkbox" name="regStudent" value="${s.id}" ${s.id===preStudentId?'checked':''}> <span style="font-weight:700;">${esc(s.name)}</span> <span class="faint">${esc(s.status)}${s.city?' · '+esc(s.city):''}</span></label>`).join('')}</div>
    ${already.length?`<div class="subtext">${already.length} already registered or placed: ${already.map(s=>esc(s.name)).join(', ')}</div>`:''}
  </div>`;
}
function refreshRegisterCandidates(){
  const sel = document.getElementById('reg-batch-select'), box = document.getElementById('reg-candidates');
  if(sel && box) box.innerHTML = registerCandidatesHTML(sel.value, null);
}
function openRegisterPlacement(preStudentId){
  const pre = preStudentId ? studentById(preStudentId) : null;
  const eligible = batches.filter(b=>courseOffersInternship(b.course)).slice().sort((a,b)=>b.startDate.localeCompare(a.startDate));
  if(!eligible.length){ toast("No course has an internship track yet — turn it on in Course settings"); return; }
  const startBatch = (pre && pre.batchId && eligible.some(b=>b.id===pre.batchId)) ? pre.batchId : eligible[0].id;
  showModal(`
    <div class="modal-head"><h3>Register students for placement</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-register-placement"><div class="modal-body">
      <div><label class="field-label">Batch</label><select class="field-input" id="reg-batch-select" onchange="refreshRegisterCandidates()">${eligible.map(b=>`<option value="${b.id}" ${b.id===startBatch?'selected':''}>${esc(b.label)} — ${esc(b.course)} (${batchStudents(b.id).length} students)</option>`).join('')}</select></div>
      <div class="subtext">Any batch of a course with an internship track. Registered students go into the placement pool; assign them a partner when you have a match.</div>
      <div id="reg-candidates">${registerCandidatesHTML(startBatch, pre?pre.id:null)}</div>
      <div><label class="field-label">Note (optional)</label><input class="field-input" name="notes" placeholder="e.g. Prefers remote, portfolio ready"></div>
    </div>
    <div class="modal-foot"><div></div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">Register</button></div></div>
    </form>`);
  document.getElementById("f-register-placement").addEventListener("submit", e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const ids = f.getAll("regStudent");
    if(!ids.length){ toast("Tick at least one student"); return; }
    const notes = (f.get("notes")||"").trim();
    ids.forEach(sid=>{ if(!activePlacementOf(sid)) placements.push({id:nextPlacementId("PLC", placements), studentId:sid, partnerId:"", positionId:"", status:"Registered", registeredDate:TODAY, startDate:"", endDate:"", notes}); });
    toast(ids.length+" student"+(ids.length>1?'s':'')+" registered for placement"); closeModal(); render();
  });
}

/* ---- Place / edit a student's placement ---- */
function placementPositionOptionsHTML(partnerId, selected){
  const p = partnerById(partnerId);
  if(!p) return '<option value="">— pick a partner first —</option>';
  const list = (p.positions||[]).filter(x=>x.id===selected || positionOpenNow(x)>0);
  return '<option value="">— No specific role —</option>' + list.map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.title)} — ${positionOpenNow(x)} open · ${esc(stipendText(x))}</option>`).join('');
}
function onPlacementPartnerChange(){
  const pSel = document.getElementById('plc-partner'), posSel = document.getElementById('plc-position'), stSel = document.getElementById('plc-status');
  if(!pSel || !posSel) return;
  posSel.innerHTML = placementPositionOptionsHTML(pSel.value, "");
  posSel.disabled = !pSel.value;
  if(pSel.value && stSel && stSel.value==="Registered") stSel.value = "Placed";
}
function openPlacementModal(plId, presetPartnerId, presetPositionId){
  const pl = plId ? placements.find(x=>x.id===plId) : null;
  const pool = pendingPlacementPool();
  if(!pl && !pool.length){ toast("Nobody is waiting for placement — register students first"); openRegisterPlacement(); return; }
  const partnerId = pl ? pl.partnerId : (presetPartnerId||"");
  const posId = pl ? pl.positionId : (presetPositionId||"");
  const status = pl ? pl.status : (partnerId ? "Placed" : "Registered");
  const partnerOpts = placementPartners.filter(p=>p.status==="Active" || p.id===partnerId);
  showModal(`
    <div class="modal-head"><h3>${pl?(pl.partnerId?'Edit placement':'Place student'):'Place a student'}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <form id="f-placement"><div class="modal-body">
      <div><label class="field-label">Student</label>${pl?`<div style="font-weight:700;">${esc(placementStudentName(pl))}</div><div class="subtext">${(()=>{ const s=studentById(pl.studentId); return s?esc(s.course)+' · '+esc(batchLabelFor(s)):''; })()}</div>`:`<select class="field-input" name="plcPick">${pool.map(x=>{ const s=studentById(x.studentId); return `<option value="${x.id}">${esc(s?s.name:x.studentId)} — ${s?esc(batchLabelFor(s)):''}</option>`; }).join('')}</select>`}</div>
      <div class="field-row">
        <div><label class="field-label">Partner</label><select class="field-input" id="plc-partner" name="partnerId" onchange="onPlacementPartnerChange()"><option value="">— Not placed yet —</option>${partnerOpts.map(p=>`<option value="${p.id}" ${p.id===partnerId?'selected':''}>${esc(p.name)}${p.type==='In-house'?' (in-house)':''}</option>`).join('')}</select></div>
        <div><label class="field-label">Role</label><select class="field-input" id="plc-position" name="positionId" ${partnerId?'':'disabled'}>${placementPositionOptionsHTML(partnerId, posId)}</select></div>
      </div>
      <div class="field-row cols-3">
        <div><label class="field-label">Status</label><select class="field-input" id="plc-status" name="status">${PLACEMENT_STATUSES.map(t=>`<option ${t===status?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label class="field-label">Start date</label><input class="field-input" type="date" name="startDate" value="${pl?pl.startDate||'':''}"></div>
        <div><label class="field-label">End date</label><input class="field-input" type="date" name="endDate" value="${pl?pl.endDate||'':''}"></div>
      </div>
      <div><label class="field-label">Notes</label><textarea class="field-input" name="notes" rows="2">${esc(pl?pl.notes:'')}</textarea></div>
    </div>
    <div class="modal-foot"><div>${pl?`<button type="button" class="btn danger" onclick="removePlacement('${pl.id}')">Remove from placement</button>`:''}</div><div style="display:flex;gap:8px;"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn primary">${pl?'Save changes':'Place student'}</button></div></div>
    </form>`);
  document.getElementById("f-placement").addEventListener("submit", e=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const rec = pl || placements.find(x=>x.id===f.get("plcPick"));
    if(!rec) return;
    let st = f.get("status"), pid = f.get("partnerId") || "", posIdNew = pid ? (f.get("positionId")||"") : "";
    if(pid && st==="Registered") st = "Placed";
    if(!pid && (st==="Placed" || st==="Completed")){ toast("Pick a partner for a placed student"); return; }
    if(!pid && st==="Withdrawn" && rec.partnerId) pid = rec.partnerId;
    const newPos = pid && posIdNew ? positionById(pid, posIdNew) : null;
    const holds = st==="Placed" || st==="Completed";
    const alreadyHolding = holdsSeat(rec) && rec.positionId===posIdNew && rec.partnerId===pid;
    if(newPos && holds && !alreadyHolding && positionOpenNow(newPos)<=0){ toast("No open seats left in that role"); return; }
    rec.status = st;
    rec.partnerId = pid; rec.positionId = posIdNew;
    rec.startDate = f.get("startDate") || ""; rec.endDate = f.get("endDate") || "";
    rec.notes = (f.get("notes")||"").trim();
    if(st==="Placed" && !rec.startDate) rec.startDate = TODAY;
    if(st==="Completed" && !rec.endDate) rec.endDate = TODAY;
    if(st==="Registered"){ rec.partnerId = ""; rec.positionId = ""; }
    toast(st==="Placed" ? placementStudentName(rec)+" placed at "+partnerById(pid).name : "Placement updated"); closeModal(); render();
  });
}
function completePlacement(id){
  const pl = placements.find(x=>x.id===id); if(!pl) return;
  pl.status = "Completed"; if(!pl.endDate) pl.endDate = TODAY;
  toast("Internship marked completed — add the reviews when you have them"); render();
}
function removePlacement(id){
  { const i = placements.findIndex(x=>x.id===id); if(i>=0) placements.splice(i,1); }
  toast("Removed from placement"); closeModal(); render();
}

/* ---- Reviews, collected through a link ----
   Staff don't type reviews in. Each placement has two links: one for the STUDENT (to rate the partner)
   and one for the PARTNER (to rate the student). Opening a link (…#review=TOKEN) shows a standalone form —
   no login, no ERP behind it, only the names needed to answer. A link takes one review; if Anu removes a
   review, its link works again. /api/review is the single place a submission is written.
   */
let reviewLinkBase = (typeof location!=='undefined' ? location.origin + location.pathname : '');
// 24 random letters/digits (~140 bits): the token is the only credential on the public review page.
function newReviewToken(){
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return Array.from(buf, b=>chars[b % chars.length]).join('');
}
function reviewField(kind){ return kind==='partner' ? 'partnerReview' : 'studentReview'; }
function reviewTokenOf(pl, kind){ pl.reviewTokens = pl.reviewTokens || {}; if(!pl.reviewTokens[kind]){ pl.reviewTokens[kind] = newReviewToken(); queueSave(); } return pl.reviewTokens[kind]; }
function reviewLinkFor(pl, kind){ return reviewLinkBase + '#review=' + reviewTokenOf(pl, kind); }
function markReviewRequested(pl, kind){ pl.reviewRequests = pl.reviewRequests || {}; pl.reviewRequests[kind] = TODAY; }
function reviewStatusPill(pl, kind){
  if(pl[reviewField(kind)]) return pill('Received','pos');
  const d = (pl.reviewRequests||{})[kind];
  return d ? pill('Sent '+fmtDateShort(d),'warn') : pill('Not sent','neutral');
}
function removePlacementReview(plId, kind){
  const pl = placements.find(x=>x.id===plId); if(!pl) return;
  delete pl[reviewField(kind)];
  toast("Review removed — its link works again"); if(document.getElementById('f-review-links')) closeModal(); render();
}

/* Anu's side: the two links for a placement */
function reviewMessageFor(pl, kind, link){
  const partner = partnerById(pl.partnerId), s = studentById(pl.studentId);
  if(kind==='partner') return `Hi ${(s?s.name:'').split(' ')[0]}, hope your internship at ${partner.name} went well! Could you take a minute to share a review of your experience there? ${link}`;
  return `Hi ${(partner.contactName||'').split(' ')[0]||'there'}, thank you for hosting ${placementStudentName(pl)} as an intern. Could you take a minute to share feedback on their work? ${link}`;
}
function reviewLinkCardHTML(pl, kind){
  const partner = partnerById(pl.partnerId);
  const r = pl[reviewField(kind)];
  const to = kind==='partner' ? `${esc(placementStudentName(pl))} (the student)` : `${esc(partner.contactName||'the contact')} at ${esc(partner.name)}`;
  return `<div class="panel" style="box-shadow:none;"><div class="panel-body" style="display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;"><div><div style="font-weight:800;font-size:13.5px;">${kind==='partner'?'Student rates the partner':'Partner rates the student'}</div><div class="subtext">Send this link to ${to}</div></div>${reviewStatusPill(pl,kind)}</div>
    ${r ? `<div style="font-size:13px;">${starsHTML(r.rating)} <span class="faint">${esc(r.by||'')} · ${fmtDateShort(r.date)}</span>${r.text?`<div style="color:var(--ink-soft);margin-top:4px;">${esc(r.text)}</div>`:''}<div style="margin-top:6px;"><button type="button" class="btn btn-sm danger" onclick="removePlacementReview('${pl.id}','${kind}')">Remove review</button></div></div>`
    : `<div style="display:flex;gap:6px;"><input class="field-input" readonly id="rl-${kind}" value="${esc(reviewLinkFor(pl,kind))}" onfocus="this.select()" style="flex:1;min-width:0;font-size:12px;"><button type="button" class="btn btn-sm" onclick="copyReviewLink('${pl.id}','${kind}')">Copy</button><button type="button" class="btn btn-sm primary" onclick="shareReviewWhatsApp('${pl.id}','${kind}')">WhatsApp</button></div>`}
  </div></div>`;
}
function openReviewLinks(plId){
  const pl = placements.find(x=>x.id===plId); if(!pl || !partnerById(pl.partnerId)) return;
  showModal(`
    <div class="modal-head"><h3>Review links — ${esc(placementStudentName(pl))} at ${esc(partnerById(pl.partnerId).name)}</h3><button class="modal-close" onclick="closeModal()"><svg class="icon" style="width:14px;height:14px"><use href="#i-x"/></svg></button></div>
    <div class="modal-body" id="f-review-links">
      <div class="banner muted"><svg class="icon" style="width:15px;height:15px"><use href="#i-sliders"/></svg><div>Reviews come from the student and the partner themselves. Each link opens a short form with no login and takes one review.</div></div>
      ${reviewLinkCardHTML(pl,'partner')}
      ${reviewLinkCardHTML(pl,'student')}
      <div><label class="field-label">Links open at</label><input class="field-input" id="rl-base" value="${esc(reviewLinkBase)}" onchange="setReviewLinkBase(this.value,'${pl.id}')" style="font-size:12px;"><div class="subtext">Set this to the address the ERP is hosted at so the links work for people outside Demand School.</div></div>
    </div>
    <div class="modal-foot"><div></div><button type="button" class="btn primary" onclick="closeModal();render();">Done</button></div>`, true);
}
function setReviewLinkBase(v, plId){ reviewLinkBase = String(v||"").trim().split('#')[0]; openReviewLinks(plId); }
function copyReviewLink(plId, kind){
  const pl = placements.find(x=>x.id===plId); if(!pl) return;
  const link = reviewLinkFor(pl, kind);
  const done = ()=>{ markReviewRequested(pl, kind); toast("Link copied — send it to them"); openReviewLinks(plId); };
  const fallback = ()=>{ const el = document.getElementById('rl-'+kind); if(el){ el.focus(); el.select(); try{ document.execCommand('copy'); }catch(e){} } done(); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, fallback); else fallback();
}
function shareReviewWhatsApp(plId, kind){
  const pl = placements.find(x=>x.id===plId); if(!pl) return;
  const partner = partnerById(pl.partnerId), s = studentById(pl.studentId);
  let digits = String((kind==='partner' ? (s&&s.phone) : partner.phone) || "").replace(/\D/g,"");
  if(digits.length===10) digits = "91"+digits;
  const url = "https://wa.me/" + digits + "?text=" + encodeURIComponent(reviewMessageFor(pl, kind, reviewLinkFor(pl, kind)));
  window.open(url, "_blank", "noopener");
  markReviewRequested(pl, kind); toast("WhatsApp opened with the link"); openReviewLinks(plId);
}

/* The page a student or partner sees when they open their link — nothing from the ERP shows. It talks only to
   /api/review, which looks the secret token up on the server and returns just the names the form needs. */
let reviewPageState = null;
async function reviewApi(method, token, body){
  const opts = {method, headers:{'Content-Type':'application/json','X-Requested-With':'demand-erp'}};
  if(body) opts.body = JSON.stringify({...body, token});
  const res = await fetch('/api/review'+(method==='GET'?'?token='+encodeURIComponent(token):''), opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw Object.assign(new Error(data.error||'Something went wrong'), {status:res.status});
  return data;
}
function routeReviewLink(){
  const shell = document.getElementById('review-shell'); if(!shell) return;
  const m = /^#review=([A-Za-z0-9]+)$/.exec(location.hash || "");
  if(!m){
    const wasOpen = !shell.hidden;
    shell.hidden = true; shell.innerHTML = ""; reviewPageState = null;
    if(wasOpen && currentUser && !document.getElementById('app-shell').hidden) render();
    return;
  }
  const state = reviewPageState = {token:m[1], rating:0, done:false, info:null, status:'loading'};
  shell.hidden = false; renderReviewPage();
  reviewApi('GET', m[1]).then(info=>{ if(reviewPageState!==state) return; state.info = info; state.done = info.done; state.status = 'ready'; renderReviewPage(); })
    .catch(err=>{ if(reviewPageState!==state) return; state.status = err.status===429 ? 'busy' : 'invalid'; renderReviewPage(); });
}
const REVIEW_STAR_WORDS = ["", "Very poor", "Poor", "Average", "Good", "Excellent"];
function renderReviewPage(){
  const shell = document.getElementById('review-shell'); if(!shell || !reviewPageState) return;
  const brand = `<div class="review-brand">DEMAND SCHOOL · INTERNSHIP FEEDBACK</div>`;
  const st = reviewPageState, card = (h, msg)=>{ shell.innerHTML = `<div class="review-card">${brand}<h2>${h}</h2><div class="muted">${msg}</div></div>`; };
  if(st.status==='loading') return card('Loading…','');
  if(st.status==='busy') return card('Please try again later','Too many attempts from this connection.');
  if(st.status==='invalid') return card("This link isn't valid", 'It may have been replaced. Please ask the Demand School placements team for a new one.');
  const {kind, partnerName, studentName, role, contactName} = st.info;
  if(st.done) return card(st.submitted ? 'Thank you!' : 'Feedback already received', st.submitted ? 'Your feedback has been shared with the Demand School team.' : 'This link has already been used. Thank you!');
  const title = kind==='partner' ? `How was your internship at ${esc(partnerName)}?` : `How was ${esc(studentName)} as an intern?`;
  const sub = kind==='partner' ? `${esc(role||'Internship')} · your honest feedback helps future students choose, and helps us improve our partners.` : `${esc(partnerName)}${role?' · '+esc(role):''} · your feedback helps us coach our students.`;
  const defName = kind==='partner' ? studentName : (contactName||"");
  shell.innerHTML = `<form class="review-card" id="f-review-public" onsubmit="submitReviewPage(event)">${brand}
    <div><h2>${title}</h2><div class="muted" style="margin-top:6px;font-size:13px;">${sub}</div></div>
    <div><label class="field-label">Overall rating</label>
      <div class="review-stars">${[1,2,3,4,5].map(n=>`<button type="button" class="review-star" data-n="${n}" aria-label="${n} star${n>1?'s':''}" onclick="setReviewStars(${n})">★</button>`).join('')}</div>
      <div class="subtext" id="review-star-word" style="margin-top:4px;">Tap a star</div></div>
    <div><label class="field-label">${kind==='partner'?'What was it like? (learning, mentoring, work culture)':'How did they do? (skills, attitude, reliability)'}</label><textarea class="field-input" name="text" rows="5" maxlength="1500"></textarea></div>
    <div><label class="field-label">Your name</label><input class="field-input" name="by" maxlength="80" value="${esc(defName)}"></div>
    <div class="subtext" id="review-error" style="color:var(--neg);" hidden></div>
    <button type="submit" class="btn primary" style="justify-content:center;padding:11px 14px;">Submit feedback</button>
  </form>`;
}
function setReviewStars(n){
  if(!reviewPageState) return;
  reviewPageState.rating = n;
  document.querySelectorAll('#review-shell .review-star').forEach(b=>b.classList.toggle('on', Number(b.dataset.n)<=n));
  const w = document.getElementById('review-star-word'); if(w) w.textContent = REVIEW_STAR_WORDS[n];
  const er = document.getElementById('review-error'); if(er) er.hidden = true;
}
async function submitReviewPage(e){
  e.preventDefault();
  const st = reviewPageState; if(!st) return;
  const er = document.getElementById('review-error');
  if(!st.rating){ if(er){ er.textContent = "Please choose a star rating."; er.hidden = false; } return; }
  const f = new FormData(e.target), btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try{
    await reviewApi('POST', st.token, {rating:st.rating, text:f.get("text"), by:f.get("by")});
    st.done = true; st.submitted = true; renderReviewPage();
  }catch(err){ btn.disabled = false; if(er){ er.textContent = err.message; er.hidden = false; } }
}
window.addEventListener('hashchange', routeReviewLink);

/* ---- Student page hook ---- */
function studentPlacementButtonHTML(c){
  if(!courseOffersInternship(c.course)) return '';
  const pl = activePlacementOf(c.id);
  if(pl){
    const partner = pl.partnerId ? partnerById(pl.partnerId) : null;
    return `<button class="btn" onclick="openPlacementModal('${pl.id}')">Placement: ${esc(pl.status)}${partner?' · '+esc(partner.name):''}</button>`;
  }
  return `<button class="btn" onclick="openRegisterPlacement('${c.id}')">Register for placement</button>`;
}

