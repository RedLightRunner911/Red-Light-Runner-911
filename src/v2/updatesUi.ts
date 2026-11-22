import { loadUpdates, readIds, markRead, unreadCount, debugMailto, type UpdatePost } from './updates';
declare const __APP_VERSION__: string;
const ver = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (d: string) => { const t = new Date(d + 'T12:00:00'); return isNaN(+t) ? d : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

/** Bell + Updates drawer + debug-help mailto. */
export function mountUpdates(o: { native: boolean; openSettings: () => void }) {
  const $ = (id: string) => document.getElementById(id)!;
  const drawer = $('updates'), list = $('updates-list'), badge = $('updates-badge');
  let posts: UpdatePost[] = [];
  const render = () => {
    const read = readIds(localStorage), n = unreadCount(posts, read);
    badge.hidden = n === 0; badge.textContent = n > 9 ? '9+' : String(n);
    list.innerHTML = posts.length ? posts.map(p => `<li class="post${read.has(p.id) ? '' : ' unread'}"><div class="post-head"><b>${esc(p.title)}</b><time>${esc(fmt(p.date))}</time></div><p>${esc(p.body)}</p></li>`).join('')
      : '<li class="empty">No updates yet.</li>';
  };
  const setOpen = (open: boolean) => {
    drawer.classList.toggle('open', open); drawer.setAttribute('aria-hidden', String(!open)); $('scrim').hidden = !open;
    if (!open && posts.length) { markRead(localStorage, posts.map(p => p.id)); render(); } // unread dots stay visible while the sheet is open
  };
  $('open-updates').onclick = () => { render(); setOpen(true); };
  $('close-updates').onclick = () => setOpen(false);
  const local = `${import.meta.env.BASE_URL}updates.json`;
  // Bundled copy only: never contacts the original developer's site.
  void loadUpdates([local]).then(p => { posts = p; render(); });
  ($('mail-debug') as HTMLAnchorElement).href = debugMailto(ver);
  $('updates-help').onclick = () => { setOpen(false); o.openSettings(); ($('help-section') as HTMLDetailsElement).open = true; const h = $('help') as HTMLDetailsElement; h.open = true; h.scrollIntoView({ block: 'start' }); };
  if (location.hash === '#updates') setOpen(true);
  return { close: () => { if (drawer.classList.contains('open')) setOpen(false); } };
}
