// Label for ANY month ("2026-10" -> "October 2026"), not just the two months the sample data covers.
const MONTH_LABEL = new Proxy({}, {
  get:(t,k)=> (typeof k==="string" && /^\d{4}-\d{2}$/.test(k)) ? monthLabel(k) : undefined,
  has:(t,k)=> typeof k==="string" && /^\d{4}-\d{2}$/.test(k)
});
