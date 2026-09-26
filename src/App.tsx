import { FormEvent, useEffect, useMemo, useState } from 'react';

type Tour = {
  id: string;
  title: string;
  destination: string;
  description?: string | null;
  duration_days?: number | null;
  pricing_mode?: 'on_enquiry' | 'fixed' | null;
  price_per_person?: number | null;
  currency?: string | null;
  image_url?: string | null;
  highlights?: string | null;
  kosher_available?: boolean | number | null;
};

type Enquiry = {
  client_name: string;
  client_email: string;
  client_phone: string;
  tour_id: string;
  destination: string;
  start_date: string;
  num_guests: string;
  notes: string;
};

const initialEnquiry: Enquiry = {
  client_name: '',
  client_email: '',
  client_phone: '',
  tour_id: '',
  destination: '',
  start_date: '',
  num_guests: '2',
  notes: '',
};

type Planner = {
  days: string;
  base: string;
  style: string;
  adults: string;
  children: string;
  kosher: boolean;
  kosher_level: string;
};

const initialPlanner: Planner = {
  days: '3',
  base: 'Tsitsikamma',
  style: 'Adventure + scenery',
  adults: '2',
  children: '0',
  kosher: false,
  kosher_level: 'Kosher meals where arranged',
};

const partnerLinks = {
  activities: (import.meta.env.VITE_VIATOR_AFFILIATE_URL || '').trim(),
  stays: (import.meta.env.VITE_BOOKING_AFFILIATE_URL || '').trim(),
  guides: (import.meta.env.VITE_GUIDEGO_PUBLIC_URL || '').trim(),
};

function buildQuickPlan(planner: Planner) {
  const days = Math.max(1, Math.min(5, Number(planner.days) || 3));
  const base = planner.base || 'Tsitsikamma';
  const style = planner.style || 'Adventure + scenery';
  const templates: Record<string, string[]> = {
    'Tsitsikamma': [
      'Storms River Mouth: suspension-bridge area, viewpoints and an easy coastal walk.',
      'Tsitsikamma Forest: Big Tree / forest experience plus a local lunch stop.',
      'Adventure day: zipline, kayaking or a guided activity matched to the group.',
      'Nature’s Valley / The Crags: scenic Garden Route drive with an experience stop.',
      'Plettenberg Bay: beach, viewpoints and a flexible activity or food stop.',
    ],
    'Plettenberg Bay': [
      'Plettenberg Bay orientation: viewpoints, beach time and a relaxed local meal.',
      'The Crags / Nature’s Valley: wildlife or adventure experience and scenic stops.',
      'Tsitsikamma day trip: Storms River Mouth and forest highlights.',
      'Ocean day: marine, boat or coastal activity subject to conditions.',
      'Flexible final day: food, shopping, beach or another booked experience.',
    ],
    'Garden Route': [
      'George / Wilderness: scenic start with lakes, viewpoints and local stops.',
      'Knysna: lagoon, Heads and a flexible experience.',
      'Plettenberg Bay / The Crags: beach, wildlife or adventure.',
      'Tsitsikamma: forest and Storms River Mouth.',
      'Buffer day: use for weather, a premium activity or onward transfer.',
    ],
  };
  const selected = templates[base] || templates['Tsitsikamma'];
  return {
    title: `${days}-day ${base} starter plan`,
    subtitle: `${style} · ${planner.adults || '2'} adult(s) · ${planner.children || '0'} child(ren)${planner.kosher ? ` · ${planner.kosher_level}` : ''}`,
    days: selected.slice(0, days),
  };
}

const money = (value: number, currency = 'ZAR') =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

function highlightList(value?: string | null) {
  if (!value) return [];
  return value.split(/\n|•|;/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
}

export default function App() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [loadingTours, setLoadingTours] = useState(true);
  const [tourError, setTourError] = useState('');
  const [enquiry, setEnquiry] = useState<Enquiry>(initialEnquiry);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; reference?: string } | null>(null);
  const [planner, setPlanner] = useState<Planner>(initialPlanner);
  const [quickPlan, setQuickPlan] = useState<ReturnType<typeof buildQuickPlan> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tours', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Tours could not be loaded.');
        if (!cancelled) setTours(Array.isArray(data.tours) ? data.tours : []);
      })
      .catch(() => {
        if (!cancelled) setTourError('Our tour list is being updated. You can still send a custom trip enquiry below.');
      })
      .finally(() => { if (!cancelled) setLoadingTours(false); });
    return () => { cancelled = true; };
  }, []);

  const selectedTour = useMemo(
    () => tours.find((tour) => String(tour.id) === enquiry.tour_id),
    [tours, enquiry.tour_id],
  );

  const requestService = (service: 'activities' | 'stays' | 'guides') => {
    const external = partnerLinks[service];
    if (external) {
      window.open(external, '_blank', 'noopener,noreferrer');
      return;
    }
    const labels = { activities: 'activities / experiences', stays: 'accommodation', guides: 'a local guide' };
    setEnquiry((current) => ({
      ...current,
      destination: planner.base || current.destination,
      num_guests: String((Number(planner.adults) || 0) + (Number(planner.children) || 0) || 1),
      notes: `Revenue-engine lead: Please help me book ${labels[service]} for a ${planner.days}-day ${planner.base} trip. Travel style: ${planner.style}. Adults: ${planner.adults}. Children: ${planner.children}. Kosher requirement: ${planner.kosher ? planner.kosher_level : 'No'}.`,
    }));
    document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const chooseTour = (tour: Tour) => {
    setEnquiry((current) => ({
      ...current,
      tour_id: String(tour.id),
      destination: tour.destination || current.destination,
    }));
    document.getElementById('plan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: enquiry.client_name,
          client_email: enquiry.client_email,
          client_phone: enquiry.client_phone,
          tour_id: enquiry.tour_id || undefined,
          destination: enquiry.destination,
          start_date: enquiry.start_date || undefined,
          num_guests: Number(enquiry.num_guests || 1),
          notes: enquiry.notes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your enquiry could not be sent.');
      setResult({ ok: true, message: data.message || 'Your Travel Aweh enquiry has been received.', reference: data.reference });
      setEnquiry(initialEnquiry);
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : 'Your enquiry could not be sent.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <div className="shell nav">
          <a className="brand" href="#top" aria-label="Travel Aweh home">
            <span className="brandMark">A</span>
            <span><strong>Travel Aweh</strong><small>Southern Africa, your way</small></span>
          </a>
          <nav className="navlinks" aria-label="Main navigation">
            <a href="#planner">Quick planner</a>
            <a href="#journeys">Journeys</a>
            <a href="#kosher">Kosher available</a>
            <a href="#plan" className="navCta">Plan a trip</a>
          </nav>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="shell heroGrid">
          <div className="heroCopy">
            <p className="eyebrow">TAILORED SOUTHERN AFRICAN TRAVEL</p>
            <h1>See Africa properly.<br /><span>We’ll handle the details.</span></h1>
            <p className="lead">Travel Aweh brings the route, stays, transfers, tours and safaris together around the way you actually want to travel. Kosher services are available where arranged.</p>
            <div className="heroActions">
              <a className="button primary" href="#plan">Plan my trip</a>
              <a className="button secondary" href="#journeys">Explore journeys</a>
            </div>
            <div className="trustRow" aria-label="Travel Aweh service promises">
              <span>Tailored itineraries</span>
              <span>Local coordination</span>
              <span>Kosher available</span>
            </div>
          </div>
          <aside className="heroPanel">
            <p className="panelKicker">YOUR TRIP, BUILT AROUND YOU</p>
            <h2>From the first airport pickup to the last safari sunrise.</h2>
            <div className="routeLine"><span>01</span><div><strong>Tell us where</strong><small>Destination, dates and group size.</small></div></div>
            <div className="routeLine"><span>02</span><div><strong>We shape the journey</strong><small>Stays, transport, experiences and practical needs.</small></div></div>
            <div className="routeLine"><span>03</span><div><strong>You travel</strong><small>With one clear plan and local support.</small></div></div>
          </aside>
        </div>
      </section>

      <section className="intro shell">
        <div><p className="eyebrow dark">WHY TRAVEL AWEH</p><h2>Africa is better when the logistics disappear.</h2></div>
        <p>We focus on practical, well-coordinated travel. That means a journey that makes sense on the ground, not an itinerary that only looks good on paper.</p>
      </section>


      <section className="section plannerSection" id="planner">
        <div className="shell plannerGrid">
          <div className="plannerIntro">
            <p className="eyebrow dark">FREE GARDEN ROUTE PLANNER</p>
            <h2>Build a useful trip outline in under a minute.</h2>
            <p>Start with a simple route. Then book the parts you need: accommodation, activities and a local guide.</p>
            <div className="plannerForm">
              <label>Days
                <select value={planner.days} onChange={(e) => setPlanner({ ...planner, days: e.target.value })}>
                  <option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option><option value="4">4 days</option><option value="5">5 days</option>
                </select>
              </label>
              <label>Base
                <select value={planner.base} onChange={(e) => setPlanner({ ...planner, base: e.target.value })}>
                  <option>Tsitsikamma</option><option>Plettenberg Bay</option><option>Garden Route</option>
                </select>
              </label>
              <label>Travel style
                <select value={planner.style} onChange={(e) => setPlanner({ ...planner, style: e.target.value })}>
                  <option>Adventure + scenery</option><option>Family</option><option>Relaxed</option><option>Food + scenery</option>
                </select>
              </label>
              <label>Adults<input min="1" max="20" type="number" value={planner.adults} onChange={(e) => setPlanner({ ...planner, adults: e.target.value })} /></label>
              <label>Children<input min="0" max="20" type="number" value={planner.children} onChange={(e) => setPlanner({ ...planner, children: e.target.value })} /></label>
              <label className="kosherToggle">
                <span>Do you require Kosher arrangements?</span>
                <input type="checkbox" checked={planner.kosher} onChange={(e) => setPlanner({ ...planner, kosher: e.target.checked })} />
              </label>
              {planner.kosher && <label className="wide">Kosher requirement
                <select value={planner.kosher_level} onChange={(e) => setPlanner({ ...planner, kosher_level: e.target.value })}>
                  <option>Kosher meals where arranged</option>
                  <option>Strictly Kosher itinerary</option>
                  <option>Shabbat-aware itinerary</option>
                  <option>Kosher group / family travel</option>
                  <option>Discuss requirements with me</option>
                </select>
              </label>}
              <button className="button primary plannerButton" type="button" onClick={() => setQuickPlan(buildQuickPlan(planner))}>Build my free plan</button>
            </div>
          </div>
          <div className="plannerResult">
            {!quickPlan ? (
              <div className="plannerEmpty"><strong>Your route appears here.</strong><span>No login. No AI charge. Just a practical starting plan.</span></div>
            ) : (
              <>
                <p className="eyebrow dark">YOUR STARTER PLAN</p>
                <h3>{quickPlan.title}</h3>
                <p className="plannerSubtitle">{quickPlan.subtitle}</p>
                <ol>{quickPlan.days.map((day, index) => <li key={day}><span>Day {index + 1}</span><p>{day}</p></li>)}</ol>
                {planner.kosher && <div className="kosherPlanNote">
                  <strong>Kosher planning is active</strong>
                  <span>We will treat meals, accommodation suitability, routing and Shabbat considerations as part of the trip design rather than a last-minute request.</span>
                </div>}
                <div className="moneyActions">
                  <button onClick={() => requestService('stays')}>Find accommodation</button>
                  <button onClick={() => requestService('activities')}>Book activities</button>
                  <button onClick={() => requestService('guides')}>Get a local guide</button>
                </div>
                <small className="plannerDisclosure">Partner booking links can earn Travel Aweh commission at no extra cost to the traveller. Where a partner link is not yet active, we convert the request into a Travel Aweh booking enquiry.</small>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section journeys" id="journeys">
        <div className="shell">
          <div className="sectionHead">
            <div><p className="eyebrow dark">TOURS & SAFARIS</p><h2>Journeys to start with</h2></div>
            <p>Choose an existing journey or ask us to build something around your dates and priorities.</p>
          </div>

          {loadingTours && <div className="emptyCard">Loading current journeys…</div>}
          {!loadingTours && tourError && <div className="emptyCard">{tourError}</div>}
          {!loadingTours && !tourError && tours.length === 0 && (
            <div className="emptyCard">
              <strong>Our current journeys are being prepared.</strong>
              <span>You do not need to wait for a listed package. Tell us where you want to go and we’ll start with your trip.</span>
              <a className="textLink" href="#plan">Plan a custom journey →</a>
            </div>
          )}

          {tours.length > 0 && <div className="tourGrid">
            {tours.map((tour) => {
              const highlights = highlightList(tour.highlights);
              return (
                <article className="tourCard" key={tour.id}>
                  {tour.image_url ? <div className="tourImage" style={{ backgroundImage: `url(${tour.image_url})` }} /> : <div className="tourImage fallbackImage"><span>{tour.destination}</span></div>}
                  <div className="tourBody">
                    <div className="tourMeta">
                      <span>{tour.destination}</span>
                      {tour.duration_days ? <span>{tour.duration_days} day{tour.duration_days === 1 ? '' : 's'}</span> : null}
                    </div>
                    <h3>{tour.title}</h3>
                    {tour.description && <p>{tour.description}</p>}
                    {highlights.length > 0 && <ul>{highlights.map((item) => <li key={item}>{item}</li>)}</ul>}
                    <div className="tourFooter">
                      <div>
                        {tour.kosher_available ? <span className="kosherBadge">Kosher available</span> : <span className="quietBadge">Ask about dietary needs</span>}
                        {tour.pricing_mode === 'fixed' && Number(tour.price_per_person) > 0
                          ? <strong className="tourPrice">From {money(Number(tour.price_per_person), tour.currency || 'ZAR')} pp</strong>
                          : <strong className="tourPrice">Price on enquiry</strong>}
                      </div>
                      <button className="cardButton" onClick={() => chooseTour(tour)}>Enquire</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>}
        </div>
      </section>

      <section className="section kosherSection" id="kosher">
        <div className="shell kosherGrid">
          <div>
            <p className="eyebrow light">KOSHER AVAILABLE</p>
            <h2>Tell us what you require before we build the route.</h2>
          </div>
          <div className="kosherCopy">
            <p>Kosher requirements can affect accommodation, meals, routing, Shabbat planning and the people needed on the ground. We treat that as part of the trip design, not as a note added at the end.</p>
            <p>Availability and arrangements differ by destination and itinerary, so we confirm the actual requirements for each journey rather than making blanket promises.</p>
          </div>
        </div>
      </section>

      <section className="section planSection" id="plan">
        <div className="shell planGrid">
          <div className="planIntro">
            <p className="eyebrow dark">PLAN A TRIP</p>
            <h2>Give us the starting point.</h2>
            <p>You do not need to have the whole itinerary figured out. Send the basics and Travel Aweh can work from there.</p>
            <div className="planNote">
              <strong>What helps us quote properly</strong>
              <span>Dates or travel window</span>
              <span>Number of travellers</span>
              <span>Places you want to see</span>
              <span>Any dietary or practical requirements</span>
            </div>
          </div>

          <form className="enquiryForm" onSubmit={submit}>
            {selectedTour && <div className="selectedTour"><span>Selected journey</span><strong>{selectedTour.title}</strong><button type="button" onClick={() => setEnquiry((current) => ({ ...current, tour_id: '' }))}>Clear</button></div>}
            <div className="fieldGrid">
              <label>Full name<input required value={enquiry.client_name} onChange={(e) => setEnquiry({ ...enquiry, client_name: e.target.value })} /></label>
              <label>Email<input required type="email" value={enquiry.client_email} onChange={(e) => setEnquiry({ ...enquiry, client_email: e.target.value })} /></label>
              <label>Phone / WhatsApp<input value={enquiry.client_phone} onChange={(e) => setEnquiry({ ...enquiry, client_phone: e.target.value })} /></label>
              <label>Number of travellers<input min="1" max="100" type="number" value={enquiry.num_guests} onChange={(e) => setEnquiry({ ...enquiry, num_guests: e.target.value })} /></label>
              <label>Destination<input required={!enquiry.tour_id} placeholder="e.g. Cape Town, Kruger, Victoria Falls" value={enquiry.destination} onChange={(e) => setEnquiry({ ...enquiry, destination: e.target.value })} /></label>
              <label>Travel start date<input type="date" value={enquiry.start_date} onChange={(e) => setEnquiry({ ...enquiry, start_date: e.target.value })} /></label>
              <label className="wide">Tell us what you have in mind<textarea rows={5} placeholder="Route ideas, accommodation level, kosher requirements, activities, children, transfers or anything we should know." value={enquiry.notes} onChange={(e) => setEnquiry({ ...enquiry, notes: e.target.value })} /></label>
            </div>
            <button className="button primary submitButton" disabled={submitting}>{submitting ? 'Sending enquiry…' : 'Send trip enquiry'}</button>
            {result && <div className={`formResult ${result.ok ? 'success' : 'error'}`}>
              <strong>{result.ok ? 'Enquiry received' : 'Please check your enquiry'}</strong>
              <span>{result.message}</span>
              {result.reference && <span>Reference: <b>{result.reference}</b></span>}
            </div>}
            <p className="formPrivacy">Your enquiry is sent securely to Travel Aweh. Commercial supplier information is not exposed on this site.</p>
          </form>
        </div>
      </section>

      <footer className="footer">
        <div className="shell footerGrid">
          <a className="brand footerBrand" href="#top"><span className="brandMark">A</span><span><strong>Travel Aweh</strong><small>Southern Africa, your way</small></span></a>
          <p>Tailored travel · Tours & safaris · Kosher available where arranged</p>
          <a href="#plan">Plan a trip →</a>
        </div>
      </footer>
    </main>
  );
}
