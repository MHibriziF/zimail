-- The most bookings a page takes on one day, counted in the page's time zone.
-- NULL means no limit.
ALTER TABLE reservation_pages ADD COLUMN max_per_day INTEGER;
