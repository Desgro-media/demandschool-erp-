/* Reuse the existing role-filtered sidebar as a mobile navigation drawer. */
let mobileNavigationShell=null, mobileNavigationTrigger=null;
const mobileNavigationMedia=window.matchMedia('(max-width: 1040px)');
function closeMobileNavigation(restoreFocus=true){
  if(!mobileNavigationShell)return;
  const shell=mobileNavigationShell, trigger=mobileNavigationTrigger;
  shell.querySelector('.main').inert=false;
  shell.classList.remove('mobile-nav-active');
  document.body.classList.remove('mobile-nav-open');
  document.getElementById('mobile-nav-backdrop').hidden=true;
  trigger?.setAttribute('aria-expanded','false');
  const side=shell.querySelector('.side');side.removeAttribute('role');side.removeAttribute('aria-modal');
  mobileNavigationShell=null;mobileNavigationTrigger=null;
  if(restoreFocus && trigger?.isConnected)trigger.focus();
}
function openMobileNavigation(shell,trigger){
  if(!mobileNavigationMedia.matches)return;
  closeMobileNavigation(false);
  mobileNavigationShell=shell;mobileNavigationTrigger=trigger;
  shell.classList.add('mobile-nav-active');document.body.classList.add('mobile-nav-open');
  document.getElementById('mobile-nav-backdrop').hidden=false;
  const side=shell.querySelector('.side');side.setAttribute('role','dialog');side.setAttribute('aria-modal','true');
  trigger.setAttribute('aria-expanded','true');shell.querySelector('.main').inert=true;
  side.querySelector('.mobile-menu-close').focus();
}
function prepareMobileNavigation(){
  const backdrop=document.createElement('div');backdrop.id='mobile-nav-backdrop';backdrop.className='mobile-nav-backdrop';backdrop.hidden=true;backdrop.addEventListener('click',()=>closeMobileNavigation());document.body.appendChild(backdrop);
  for(const shell of document.querySelectorAll('.app')){
    const side=shell.querySelector('.side'),topbar=shell.querySelector('.topbar');if(!side||!topbar)continue;
    side.id=shell.id+'-navigation';side.setAttribute('aria-label','Main navigation');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='icon-btn mobile-menu-toggle';
    toggle.setAttribute('aria-label','Open navigation');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',side.id);
    toggle.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    toggle.addEventListener('click',()=>openMobileNavigation(shell,toggle));topbar.prepend(toggle);
    const close=document.createElement('button');close.type='button';close.className='icon-btn mobile-menu-close';close.setAttribute('aria-label','Close navigation');
    close.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    close.addEventListener('click',()=>closeMobileNavigation());side.prepend(close);
  }
}
document.addEventListener('keydown',event=>{
  if(!mobileNavigationShell)return;
  if(event.key==='Escape'){event.preventDefault();closeMobileNavigation();return;}
  if(event.key!=='Tab')return;
  const buttons=[...mobileNavigationShell.querySelector('.side').querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')].filter(el=>el.getClientRects().length);
  if(!buttons.length)return;
  const first=buttons[0],last=buttons.at(-1);
  if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
});
mobileNavigationMedia.addEventListener('change',()=>closeMobileNavigation());
prepareMobileNavigation();
// Make wide data regions keyboard reachable as well as touch-scrollable.
function prepareMobileScrollRegions(){
  for(const el of document.querySelectorAll('.table-wrap,.board-scroll')){
    if(el.hasAttribute('tabindex'))continue;
    el.tabIndex=0;el.setAttribute('role','region');
    const heading=el.closest('.panel')?.querySelector('h3')?.textContent;
    el.setAttribute('aria-label',(heading || (el.classList.contains('board-scroll')?'Task board':'Data table'))+' — scroll horizontally for more');
  }
}
const mobileLayoutObserver=new MutationObserver(prepareMobileScrollRegions);
for(const el of document.querySelectorAll('#content,#student-content,#modal'))mobileLayoutObserver.observe(el,{childList:true,subtree:true});
prepareMobileScrollRegions();
