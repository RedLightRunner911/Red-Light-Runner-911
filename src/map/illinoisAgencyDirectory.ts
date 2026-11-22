import './illinoisAgencyDirectory.css';

export interface IllinoisAgency { code: string; name: string; rows: number; page: number; summaryPage: number; incomplete: boolean }
interface Directory { year: number; rows: number; report: string; agencies: IllinoisAgency[] }

export function matchingAgencies(agencies: IllinoisAgency[], query: string) {
  const terms = query.trim().toUpperCase().split(/\s+/);
  return agencies.filter(agency => terms.every(term => (agency.name + ' ' + agency.code).includes(term)));
}

const pageSize = 10;
export function mountIllinoisDirectory(root: HTMLDetailsElement | null) {
  if (!root) return;
  const body = document.createElement('div');
  body.className = 'il-directory-body';
  root.append(body);
  let loaded = false;

  async function load() {
    if (loaded || !root?.open) return;
    loaded = true;
    body.textContent = 'Loading agency totals…';
    try {
      const response = await fetch(import.meta.env.BASE_URL + 'data/illinois-2025/agencies.json');
      if (!response.ok) throw Error(String(response.status));
      const data: Directory = await response.json();
      renderDirectory(body, data);
    } catch {
      loaded = false;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.onclick = load;
      body.replaceChildren('Agency totals could not be loaded. ', retry);
    }
  }
  root.addEventListener('toggle', load);
  void load();
}

function sourceLink(url: string, label: string) {
  const a = document.createElement('a');
  a.href = url;
  a.textContent = label;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function renderDirectory(body: HTMLElement, data: Directory) {
  const summary = document.createElement('p');
  summary.append(data.rows.toLocaleString() + ' reported traffic stops across ' + data.agencies.length +
    ' agencies in ' + data.year + '. Totals identify the reporting agency. ', sourceLink(data.report + '#page=6', 'IDOT study'));
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Agency name or code';
  input.setAttribute('aria-label', 'Search Illinois agencies by name or code');
  const status = document.createElement('small');
  status.setAttribute('role', 'status');
  const list = document.createElement('ul');
  const nav = document.createElement('div');
  const previous = document.createElement('button'), next = document.createElement('button');
  previous.type = next.type = 'button';
  previous.textContent = 'Previous';
  next.textContent = 'Next';
  nav.append(previous, next);
  let page = 0;
  function display() {
    const matches = matchingAgencies(data.agencies, input.value);
    const start = page * pageSize;
    list.replaceChildren();
    for (const agency of matches.slice(start, start + pageSize)) {
      const item = document.createElement('li');
      const count = document.createElement('strong');
      count.textContent = agency.rows.toLocaleString();
      item.append(sourceLink(data.report + '#page=' + agency.summaryPage, agency.name), ' (',
        sourceLink(data.report + '#page=' + agency.page, agency.code), ') · ', count);
      if (agency.incomplete) {
        const note = document.createElement('small');
        note.textContent = 'IDOT marks this agency’s 2025 submission as incomplete.';
        item.append(note);
      }
      if (agency.code === '13478') {
        const note = document.createElement('small');
        note.append('Revised agency total. The eight local area codes have no verified boundaries. ',
          sourceLink('https://maps.lakecountyil.gov/Output/DistrictMaps/city/VillageofLakeBluff.pdf', 'Village boundary'));
        item.append(note);
      }
      if (agency.code === '13194') {
        const note = document.createElement('small');
        note.textContent = '222,967 rows appear on 274 Chicago beats. The total includes 1,884 outside-city rows.';
        item.append(note);
      }
      if (agency.code === '13805') {
        const note = document.createElement('small');
        note.textContent = '9,934 rows appear on 8 Springfield police beats.';
        item.append(note);
      }
      if (agency.code === '13111') {
        const note = document.createElement('small');
        note.textContent = '4,691 rows appear on 4 Champaign police districts (CHN, CHS, CHNW, CHSW, without regard to case). 10 rows have location codes that do not match a district and are not shaded.';
        item.append(note);
      }
      if (agency.code === '13100') {
        const note = document.createElement('small');
        note.textContent = 'Location codes are recorded, including 61–65, but no free public beat-boundary file is available, so these stops are not shaded.';
        item.append(note);
      }
      if (agency.code === '13588') {
        const note = document.createElement('small');
        note.textContent = 'Location codes 801–810 are consistent, but no free public beat-boundary file is available, so these stops are not shaded.';
        item.append(note);
      }
      list.append(item);
    }
    status.textContent = matches.length ? 'Showing ' + (start + 1) + '–' + Math.min(start + pageSize, matches.length) +
      ' of ' + matches.length + ' agencies' : 'No matching agencies';
    nav.hidden = matches.length <= pageSize;
    previous.disabled = page === 0;
    next.disabled = start + pageSize >= matches.length;
  }
  input.oninput = () => { page = 0; display(); };
  previous.onclick = () => { page--; display(); };
  next.onclick = () => { page++; display(); };
  body.replaceChildren(summary, input, status, list, nav);
  display();
}
