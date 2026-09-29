// "Today" is the real local date, read when the page loads. A tab left open past midnight saves and reloads itself
// (see the rollover check in the sync layer), so the date, month and attendance always roll over together.
const localISODate = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const TODAY = localISODate();
