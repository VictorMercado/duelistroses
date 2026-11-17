-- Fusion monsters get an explicit flag. The fusion frame used to be given to
-- every card a fusion recipe produces, which put ordinary monsters such as
-- Mystical Elf on it and left fusion monsters no recipe makes (Blue-Eyes
-- Ultimate Dragon) off it. A fresh database is seeded with the flag already.
UPDATE cards SET data = json_set(data, '$.fusion', json('true'))
WHERE num IN (2, 3, 8, 9, 14, 23, 24, 46, 63, 75, 103, 118, 126, 130, 134, 151, 157, 199, 200, 205, 215, 240, 253, 267, 269, 277, 280, 284, 301, 341, 345, 419, 441, 445, 460, 464, 473, 474, 478, 486, 521, 529, 538, 544, 563, 607, 615, 619, 641, 648)
  AND json_extract(data, '$.kind') = 'monster';
