INSERT INTO tours (
  id, title, destination, description, duration_days, pricing_mode,
  price_per_person, currency, image_url, highlights, kosher_available, status
) VALUES (
  '6a7b6f299daf43dc1b1a30c9',
  '10-Day Kruger, Johannesburg & Cape Town',
  'Kruger, Johannesburg & Cape Town, South Africa',
  'A 10-day South Africa journey combining Kruger National Park, Johannesburg and Cape Town. Kosher services and Shabbat planning are available where arranged for the itinerary.',
  10,
  'on_enquiry',
  NULL,
  'USD',
  'https://images.unsplash.com/photo-1681829496174-e9b03398a0a9?auto=format&fit=crop&w=1200&q=82',
  'Kruger National Park game drives; Johannesburg touring; Cape Town; Kosher available; Shabbat planning available',
  1,
  'active'
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  destination = excluded.destination,
  description = excluded.description,
  duration_days = excluded.duration_days,
  pricing_mode = excluded.pricing_mode,
  price_per_person = excluded.price_per_person,
  currency = excluded.currency,
  image_url = excluded.image_url,
  highlights = excluded.highlights,
  kosher_available = excluded.kosher_available,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;
