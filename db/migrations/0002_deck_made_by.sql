-- Who built a deck, when it is not its owner: a friend, or an administrator.
-- Empty for a deck its owner built.
ALTER TABLE decks ADD COLUMN made_by_id TEXT NOT NULL DEFAULT '';
ALTER TABLE decks ADD COLUMN made_by_name TEXT NOT NULL DEFAULT '';
CREATE INDEX decks_made_by ON decks (made_by_id);
