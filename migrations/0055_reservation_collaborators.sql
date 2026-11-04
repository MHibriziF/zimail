-- Addresses invited to every booking on a page, alongside the guest.
-- A JSON array of lowercase emails; NULL when the page has none.
ALTER TABLE reservation_pages ADD COLUMN collaborators TEXT;
