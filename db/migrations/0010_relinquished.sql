-- Relinquished (905), a ritual monster, and Black Illusion Ritual (906), the
-- ritual card that summons it. Relinquished's "absorb" ability is in
-- game/engine/absorb.go. A fresh database is seeded from cards.json after
-- migrations run, so these rows are only added to a catalog that is already
-- there (card 0 exists).

INSERT OR IGNORE INTO cards (num, data, updated_at, updated_by) SELECT 905, '{"num":905,"name":"Relinquished","kind":"monster","deckCost":50,"type":"spellcaster","attribute":"dark","level":1,"atk":0,"def":0,"text":"Once per turn, absorbs an enemy monster on a square next to it: Relinquished''s ATK and DEF become that monster''s. If Relinquished would be destroyed in battle, the absorbed monster is destroyed instead.","implemented":true,"abilities":[{"op":"absorb"}],"image":"cards/905.png","mask":"cards/905_Mask.png","custom":true}', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'migration' WHERE EXISTS (SELECT 1 FROM cards WHERE num = 0);
INSERT OR IGNORE INTO cards (num, data, updated_at, updated_by) SELECT 906, '{"num":906,"name":"Black Illusion Ritual","kind":"ritual","deckCost":5,"text":"Sacrifice 2 SPELLCASTER monsters and 1 FIEND monster to summon Relinquished.","implemented":true,"image":"cards/906.png","effect":{"op":"ritual","summon":905,"tributes":[{"type":"spellcaster"},{"type":"spellcaster"},{"type":"fiend"}]},"mask":"cards/906_Mask.png","custom":true}', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'migration' WHERE EXISTS (SELECT 1 FROM cards WHERE num = 0);
