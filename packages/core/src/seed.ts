import { prisma } from "./db.js";

export const DEMO_CHANNEL = "Gaon Ki Kahaniyan";

const ART_STYLE =
  "2D Indian cartoon illustration, flat vibrant colours, bold clean black outlines, soft cel shading, warm daylight, expressive big-eyed characters, rustic North Indian village setting, children's animated TV series look, 16:9";

/** Idempotent demo seed: one channel, a village-drama theme, 5 characters, 4 locations and a series bible. */
export async function seedDemo() {
  const existing = await prisma.channel.findFirst({ where: { name: DEMO_CHANNEL }, include: { theme: true } });
  if (existing) return existing;

  const theme = await prisma.theme.create({
    data: {
      name: "Gaon Ki Kahaniyan — village drama",
      genre: "Saas-Bahu village comedy-drama",
      artStylePrompt: ART_STYLE,
      negativeStyle: "photorealism, 3D render, anime style, text, watermark, extra fingers, distorted faces, dark gritty tones, gore",
      tone: "warm, funny, a little emotional, family-friendly",
      targetAudience: "Hindi-speaking families (13+)",
      contentRules:
        "Family-friendly. No violence beyond mild slapstick, no abusive words, no mocking any caste, religion or region, no alcohol or smoking, no dangerous stunts. Conflicts are resolved with understanding. Each story episode ends with a clear moral.",
      kidSafe: false,
      narratorSpeaker: "manisha",
      narratorPace: 0.95,
      characters: {
        create: [
          {
            key: "priya",
            name: "Priya",
            role: "city bahu who moved to the village after marriage",
            age: 26,
            personality: "smart, modern, impatient, kind-hearted, secretly loves village life",
            speechStyle: "fast Hinglish with English words like 'seriously', 'oh my god', 'yaar'; polite but sarcastic",
            visualDescription:
              "young Indian woman, slim, wheatish skin, big expressive brown eyes, long straight black hair in a loose side braid, small red bindi, bright PINK cotton kurta with white churidar and a light-yellow dupatta, gold stud earrings, smartphone in hand",
            voiceSpeaker: "anushka",
            voicePitch: 0.1,
            voicePace: 1.1,
          },
          {
            key: "ramesh",
            name: "Ramesh",
            role: "Priya's husband, village school teacher",
            age: 30,
            personality: "gentle peacemaker, caught between his mother and his wife, terrible at lying",
            speechStyle: "soft, respectful Hindi, says 'arre suno toh' and 'maa, please'",
            visualDescription:
              "Indian man, medium build, short neatly combed black hair, thin moustache, round spectacles, light-blue half-sleeve shirt, grey trousers, black sandals, a pen in his shirt pocket",
            voiceSpeaker: "karun",
            voicePace: 1.0,
          },
          {
            key: "dadi",
            name: "Dadi (Kamla Devi)",
            role: "Ramesh's grandmother, head of the household",
            age: 72,
            personality: "sharp-tongued but loving, old-fashioned, surprisingly tech-curious, the real boss of the village",
            speechStyle: "rustic Hindi with Bhojpuri tinge, says 'arre baap re!' and 'hamare zamane mein…', proverbs",
            visualDescription:
              "elderly Indian woman, small and slightly hunched, white hair in a bun, thick round glasses, wrinkles and a big warm smile, white cotton saree with a thin maroon border draped over her head, wooden walking stick, silver bangles",
            voiceSpeaker: "vidya",
            voicePitch: -0.15,
            voicePace: 0.9,
          },
          {
            key: "bholu",
            name: "Bholu Chacha",
            role: "the chaiwala uncle, village gossip hub",
            age: 50,
            personality: "jolly, nosy, spreads every news before it happens, generous with free chai",
            speechStyle: "loud, cheerful Hindi, calls everyone 'bitwa', laughs 'ho ho ho', exaggerates everything",
            visualDescription:
              "plump Indian man, bald on top with grey side hair, big curled moustache, round belly, GREEN kurta with rolled-up sleeves, white dhoti, checked red-white gamchha on his shoulder, holding a steel kettle",
            voiceSpeaker: "abhilash",
            voicePace: 1.05,
          },
          {
            key: "chintu",
            name: "Chintu",
            role: "10-year-old neighbour boy and aspiring YouTuber",
            age: 10,
            personality: "mischievous, curious, always filming, accidentally causes most of the chaos",
            speechStyle: "excited, fast, says 'like, share aur subscribe!' and 'bhaiya, dekho dekho!'",
            visualDescription:
              "skinny Indian boy, messy spiky black hair, big gap-toothed grin, orange t-shirt with a yellow star, blue shorts, rubber slippers, small black digital camera on a red strap around his neck",
            voiceSpeaker: "hitesh",
            voicePitch: 0.4,
            voicePace: 1.15,
          },
        ],
      },
      locations: {
        create: [
          {
            key: "haveli_courtyard",
            name: "Haveli courtyard",
            description: "open courtyard of an old two-storey yellow haveli, carved wooden doors, tulsi plant on a raised brick platform in the centre, charpai, brass pots, clothes line, mango tree shade",
          },
          {
            key: "chai_stall",
            name: "Bholu's chai stall",
            description: "small roadside chai stall with a tin roof, clay kulhads, steaming kettle on a mud stove, wooden bench, hand-painted sign without readable text, bicycles parked, village road",
          },
          {
            key: "banyan_chaupal",
            name: "Banyan tree chaupal",
            description: "huge old banyan tree with hanging roots at the village square, stone platform around it where elders sit, a lantern hanging from a branch, small temple bell nearby",
          },
          {
            key: "mustard_fields",
            name: "Mustard fields by the pond",
            description: "endless bright yellow mustard fields, a narrow mud path, a calm pond with lotus leaves, a buffalo resting, distant mud houses and a water pump",
          },
        ],
      },
      storyline: {
        create: {
          premise:
            "Priya, a Delhi girl, marries Ramesh and moves into his family's haveli in the village of Sukhpur. Every episode, her city habits clash with Dadi's old ways — and every episode they discover they're more alike than they think. Chintu's camera and Bholu Chacha's gossip turn every small incident into village-wide drama.",
          worldRules:
            "Sukhpur is a small, peaceful village in Uttar Pradesh. Mobile network works only near the banyan tree. Everyone knows everyone. Bholu's chai stall is where all news starts. No villains — conflicts come from misunderstandings.",
          characterArcs:
            "Priya slowly learns to love village life. Dadi secretly wants to learn smartphones. Ramesh learns to stand up for both of them. Chintu dreams of 1 lakh subscribers.",
          runningGags:
            "Network only at the banyan tree (everyone climbs it). Bholu announces news before it happens. Dadi's proverbs are always slightly wrong. Chintu's 'like, share aur subscribe!'",
          forbiddenTopics: "politics, religion debates, caste, dowry, alcohol, romance beyond married affection, real brands",
          storyMemory: "",
          openThreads: ["Dadi has secretly asked Chintu to teach her how to make a video", "Priya wants to open a small online pickle business"],
        },
      },
    },
  });

  return prisma.channel.create({
    data: {
      name: DEMO_CHANNEL,
      themeId: theme.id,
      generationTime: "02:00",
      storyPublishTime: "18:00",
      shortPublishTimes: ["12:00", "20:30"],
      musicPack: "village-warm",
      subtitlesEnabled: true,
      madeForKids: false,
      autoPublish: false,
      shortsMode: "TEASER",
      storyTargetMinutes: 10,
    },
    include: { theme: true },
  });
}
