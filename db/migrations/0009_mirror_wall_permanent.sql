-- Mirror Wall is a permanent trap, as its text says: once it goes off it
-- stays face up and halves the ATK of every enemy monster that attacks after.
-- Left alone if an administrator already changed its effect.

UPDATE cards SET data = json_set(data, '$.effect.permanent', json('true'))
WHERE num = 829
  AND json_extract(data, '$.effect.op') = 'trapWeaken'
  AND json_extract(data, '$.effect.permanent') IS NULL;
