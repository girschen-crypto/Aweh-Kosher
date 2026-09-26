CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tours (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  destination TEXT NOT NULL,
  description TEXT,
  duration_days INTEGER NOT NULL DEFAULT 1,
  pricing_mode TEXT NOT NULL DEFAULT 'on_enquiry' CHECK (pricing_mode IN ('on_enquiry','fixed')),
  price_per_person REAL,
  cost_per_person REAL,
  currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (currency IN ('ZAR','USD','EUR','GBP')),
  partner_name TEXT,
  partner_base_price REAL,
  markup_per_person REAL NOT NULL DEFAULT 0,
  image_url TEXT,
  highlights TEXT,
  kosher_available INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_phone TEXT,
  tour_id TEXT,
  tour_title TEXT,
  destination TEXT,
  start_date TEXT,
  num_guests INTEGER NOT NULL DEFAULT 1,
  supplier_id TEXT,
  supplier_name TEXT,
  cost_price REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (currency IN ('ZAR','USD','EUR','GBP')),
  commission_status TEXT NOT NULL DEFAULT 'owed' CHECK (commission_status IN ('owed','paid')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','deposit','paid')),
  supplier_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enquiry' CHECK (status IN ('enquiry','quoted','confirmed','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tour_id) REFERENCES tours(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_reference TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'staff' CHECK (author_role IN ('client','staff','ai')),
  author_name TEXT,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'site' CHECK (channel IN ('site','whatsapp','email','internal')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_reference) REFERENCES bookings(reference)
);

CREATE TABLE IF NOT EXISTS usage_limits (
  limit_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tours_status ON tours(status);
CREATE INDEX IF NOT EXISTS idx_tours_destination ON tours(destination);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(reference);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(client_email);
CREATE INDEX IF NOT EXISTS idx_messages_booking_reference ON messages(booking_reference);
CREATE INDEX IF NOT EXISTS idx_usage_limits_updated_at ON usage_limits(updated_at);
