/** Offline stand-ins for the launch-kit LLM steps. Real kits come from Claude with web research. */

type Tpl = {
  names: [string, string][];
  genre: string;
  style: string;
  tone: string;
  premise: string;
  world: string;
  arcs: string;
  gags: string;
  chars: { key: string; name: string; role: string; age: number; gender: "female" | "male"; personality: string; speech: string; look: string; phrase: string }[];
  locs: { key: string; name: string; description: string }[];
  music: [string, string, string][];
};

const TEMPLATES: Record<string, Tpl> = {
  jungle: {
    names: [["Jungle Ki Seekh", "जंगल की सीख"], ["Van Vaani Kahaniyan", "वन वाणी कहानियाँ"], ["Chatur Chidiya Tales", "चतुर चिड़िया"], ["Pedon Wali Paathshala", "पेड़ों वाली पाठशाला"], ["Gappu Aur Dost", "गप्पू और दोस्त"]],
    genre: "Panchatantra-style animal fables for kids",
    style: "2D Indian cartoon illustration for children, flat bright colours, thick rounded black outlines, soft cel shading, lush green Indian forest, friendly big-eyed animal characters, gentle morning light, 16:9",
    tone: "gentle, funny, wise, reassuring",
    premise: "In the Sundarvan forest by the Narmada river, a clever young sparrow, a slow but kind tortoise and a boastful monkey solve everyday problems of forest life. Each episode retells the spirit of a classic Indian fable in a fresh, original situation and ends with a clear, simple moral that children can remember.",
    world: "Animals talk; humans are never shown as villains. The banyan council of elders settles disputes. No animal is ever hurt — danger is resolved with cleverness.",
    arcs: "Chiku the sparrow learns patience; Kachhu the tortoise gains confidence; Bandar Bhaiya learns humility.",
    gags: "Bandar Bhaiya's plans always end with him stuck in a tree. Kachhu is late to everything but arrives exactly when needed.",
    chars: [
      { key: "chiku", name: "Chiku", role: "clever young sparrow, the leader of the friends", age: 8, gender: "female", personality: "curious, quick-thinking, impatient, brave", speech: "fast, chirpy Hindi with lots of questions, says 'chalo chalo!'", look: "tiny round brown house sparrow with a cream belly, big shiny black eyes, a small orange beak, a red woollen scarf around her neck, short tail with three dark stripes", phrase: "चलो चलो, सोचते हैं!" },
      { key: "kachhu", name: "Kachhu", role: "slow, kind tortoise", age: 60, gender: "male", personality: "patient, wise, gentle, a little shy", speech: "slow, soft, thoughtful Hindi with long pauses, says 'dheere dheere'", look: "chunky olive-green tortoise with a domed dark-green shell patterned with yellow hexagons, round spectacles, wrinkled smiling face, tiny blue cloth bag hanging from his shell", phrase: "धीरे-धीरे, सब ठीक होगा।" },
      { key: "bandar", name: "Bandar Bhaiya", role: "boastful, playful monkey", age: 14, gender: "male", personality: "show-off, mischievous, warm-hearted, easily embarrassed", speech: "loud, cocky Hinglish, brags 'main hoon na!'", look: "lanky light-brown langur with a long curling tail, cream face, cheeky grin, yellow vest with a single red button, a small banana-leaf cap tilted to one side", phrase: "डरो मत, मैं हूँ ना!" },
      { key: "dadi_maina", name: "Dadi Maina", role: "elderly myna bird storyteller of the forest", age: 80, gender: "female", personality: "loving, witty, full of proverbs", speech: "rustic, warm Hindi full of proverbs, calls everyone 'bachcho'", look: "plump black-and-brown myna with a bright yellow eye patch and beak, a tiny white shawl with a pink border, sits on a carved wooden perch", phrase: "बच्चो, सुनो एक बात!" },
    ],
    locs: [
      { key: "banyan_council", name: "Banyan council tree", description: "giant ancient banyan tree with thick hanging roots, mossy stone seats in a circle, fireflies and dappled light, flowers on the ground" },
      { key: "riverbank", name: "Narmada riverbank", description: "wide calm river with smooth pebbles, lotus leaves, reeds, a fallen log bridge, distant blue hills" },
      { key: "mango_grove", name: "Mango grove", description: "rows of mango trees heavy with yellow mangoes, grass meadow, butterflies, a wooden swing on a branch" },
      { key: "hilltop_rock", name: "Hilltop rock", description: "big flat rock on a hill above the forest canopy, wide sky, sunset clouds, small wildflowers" },
    ],
    music: [["Sundarvan Morning", "playful", "cheerful Indian folk instrumental for a kids cartoon, bansuri flute melody, light tabla and dholak, xylophone, 110 BPM, bright and bouncy, no vocals, loopable, sits under dialogue"], ["Banyan Wisdom", "calm", "gentle santoor and soft strings, slow 70 BPM, warm and wise, no vocals, loopable background"], ["Uh-oh Trouble", "suspense", "playful suspense for kids, plucked pizzicato strings, soft tabla, low bansuri, 95 BPM, never scary, no vocals, loopable"]],
  },
  bhoot: {
    names: [["Bhootiya Haveli Ke Raaz", "भूतिया हवेली के राज़"], ["Gaon Ka Bhoot Club", "गाँव का भूत क्लब"], ["Raat Ki Kahaniyan", "रात की कहानियाँ"], ["Purani Haveli Files", "पुरानी हवेली फ़ाइल्स"], ["Lantern Gang", "लालटेन गैंग"]],
    genre: "Spooky-comedy village mysteries (Bhoot-wala gaon)",
    style: "2D Indian cartoon illustration, flat moody colours with teal and amber accents, bold clean outlines, soft cel shading, moonlit North Indian village, glowing lanterns, slightly exaggerated expressive characters, 16:9",
    tone: "spooky but funny, suspenseful, never gory",
    premise: "In the village of Andheripur, strange things happen after sunset — and three curious teenagers with a lantern and a notebook investigate every 'bhoot' sighting. Most mysteries turn out to have clever, human explanations, but one friendly ghost in the old haveli is very real and secretly helps them.",
    world: "Ghosts are never evil; superstition is gently questioned. Mysteries are solved by observation. No gore, no possession, no black magic.",
    arcs: "Meera learns to trust her friends; Golu overcomes his fear of the dark; Bhola Bhoot wants to be remembered by the village.",
    gags: "Golu screams before anything happens. Bhola Bhoot can't stop sneezing when he's invisible.",
    chars: [
      { key: "meera", name: "Meera", role: "fearless teenage detective", age: 15, gender: "female", personality: "logical, bold, stubborn, kind", speech: "crisp, confident Hindi with deductions, says 'saboot chahiye!'", look: "slim teenage girl with two long black braids tied with yellow ribbons, sharp eyebrows, teal kurta with white pyjama, brown satchel, holds a brass lantern", phrase: "सबूत चाहिए!" },
      { key: "golu", name: "Golu", role: "scaredy-cat best friend", age: 14, gender: "male", personality: "nervous, loyal, hungry, funny", speech: "squeaky, rambling Hindi, says 'mummy!' when scared", look: "short round boy with a bowl haircut, big frightened eyes, orange t-shirt with a lightning bolt, oversized khaki shorts, always holding a samosa", phrase: "मम्मी! भूत!" },
      { key: "bhola_bhoot", name: "Bhola Bhoot", role: "friendly ghost of the old haveli", age: 200, gender: "male", personality: "lonely, gentle, dramatic, forgetful", speech: "old-fashioned theatrical Hindi with Urdu words, sighs a lot", look: "translucent pale-blue ghost with a long white moustache, tall pointed turban, floating flowing angarkha that fades into mist, glowing kind yellow eyes", phrase: "आह! क्या ज़माना था!" },
      { key: "sarpanch_ji", name: "Sarpanch Ji", role: "superstitious village head", age: 58, gender: "male", personality: "pompous, superstitious, means well", speech: "loud, formal Hindi, announces everything", look: "tall thin man with a grey handlebar moustache, white kurta-dhoti, mustard shawl, black cap, holds a wooden stick", phrase: "गाँव वालो, सावधान!" },
    ],
    locs: [
      { key: "old_haveli", name: "Old haveli", description: "crumbling two-storey haveli with carved jharokhas, cobwebs, broken swing in the courtyard, moonlight through arches" },
      { key: "peepal_crossroads", name: "Peepal tree crossroads", description: "huge peepal tree at a dusty crossroads, small shrine with a diya, fog at night, crickets" },
      { key: "village_well", name: "Village well", description: "old stone well with a rope and bucket, worn steps, lantern on a hook, mustard fields behind" },
      { key: "school_rooftop", name: "School rooftop", description: "flat rooftop of a small village school, water tank, view over the village, starry sky" },
    ],
    music: [["Andheripur Nights", "suspense", "spooky-comedy instrumental, low tanpura drone, sitar plucks, soft tabla, creaky glockenspiel, 85 BPM, mysterious but playful, no vocals, loopable"], ["Lantern Chase", "playful", "fast comedic chase, dholak, pizzicato strings, bansuri runs, 130 BPM, no vocals, loopable"], ["Bhola's Lament", "emotional", "tender sarangi melody over soft strings, 65 BPM, nostalgic, no vocals, loopable"]],
  },
  village: {
    names: [["Chaupal Ki Kahaniyan", "चौपाल की कहानियाँ"], ["Mohalla Masala", "मोहल्ला मसाला"], ["Angan Tales", "आँगन की बातें"], ["Gaon Wale Bhaiya", "गाँव वाले भैया"], ["Kissa Kasba", "किस्सा कस्बा"]],
    genre: "Warm small-town family comedy-drama",
    style: "2D Indian cartoon illustration, flat vibrant colours, bold clean black outlines, soft cel shading, warm daylight, expressive characters, small-town North Indian setting, 16:9",
    tone: "warm, funny, emotional, family-friendly",
    premise: "In the small town of Rampur, a joint family running a sweet shop deals with everyday chaos — rivalries, festivals, weddings and a never-ending competition with the shop across the street. Every episode, the family's love wins over its arguments.",
    world: "No villains; conflicts come from misunderstandings and pride. The sweet shop is the heart of the town. Festivals mark the seasons.",
    arcs: "Sunny wants to modernise the shop; Babuji fears change; Rani becomes the family's quiet decision-maker.",
    gags: "Babuji tastes every sweet 'for quality control'. The rival shop's owner appears whenever the family is boasting.",
    chars: [
      { key: "babuji", name: "Babuji", role: "family head and sweet-shop owner", age: 62, gender: "male", personality: "proud, stubborn, sentimental", speech: "booming, old-fashioned Hindi, says 'hamare zamane mein'", look: "stout man with a round belly, white handlebar moustache, bald head with grey sides, cream kurta with a brown sleeveless jacket, gold watch", phrase: "हमारे ज़माने में…" },
      { key: "rani", name: "Rani", role: "daughter-in-law, sharp and calm", age: 32, gender: "female", personality: "clever, calm, diplomatic", speech: "soft but firm Hindi, polite sarcasm", look: "medium height woman, long hair in a low bun with jasmine flowers, red bindi, mustard-yellow saree with a green border, glass bangles", phrase: "अरे, बस करो अब।" },
      { key: "sunny", name: "Sunny", role: "son with big modern ideas", age: 27, gender: "male", personality: "ambitious, hasty, lovable", speech: "fast Hinglish, startup words like 'brand' and 'online'", look: "lean young man with spiky gelled hair, thin beard, sky-blue shirt with rolled sleeves, jeans, smartphone in hand", phrase: "ये ब्रांड बनेगा!" },
      { key: "chhotu", name: "Chhotu", role: "the shop's helper boy", age: 12, gender: "male", personality: "street-smart, cheeky, honest", speech: "quick, cheeky Hindi, calls everyone 'boss'", look: "small thin boy with messy curly hair, gap-toothed grin, red t-shirt, grey shorts, apron dusted with flour", phrase: "हो जाएगा, बॉस!" },
    ],
    locs: [
      { key: "sweet_shop", name: "Sweet shop", description: "busy small-town sweet shop with glass counters full of colourful mithai, big kadhai, steel trays, marigold garlands" },
      { key: "family_angan", name: "Family courtyard", description: "inner courtyard of an old house, tulsi platform, charpai, clothes line, blue-painted walls" },
      { key: "market_lane", name: "Market lane", description: "narrow market lane with shop awnings, bicycles, cows, hanging lanterns" },
      { key: "ghat", name: "River ghat", description: "stone steps leading to a river, small temples, boats, evening diyas" },
    ],
    music: [["Rampur Morning", "warm", "warm Indian folk instrumental, santoor and bansuri, light tabla, 100 BPM, cosy and cheerful, no vocals, loopable, sits under dialogue"], ["Mithai Mayhem", "playful", "comedic dholak and shehnai, bouncy bass, 125 BPM, no vocals, loopable"], ["Family Ties", "emotional", "tender sitar and soft strings, 70 BPM, heartfelt, no vocals, loopable"]],
  },
};

const pick = (idea: string) =>
  /jungle|animal|panchatantra|fable|forest|kids|bachch/i.test(idea) ? TEMPLATES.jungle : /bhoot|ghost|horror|spooky|haunt|mystery/i.test(idea) ? TEMPLATES.bhoot : TEMPLATES.village;

function voicesFromPrompt(prompt: string) {
  const sect = prompt.split("## Voice catalog")[1] ?? "";
  return [...sect.matchAll(/^- ([a-z]+) \((female|male)/gm)].map((m) => ({ id: m[1], gender: m[2] }));
}

export function mockResearch(prompt: string) {
  const idea = prompt.match(/Channel idea: (.*)/)?.[1] ?? "";
  const t = pick(idea);
  return {
    summary: `Offline mock research for “${idea}”. Configure ANTHROPIC_API_KEY to research the niche live on the web. Niche: ${t.genre}.`,
    audience: "Hindi-speaking families on mobile; evening viewing peaks.",
    competitors: [],
    formatsThatWork: ["8–12 minute episodes with a recurring cast", "Shorts that open on a reaction shot", "clear moral at the end"],
    titleThumbnailPatterns: ["big emotional face + 2–4 word Hindi title", "bright saturated colours"],
    culturalDetails: ["use everyday regional Hindi words", "festivals as seasonal episodes"],
    visualStyle: ["flat colours, thick outlines, warm light"],
    musicStyle: ["bansuri, tabla, santoor; light and loopable"],
    voiceActing: ["distinct voices per age/gender, energetic delivery for kids"],
    gaps: ["consistent recurring characters with continuity"],
    risks: ["set made-for-kids correctly", "disclose AI-generated content"],
    namesToAvoid: [],
    sources: [],
  };
}

export function mockKit(prompt: string) {
  const idea = prompt.match(/Channel idea: (.*)/)?.[1] ?? "";
  const kids = /KIDS channel/.test(prompt) || pick(idea) === TEMPLATES.jungle;
  const t = pick(idea);
  const voices = voicesFromPrompt(prompt);
  const byGender = (g: string, i: number) => voices.filter((v) => v.gender === g)[i % Math.max(1, voices.filter((v) => v.gender === g).length)]?.id ?? "anushka";
  let f = 0;
  let m = 0;
  return {
    channel: {
      nameOptions: t.names.map(([name, nameHi]) => ({ name, nameHi, handle: `@${name.replace(/\s+/g, "")}`, rationale: "memorable, says what the channel is about" })),
      tagline: "हर कहानी में एक सीख",
      descriptionHi: `${t.genre} — हर हफ़्ते नई कहानियाँ, प्यारे किरदार और एक सीख। रोज़ नई कहानी और Shorts देखने के लिए चैनल सब्सक्राइब करें।`,
      descriptionEn: `${t.genre}. New animated Hindi stories every day with a recurring cast and a moral in every episode.`,
      keywords: ["hindi kahani", "hindi cartoon", "moral stories", "animated stories"],
      targetAudience: kids ? "children 4–10 and their parents" : "Hindi-speaking families",
      madeForKids: kids,
      shortsMode: "TEASER",
      storyTargetMinutes: kids ? 8 : 10,
      publishTimes: { story: "18:00", short1: "12:00", short2: "20:30" },
    },
    theme: {
      name: t.names[0][0],
      genre: t.genre,
      artStylePrompt: t.style,
      negativeStyle: "photorealism, 3D render, anime style, text, watermark, extra limbs, distorted faces, gore",
      tone: t.tone,
      targetAudience: kids ? "children 4–10" : "families (13+)",
      contentRules: kids
        ? "Strictly kid-safe: no violence, no scary imagery, no insults, no dangerous imitable acts. Every episode ends with a gentle moral."
        : "Family-friendly. No graphic violence, abusive words, or mocking any community. Conflicts resolve with understanding.",
      kidSafe: kids,
    },
    storyline: { premise: t.premise, worldRules: t.world, characterArcs: t.arcs, runningGags: t.gags, forbiddenTopics: "politics, religion debates, caste, real brands", openThreads: [], firstEpisodeIdeas: [] },
    characters: t.chars.map((c) => ({
      key: c.key,
      name: c.name,
      role: c.role,
      age: c.age,
      gender: c.gender,
      personality: c.personality,
      speechStyle: c.speech,
      catchphrases: [c.phrase],
      visualDescription: c.look,
      voice: { speaker: c.gender === "female" ? byGender("female", f++) : byGender("male", m++), pitch: c.age < 14 ? 0.3 : c.age > 55 ? -0.15 : 0, pace: c.age > 55 ? 0.9 : 1.05, loudness: 1, rationale: "matched to age and gender" },
    })),
    narrator: { speaker: byGender("female", 1), pitch: 0, pace: 0.95, loudness: 1, rationale: "warm storyteller" },
    locations: t.locs,
    music: { direction: "light Indian folk instrumentation, loopable, always under dialogue", tracks: t.music.map(([title, mood, p]) => ({ title, mood, prompt: p, lengthSec: 90 })) },
    branding: {
      logoPrompt: `round mascot emblem of ${t.chars[0].name}: ${t.chars[0].look}; bold outline, bright background, no text`,
      bannerPrompt: `wide banner with the whole cast (${t.chars.map((c) => c.name).join(", ")}) at the left and right edges in their setting; calm empty sky band across the centre for the title; no text`,
      colorPalette: ["#FF8A00", "#D81B60", "#2FB36D", "#FFE066"],
      thumbnailStyleNotes: "big expressive face, 2–4 word Hindi title, saturated colours",
    },
  };
}

export function mockReview(prompt: string) {
  const kitJson = prompt.split("## Kit")[1]?.trim() ?? "{}";
  const kit = JSON.parse(kitJson);
  return {
    issues: [{ area: "mock", problem: "Offline mock review — no real checks were run", fix: "configure ANTHROPIC_API_KEY for web-checked names and a real critique" }],
    nameChecks: (kit.channel?.nameOptions ?? []).map((n: { name: string }) => ({ name: n.name, conflict: false, note: "not checked (offline)" })),
    kit,
  };
}
