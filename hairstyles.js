const HAIRSTYLE_PROMPTS = [
  {
    id: "butterfly-layers",
    name: "Butterfly Layers",
    prompt: "Create long butterfly layers with airy face-framing pieces, lifted volume at the crown, feathered cheekbone-length layers, soft movement through the mid-lengths, and polished ends that keep the overall length looking luxurious and salon-finished."
  },
  {
    id: "french-bob-micro-fringe",
    name: "French Bob With Micro Fringe",
    prompt: "Create an ultra-chic French bob that sits between the lips and chin, with softly tucked-in ends, subtle fullness through the sides, a slightly rounded shape, and a neat micro fringe that feels refined, fashion-forward, and Parisian."
  },
  {
    id: "italian-bob",
    name: "Italian Bob",
    prompt: "Create a glossy Italian bob with strong weight at the perimeter, a full shape that lands at jaw length, softly beveled ends, rich shine, and understated volume that makes the haircut feel elegant, expensive, and effortless."
  },
  {
    id: "relaxed-lob",
    name: "Relaxed Lob",
    prompt: "Create a relaxed collarbone-length lob with lightly textured ends, minimal long layers, gentle bend through the body, and an easy lived-in finish that feels modern, wearable, and flattering from every angle."
  },
  {
    id: "blunt-lob-curtain-bangs",
    name: "Blunt Lob With Curtain Bangs",
    prompt: "Create a blunt long bob that grazes the collarbone, with a sharp clean baseline, soft curtain bangs opening at the center, subtle face-framing around the cheekbones, and a sleek, healthy finish."
  },
  {
    id: "bixie-cut",
    name: "Bixie Cut",
    prompt: "Create a bixie haircut that blends the softness of a pixie with the length of a bob, featuring textured layers around the crown, airy volume, tapered edges around the nape, and piecey movement around the face."
  },
  {
    id: "soft-pixie-side-fringe",
    name: "Soft Pixie With Side Fringe",
    prompt: "Create a soft feminine pixie cut with clean tapered sides, delicate texture at the crown, a longer sweeping side fringe, subtle lift at the roots, and an elegant silhouette that highlights the eyes and cheekbones."
  },
  {
    id: "mixie-cut",
    name: "Mixie Cut",
    prompt: "Create a mixie haircut that combines pixie softness with mullet-inspired length in the back, keeping the top textured and airy, the sides neat and flattering, and the overall effect bold, stylish, and editorial without looking harsh."
  },
  {
    id: "soft-shag",
    name: "Soft Shag With Curtain Bangs",
    prompt: "Create a soft shag haircut with blended layers throughout, airy curtain bangs, light volume at the crown, gentle texture through the lengths, and a low-effort finish that still looks polished and intentionally styled."
  },
  {
    id: "medium-wolf-cut",
    name: "Medium Wolf Cut",
    prompt: "Create a medium wolf cut with strong crown texture, layered volume on top, wispy separation through the mid-lengths, tapered ends, and a cool modern shape that balances softness with edge."
  },
  {
    id: "elfin-bob",
    name: "Elfin Bob",
    prompt: "Create an elfin bob that sits between a short bob and a long pixie, with delicate tapered edges, lifted crown volume, soft texture around the ears, and a neat sculpted outline that feels playful and refined."
  },
  {
    id: "pageboy-bob",
    name: "Pageboy Bob",
    prompt: "Create a pageboy bob with a rounded silhouette, smooth body, softly curled-under ends, gentle fullness through the sides, and a classic polished fringe that gives the hairstyle a graceful vintage-inspired finish."
  },
  {
    id: "butterfly-bob",
    name: "Butterfly Bob",
    prompt: "Create a butterfly bob with a bob-length baseline, airy shorter layers around the face, soft bounce, lift through the crown, and feathered movement that gives the cut a fresh, flattering, and dimensional look."
  },
  {
    id: "old-hollywood-bob",
    name: "Old Hollywood Bob",
    prompt: "Create an old Hollywood bob with a deep side part, smooth sculpted volume, glossy S-shaped waves, softly tucked ends, and a glamorous red-carpet finish that feels timeless and luxurious."
  },
  {
    id: "flippy-lob",
    name: "Flippy Lob",
    prompt: "Create a sleek lob with flipped-out ends, a clean center or soft side part, smooth roots, subtle shine, and a playful 1990s-inspired swing that still feels current and sophisticated."
  },
  {
    id: "chin-length-blunt-bob",
    name: "Sleek Chin-Length Blunt Bob",
    prompt: "Create a chin-length blunt bob with precise sharp lines, glass-like smoothness, a dense healthy perimeter, subtle inward beveling at the ends, and a minimalist luxury feel."
  },
  {
    id: "cloud-layers",
    name: "Cloud Layers",
    prompt: "Create a cloud-inspired haircut with airy rounded layers, soft movement throughout, bouncy volume near the crown, feather-light ends, and a plush blowout finish that looks full, soft, and expensive."
  },
  {
    id: "mermaid-waves",
    name: "Mermaid Waves",
    prompt: "Create long mermaid waves with flowing length, softly defined bends, glossy dimension, subtle face-framing, and a romantic beachy-luxury texture that still feels salon polished rather than messy."
  },
  {
    id: "face-framing-long-layers",
    name: "Face-Framing Long Layers",
    prompt: "Create long hair with elegant face-framing layers starting near the cheekbones, smooth blended lengths, soft volume at the roots, and healthy tapered ends for a timeless salon look."
  },
  {
    id: "textured-collarbone-cut",
    name: "Textured Collarbone Cut",
    prompt: "Create a collarbone-length cut with airy texture, light internal layering, movement at the ends, and a softly undone finish that looks flattering, modern, and easy to style."
  },
  {
    id: "curly-shag-fringe",
    name: "Curly Shag With Curly Fringe",
    prompt: "Create a curly shag with rounded volume, springy layered curls, a soft curly fringe, controlled shape around the face, and texture that feels expressive, balanced, and beautifully defined."
  },
  {
    id: "curly-bob",
    name: "Chin-Length Curly Bob",
    prompt: "Create a chin-length curly bob with sculpted bounce, even rounded shape, defined glossy curls, soft face-framing pieces, and a refined salon silhouette that celebrates natural texture."
  },
  {
    id: "side-part-glam-lob",
    name: "Side-Part Glam Lob",
    prompt: "Create a glamorous side-part lob with smooth roots, voluminous bend through the mid-lengths, polished ends, and a soft luxurious finish that feels sophisticated and camera-ready."
  },
  {
    id: "voluminous-blowout-layers",
    name: "Voluminous Blowout Layers",
    prompt: "Create long voluminous blowout layers with lifted roots, sweeping face-framing sections, smooth barrel-brush curves, glossy shine, and a plush salon-fresh finish."
  },
  {
    id: "wispy-bangs-long-layers",
    name: "Wispy Bangs With Long Layers",
    prompt: "Create long hair with wispy feathered bangs, softly blended layers, light movement around the face, airy texture, and a youthful romantic finish that remains sleek and flattering."
  },
  {
    id: "braided-crown-updo",
    name: "Braided Crown Updo",
    prompt: "Create a braided crown updo with smooth polished sections, soft fullness around the crown, neat woven braid detail, a graceful face-framing effect, and an elegant salon-quality finish."
  },
  {
    id: "bubble-braid-ponytail",
    name: "Bubble Braid Ponytail",
    prompt: "Create a sleek high bubble braid ponytail with smooth edges, evenly spaced rounded sections, polished shine, subtle volume in each bubble, and a playful modern statement look."
  },
  {
    id: "sleek-low-ponytail",
    name: "Sleek Low Ponytail With Tendrils",
    prompt: "Create a sleek low ponytail with a glossy smooth top, precise center part, soft face-framing tendrils, neatly gathered length, and a minimalist elegant finish."
  },
  {
    id: "boho-side-braid",
    name: "Loose Boho Side Braid",
    prompt: "Create a loose boho side braid with soft volume at the crown, gentle face-framing pieces, relaxed woven texture, airy fullness throughout, and a romantic effortless finish."
  },
  {
    id: "modern-rachel-layers",
    name: "Modern Rachel Layers",
    prompt: "Create a modern Rachel-inspired layered cut with bouncy face-framing volume, flipped-out movement through the front, feathered layers throughout, and a polished updated 1990s salon feel."
  },
  {
    id: "jellyfish-cut",
    name: "Jellyfish Cut",
    prompt: "Create a modern jellyfish haircut with a crisp chin-length top section, long flowing underlayers beneath, clear separation between the tiers, glossy texture, and an artistic high-fashion finish."
  }
];

window.HAIRSTYLE_PROMPTS = HAIRSTYLE_PROMPTS;
