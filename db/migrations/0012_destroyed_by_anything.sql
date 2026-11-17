-- Cards whose text says "When destroyed" (no "in battle") set off their
-- ability however they are destroyed: by a spell, a trap, another card's
-- ability, a blast or crush terrain, as well as in battle (trigger
-- "anyDestroy", see game/engine/abilities.go). Cards that say "destroyed in
-- battle" keep "destroyed". Each is left alone if an administrator already
-- changed that ability.

-- Hourglass of Life: "at the moment this card is destroyed".
UPDATE cards SET data = json_set(data, '$.abilities[0].on', 'anyDestroy')
WHERE num = 377
  AND json_extract(data, '$.abilities[0].op') = 'massRevive'
  AND json_extract(data, '$.abilities[0].on') = 'destroyed';

-- Larva of Moth: "If destroyed prior to transformation".
UPDATE cards SET data = json_set(data, '$.abilities[2].on', 'anyDestroy')
WHERE num = 427
  AND json_extract(data, '$.abilities[2].op') = 'reviveSelf'
  AND json_extract(data, '$.abilities[2].on') = 'destroyed';

-- Dorover: "When destroyed, spellbinds the enemy it engaged in battle".
UPDATE cards SET data = json_set(data, '$.abilities[0].on', 'anyDestroy')
WHERE num = 561
  AND json_extract(data, '$.abilities[0].op') = 'spellbindFoe'
  AND json_extract(data, '$.abilities[0].on') = 'destroyed';

-- Beastking of the Swamps: "When destroyed, destroys the enemy it engaged in battle with".
UPDATE cards SET data = json_set(data, '$.abilities[0].on', 'anyDestroy')
WHERE num = 567
  AND json_extract(data, '$.abilities[0].op') = 'destroyFoe'
  AND json_extract(data, '$.abilities[0].on') = 'destroyed';
