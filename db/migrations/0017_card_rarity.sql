-- Card rarity (see game/engine/rarity.go): the points each player's cards
-- have earned, by card number. A monster earns 1 for every enemy monster it
-- destroys and 10 for the final blow to an enemy deck leader; its rarity
-- follows from the total (rare 10, secret 30, ultra 50, ultimate 100).
CREATE TABLE card_rarity (
    user_id TEXT NOT NULL,
    num     INTEGER NOT NULL,
    points  INTEGER NOT NULL,
    PRIMARY KEY (user_id, num)
);
