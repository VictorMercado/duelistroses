import { cardArt, catalogCard } from "@/game/catalog";
import { ASSET_URL } from "@/const";
import { terrainTone } from "@/game/terrain";

/**
 * A card drawn with plain DOM elements, laid out to match the 3D card. Used
 * wherever a card is shown off the board (hand, focus panel, choices): it
 * costs nothing next to a WebGL canvas. `terrain` is what the card's square
 * adds to its ATK and DEF, shown in green or red.
 */
export default function CardFace({ num, atk, def, terrain, className = "" }: { num: number; atk?: number; def?: number; terrain?: number; className?: string; }) {
  const card = catalogCard(num);
  const art = cardArt(num);

  if (!card) {
    return (
      <div className={`relative aspect-[68/98] overflow-hidden bg-[#513224] ${className}`}>
        <img src={ASSET_URL + "/cards/mysteryCard.png"} alt="Face-down card" className="h-full w-full object-cover" loading="lazy" draggable={false} />
      </div>
    );
  }

  const monster = card.kind === "monster";
  return (
    <div className={`relative aspect-[68/98] overflow-hidden bg-black select-none [container-type:inline-size] ${className}`}>
      <img src={art.template} alt="" className="absolute inset-0 h-full w-full" loading="lazy" draggable={false} />
      <img src={art.art} alt={card.name} className="absolute left-[2.2%] top-[1.6%] h-[71.4%] w-[95.6%] object-cover [image-rendering:auto]" loading="lazy" draggable={false} />
      {monster && (
        <>
          <div className="absolute left-0 top-[78.5%] flex h-[4.2%] w-[84%] items-center justify-center gap-[0.4%]">
            {Array.from({ length: card.level ?? 0 }, (_, i) => (
              <img key={i} src={ASSET_URL + "/textures/levelStar.png"} alt="" className="h-full" loading="lazy" draggable={false} />
            ))}
          </div>
          <img src={art.attribute} alt={card.attribute} className="absolute left-[81.5%] top-[77.6%] w-[10.2%]" loading="lazy" draggable={false} />
          <span className={`absolute left-[27.2%] top-[91.3%] -translate-x-1/2 -translate-y-1/2 font-serif text-[8.5cqw] font-bold leading-none ${terrainTone(terrain, true)}`}>{atk ?? card.atk}</span>
          <span className={`absolute left-[72.8%] top-[91.3%] -translate-x-1/2 -translate-y-1/2 font-serif text-[8.5cqw] font-bold leading-none ${terrainTone(terrain, true)}`}>{def ?? card.def}</span>
        </>
      )}
    </div>
  );
}
