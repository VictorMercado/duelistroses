-- Every card is drawn from its numbered art (cards/NNN.png, now upscaled to
-- 512x512), so the separate HD art ("imageHd", cards/hd/...) is no longer
-- used, and a holo mask must be the numbered art's own (cards/NNN_Mask.png,
-- made by scripts/content/build_masks.py) to line up with it.
--
-- Cards 0-853 and the gods 902-904 have a numbered mask; Pot of Greed (900)
-- and Trap Hole (901) do not. A mask an administrator pointed somewhere else
-- through the card admin is kept, unless it was one of the old HD masks.

UPDATE cards SET data = json_remove(data, '$.imageHd') WHERE json_extract(data, '$.imageHd') IS NOT NULL;

UPDATE cards SET data = json_set(data, '$.mask', printf('cards/%03d_Mask.png', num))
WHERE (num BETWEEN 0 AND 853 OR num IN (902, 903, 904))
  AND (json_extract(data, '$.mask') IS NULL OR json_extract(data, '$.mask') LIKE 'cards/hd/%');
