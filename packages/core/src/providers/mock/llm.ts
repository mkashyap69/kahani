import { logApiCall } from "../../cost.js";
import { mockKit, mockResearch, mockReview } from "./kit.js";
import type { CallContext, LLMProvider, LLMRequest, LLMResponse } from "../types.js";

/** Natural spoken-Hindi line bank used by the offline mock writer. */
const LINES = [
  "अरे बाप रे! ये क्या हो गया?",
  "सुनो जी, आज गाँव में कुछ तो गड़बड़ है।",
  "दादी, आप फिर से मेरी चाय पी गईं?",
  "बेटा, शहर की आदतें यहाँ नहीं चलेंगी।",
  "मैं तो बस वीडियो बना रहा था, सच में!",
  "चलो चलो, सब लोग चौपाल पर इकट्ठा हो जाओ।",
  "इतनी सी बात पे इतना हंगामा?",
  "अब तो हद हो गई, मैं किसी से बात नहीं करूँगी।",
  "चाय पियोगे? गरमा-गरम अदरक वाली।",
  "मुझे तो पहले से ही शक था।",
  "ये फोन है या जादू का डिब्बा?",
  "देखो, सच कभी छुपता नहीं।",
  "अरे भाई, धीरे बोलो, सब सुन लेंगे!",
  "मम्मी जी को पता चल गया तो?",
  "कल सुबह तक सब ठीक कर दूँगा, वादा।",
  "गाँव की मिट्टी में अलग ही बात है।",
  "तुम हमेशा मेरी बात को उल्टा क्यों समझते हो?",
  "हा हा हा! ये तो कमाल हो गया।",
  "रुको! वहाँ कोई है।",
  "पूरा गाँव ये वीडियो देख रहा है।",
  "दादी, आप तो सुपरस्टार बन गईं!",
  "मेरे ज़माने में ऐसा नहीं होता था।",
  "अच्छा? तो अब तुम मुझे सिखाओगे?",
  "माफ़ कर दो, गलती हो गई।",
  "बस अब एक आख़िरी मौका।",
  "किसी को कुछ मत बताना, ठीक है?",
];
const NARRATION = [
  "एक छोटे से गाँव में, सुबह की पहली किरण के साथ एक नई कहानी शुरू हुई।",
  "पर किसी को नहीं पता था कि आगे क्या होने वाला है।",
  "उधर चाय की दुकान पर खबर आग की तरह फैल गई।",
  "और फिर आया वो पल, जिसने सब कुछ बदल दिया।",
];
const EMOTIONS = ["surprised", "happy", "irritated", "worried", "laughing", "angry", "shy", "determined", "sad", "curious"];
const SFX = ["birds chirping", null, "crowd murmur", null, "door knock", "pressure cooker whistle", null, "cow moo", "wind", null, "temple bell", "comedic boing"];
const FRAMINGS = ["medium", "closeup", "medium", "over_shoulder", "closeup"];

function parseKeys(prompt: string, section: string): { key: string; name: string }[] {
  const start = prompt.indexOf(section);
  if (start < 0) return [];
  const rest = prompt.slice(start + section.length);
  const end = rest.indexOf("\n## ");
  const block = end >= 0 ? rest.slice(0, end) : rest;
  return [...block.matchAll(/key "([^"]+)": ([^,—\n]+)/g)].map((m) => ({ key: m[1], name: m[2].trim() }));
}

export function mockScriptFromPrompt(prompt: string): object {
  const chars = parseKeys(prompt, "## Characters");
  const locs = parseKeys(prompt, "## Locations");
  const range = prompt.match(/(\d+)–(\d+) shots/);
  const isShort = /YOUTUBE SHORT/.test(prompt);
  const quick = process.env.KAHANI_QUICK === "1";
  const lo = range ? Number(range[1]) : 10;
  const hi = range ? Number(range[2]) : 14;
  const n = quick ? lo : Math.round((lo + hi) / 2);
  const ep = Number(prompt.match(/EPISODE (\d+)/)?.[1] ?? 1);
  const seed = (ep * 31 + (prompt.match(/SHORT #(\d)/)?.[1] ? Number(prompt.match(/SHORT #(\d)/)![1]) * 7 : 0)) % 97;
  const pick = <T,>(arr: T[], i: number) => arr[(i + seed) % arr.length];

  const shots = [];
  const sceneLen = isShort ? 5 : 6;
  for (let i = 0; i < n; i++) {
    const scene = Math.floor(i / sceneLen);
    const loc = pick(locs, scene) ?? { key: "village", name: "Village" };
    const cast = [pick(chars, scene), pick(chars, scene + 1), pick(chars, scene + 2)].filter((c, j, a) => c && a.indexOf(c) === j);
    const first = i % sceneLen === 0;
    const lastShot = i === n - 1;
    const narr = (first && !isShort) || lastShot;
    const speaker = narr ? "narrator" : cast[i % 2]?.key ?? null;
    const framing = first ? "wide" : pick(FRAMINGS, i);
    const inFrame = framing === "closeup" && speaker && speaker !== "narrator" ? [speaker] : cast.slice(0, 2).map((c) => c.key);
    const line = lastShot
      ? isShort
        ? "आगे क्या हुआ? पूरी कहानी चैनल पर देखिए!"
        : "सीख: सच्चाई और प्यार से हर मुश्किल आसान हो जाती है। आगे क्या होगा? अगला एपिसोड ज़रूर देखिए!"
      : narr
        ? pick(NARRATION, scene)
        : i === 0 && isShort
          ? "अरे बाप रे! ये वीडियो पूरे गाँव ने देख लिया!"
          : `${pick(LINES, i * 3)} ${pick(LINES, i * 3 + 1)}`;
    const emotion = pick(EMOTIONS, i);
    shots.push({
      id: i + 1,
      location: loc.key,
      time_of_day: scene % 4 === 3 ? "evening" : "day",
      framing,
      characters_in_frame: inFrame,
      speaker,
      dialogue_hi: line,
      emotion,
      action: `${inFrame.map((k) => chars.find((c) => c.key === k)?.name ?? k).join(" and ") || "The scene"} — ${emotion} moment at ${loc.name}`,
      image_prompt_en: `${framing} shot at ${loc.name}, ${inFrame.join(", ") || "empty scene"} looking ${emotion}, warm village details`,
      sfx: first ? pick(SFX, scene) : null,
      est_seconds: 4,
    });
  }
  const title = isShort ? `गाँव का वायरल वीडियो #${seed}` : `एपिसोड ${ep}: गाँव में हंगामा`;
  return {
    title_hi: title,
    title_en: isShort ? `The Viral Village Video #${seed}` : `Episode ${ep}: Chaos in the Village`,
    logline: "A city bahu's video goes viral in the village and everyone has an opinion.",
    moral: "सच्चाई और प्यार से हर मुश्किल आसान हो जाती है।",
    shots,
    memory_update: `Episode ${ep}: a video shot in the village went viral; Dadi became a local celebrity. Open thread: who leaked the video?`,
    youtube: {
      title: `${title} | Gaon Ki Kahaniyan${isShort ? " #Shorts" : ""}`,
      description: `गाँव की एक मज़ेदार कहानी।\nA funny village story.\n#hindikahani #cartoon #gaon #story #moralstory${isShort ? " #Shorts" : ""}`,
      tags: ["hindi kahani", "cartoon", "village story", "moral story"],
      thumbnail_prompt: "Dadi with a shocked face holding a phone",
    },
  };
}

/** Offline mock writer: produces schema-valid scripts from the prompt so the whole pipeline can run free. */
export class MockLLM implements LLMProvider {
  readonly name = "mock-llm";
  readonly model = "mock";
  async complete(req: LLMRequest, ctx: CallContext): Promise<LLMResponse> {
    const prompt = req.messages.map((m) => m.content).join("\n");
    let out: unknown;
    if (req.system.includes("content-safety reviewer")) out = { safe: true, severity: "none", issues: [] };
    else if (req.system.includes("YouTube strategist and researcher")) out = mockResearch(prompt);
    else if (req.system.includes("creator and showrunner")) out = mockKit(prompt);
    else if (req.system.includes("development executive")) out = mockReview(prompt);
    else if (req.system.includes("'story so far'")) {
      const mem = prompt.match(/Current memory:\n([\s\S]*?)\n\nOpen threads/)?.[1] ?? "";
      out = { story_memory: mem.slice(-4000), open_threads: [] };
    } else out = mockScriptFromPrompt(req.messages[0]?.content ?? prompt);
    const text = JSON.stringify(out);
    await logApiCall({ contentItemId: ctx.contentItemId, launchKitId: ctx.launchKitId, provider: this.name, model: this.model, operation: ctx.operation ?? "llm", inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(text.length / 4) });
    return { text, inputTokens: 0, outputTokens: 0, stopReason: "end_turn" };
  }
}
