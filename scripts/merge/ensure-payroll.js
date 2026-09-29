// Payroll keeps one sheet per month, but the sample data only has Aug/Sep 2026. Make sure every month from the
// earliest sheet up to the current one exists (empty until HR adds people), or the payroll and accounts screens
// would break the moment a new month starts. Called at load and whenever payroll is replaced from the server.
function ensurePayrollMonths(){
  const cur = TODAY.slice(0,7);
  const keys = Object.keys(payroll.history).concat(cur).sort();
  let [y,m] = keys[0].split('-').map(Number);
  const [ey,em] = keys[keys.length-1].split('-').map(Number);
  while(y<ey || (y===ey && m<=em)){
    const k = y+'-'+String(m).padStart(2,'0');
    if(!payroll.history[k]) payroll.history[k] = {entries:{}};
    if(++m>12){ m=1; y++; }
  }
  if(!payroll.history[payroll.selectedMonth]) payroll.selectedMonth = cur;
}
ensurePayrollMonths();

