-- The Egyptian God cards (902-904) are no longer one picture of the whole
-- card. Each is drawn like every other card: its art alone, on a template of
-- its own ("ownFrame": textures/god<Name>Template.png), with the game's level
-- stars, DIVINE attribute icon and ATK/DEF on top, and a holo mask. The art,
-- templates and masks are made by scripts/content/build_god_cards.py and
-- build_masks.py. A god someone has already changed through the card admin
-- (no longer "fullArt") is left as it is.

UPDATE cards SET data = json_remove(json_set(data, '$.image', 'cards/902.png', '$.mask', 'cards/902_Mask.png', '$.ownFrame', 'godObelisk'), '$.fullArt') WHERE num = 902 AND json_extract(data, '$.fullArt') = 1;
UPDATE cards SET data = json_remove(json_set(data, '$.image', 'cards/903.png', '$.mask', 'cards/903_Mask.png', '$.ownFrame', 'godSlifer'), '$.fullArt') WHERE num = 903 AND json_extract(data, '$.fullArt') = 1;
UPDATE cards SET data = json_remove(json_set(data, '$.image', 'cards/904.png', '$.mask', 'cards/904_Mask.png', '$.ownFrame', 'godRa'), '$.fullArt') WHERE num = 904 AND json_extract(data, '$.fullArt') = 1;
