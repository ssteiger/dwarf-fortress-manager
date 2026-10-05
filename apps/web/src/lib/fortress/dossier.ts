import type { FortUnit, SheetPerson, UnitSheet } from '@fortress/db-drizzle/fortress-types'

import { nicknameCore } from '~/lib/fortress/alliteration'
import { humanize, mentionNeedles, skillRank } from '~/lib/fortress/format'
import { emotionTone, pronouns, thoughtPhrase } from '~/lib/fortress/insights'

/*
 * What sets one citizen apart from the rest of the fortress: the raw material
 * for a nickname that could only belong to them. Each fact reads after the
 * dwarf's first name ("Tito ___") and is scored by how much a joke could hang
 * on it and by how few fortmates share it, so "drank without a cup", which
 * the whole fort did, sinks below "has braided sideburns".
 */

export interface DwarfFact {
  /** Citizens with the same key share the fact. */
  key: string
  text: string
  /** How much a nickname could hang on it before rarity: 1 is flavour, 3 is a story. */
  weight: number
  /** Nicknames resting on this fact alone, for when no model is configured. */
  names: string[]
  /** Explains a nickname built on it, when "<first name> <text>." would not read well. */
  why?: string
  /** Citizens with this key, this one included. */
  shared: number
  score: number
}

export interface NicknameIdea {
  nickname: string
  /** The fact behind it, in a sentence. */
  why: string
  /** Facts alone, the language model, or the player's own list of names. */
  source: 'facts' | 'model' | 'list'
}

/** An announcement of the fortress, as stored in fort_events. */
export interface ChronicleEvent {
  type: string | null
  text: string
}

type Draft = Omit<DwarfFact, 'shared' | 'score'>

/** A phrase, then the nicknames it suggests. `{their}`, `{them}` and `{self}` take the dwarf's pronouns. */
type Entry = readonly [text: string, ...names: string[]]

// ---------------------------------------------------------------------------
// Personality facets, beliefs and thoughts

const FACETS: Record<string, { high: Entry; low: Entry }> = {
  LOVE_PROPENSITY: {
    high: ['falls in love at the drop of a helmet', 'Down Bad', 'Swoons', 'Moon-Eyes'],
    low: ['has never quite managed to love anyone', 'Tin Heart', 'Unsmitten', 'Cold Hearth'],
  },
  HATE_PROPENSITY: {
    high: ['nurses hatreds like pets', 'Professional Hater', 'Keeps-a-List', 'Grudgekeeper'],
    low: ['cannot manage to hate anybody', 'Golden Retriever', 'Hates-Nobody'],
  },
  ENVY_PROPENSITY: {
    high: ['wants whatever anyone else has', 'Seagull', 'Wants-Yours', 'Greeneye'],
    low: ['has never envied anybody anything', 'Zen Master', 'Got-Enough'],
  },
  CHEER_PROPENSITY: {
    high: ['stays cheerful no matter what', 'Good Vibes Only', 'Sunbeam', 'Chirps'],
    low: ['is almost never cheerful', 'Eeyore', 'Grimface', 'Rainface'],
  },
  DEPRESSION_PROPENSITY: {
    high: ['sinks into gloom at the slightest excuse', 'Emo Phase', 'Big Sad', 'Sighs'],
    low: ['cannot be brought down by anything', 'Rubber Duck', 'Unsinkable', 'Cork'],
  },
  ANGER_PROPENSITY: {
    high: ['has a temper like a dropped lantern', 'Gordon Ramsay', 'Short Fuse', 'Kettle'],
    low: ['never loses {their} temper', 'Chill Pill', 'Cool Mug', 'Unboiled'],
  },
  ANXIETY_PROPENSITY: {
    high: ['is a bundle of nerves', 'Chihuahua', 'Jitters', 'Flinch'],
    low: ['is never anxious about anything', 'This Is Fine', 'Unbothered', 'Shrugs'],
  },
  LUST_PROPENSITY: {
    high: ['is a shameless flirt', 'Thirst Trap', 'Eyebrows', 'Winks'],
    low: ['has no interest in romance at all', 'Monk Mode', 'Not-Tonight', 'Unwooable'],
  },
  STRESS_VULNERABILITY: {
    high: ['cracks under the slightest pressure', 'Delicate Flower', 'Eggshell', 'Glass Jaw'],
    low: ['is immune to stress', 'Built Different', 'Bedrock', 'Deadpan'],
  },
  GREED: {
    high: ['is greedy', 'Sticky Fingers', 'Scrooge', 'Finders-Keepers'],
    low: ['has no interest in wealth', 'Robin Hood', 'Empty Purse', 'Gives-It-Away'],
  },
  IMMODERATION: {
    high: ['cannot resist a temptation', 'Bottomless', 'Another-Round', 'Seconds'],
    low: ['is moderation itself', 'Designated Driver', 'One-Mug', 'Half-Pint'],
  },
  VIOLENT: {
    high: ['loves a good brawl', 'Fight Club', 'Square Up', 'Knuckles'],
    low: ['shrinks from any violence', 'Pacifist Run', 'Hands-Off', 'Gentle'],
  },
  PERSEVERANCE: {
    high: ['never gives up on anything', 'Sisyphus', 'Mule', 'Not-Yet'],
    low: ['gives up at the first snag', 'Rage Quit', 'Half-Done', 'Quits'],
  },
  WASTEFULNESS: {
    high: ['is ruinously wasteful', 'Trust Fund', 'Butterfingers', 'Spills'],
    low: ['wastes nothing, not even a crumb', 'Coupon Clipper', 'Scrapsaver', 'Crumbs'],
  },
  DISCORD: {
    high: ['loves stirring up trouble', 'Drama Llama', 'Pot-Stirrer', 'Stirs'],
    low: ['will do anything to avoid a quarrel', 'Conflict Avoider', 'Peacemaker', 'Hush'],
  },
  FRIENDLINESS: {
    high: ['is friendly to absolutely everyone', 'Golden Retriever', 'Hugs', 'Waves'],
    low: ['is quite unfriendly', 'Cactus', 'Nettles', 'Prickle'],
  },
  POLITENESS: {
    high: ['is exquisitely polite', 'The Canadian', 'After-You', 'Pardon'],
    low: ['is thoroughly rude', 'Bad Manners', 'Belch', 'No-Thanks'],
  },
  DISDAIN_ADVICE: {
    high: ['ignores all advice', 'Did My Own Research', 'Knows-Better', 'Deaf Ear'],
    low: ['cannot decide anything without advice', 'Needs a Committee', 'Second Opinion'],
  },
  BRAVERY: {
    high: ['is utterly fearless', 'Leeroy Jenkins', 'Hold-My-Mug', 'Front Row'],
    low: ['is a coward', 'Brave Sir Robin', 'Backline', 'Bolt'],
  },
  CONFIDENCE: {
    high: ['is supremely confident', 'Main Character', 'Obviously', 'Of-Course'],
    low: ['has no confidence at all', 'Imposter Syndrome', 'Sorry', 'Maybe'],
  },
  VANITY: {
    high: ['is terribly vain', 'Influencer', 'Mirror', 'Primp'],
    low: ['has not a shred of vanity', 'Mudcomb', 'Whatever-Fits'],
  },
  AMBITION: {
    high: ['is fiercely ambitious', 'Future CEO', 'Next-Mayor', 'Climber'],
    low: ['has no ambition whatsoever', 'Quiet Quitter', 'Good-Enough', 'Stays-Put'],
  },
  GRATITUDE: {
    high: ['is grateful for everything', 'Blessed', 'Much-Obliged', 'Thank-You'],
    low: ['is never grateful for anything', 'Entitled', 'Ingrate', 'Took-It'],
  },
  IMMODESTY: {
    high: ['is shamelessly immodest', 'Humblebrag', 'Look-at-Me', 'Brag'],
    low: ['is modest to a fault', 'Aw-Shucks', 'Oh-This'],
  },
  HUMOR: {
    high: ['has a great sense of humour', 'Class Clown', 'Punchline', 'Chuckles'],
    low: ['has no sense of humour', 'Not Funny', 'Unamused', 'Stoneface'],
  },
  VENGEFUL: {
    high: ['never forgets a slight', 'John Wick', 'Payback', 'Tally'],
    low: ['forgives everyone everything', 'Clean Slate', 'Water-Under'],
  },
  PRIDE: {
    high: ['is very proud', 'Peacock', 'Chin-Up'],
    low: ['has no pride at all', 'Doormat', 'Humble Pie'],
  },
  CRUELTY: {
    high: ['is cruel', 'War Criminal', 'Thumbscrew', 'Pinch'],
    low: ['is soft-hearted', 'Cinnamon Roll', 'Softie', 'Tenderheart'],
  },
  SINGLEMINDED: {
    high: ['is single-minded to an alarming degree', 'Tunnel Vision', 'Blinkers', 'One-Track'],
    low: ['is distracted by everything', 'Squirrel', 'Butterfly', 'Wanders'],
  },
  HOPEFUL: {
    high: ['is an incurable optimist', 'Copium', 'Surely-Fine', 'Sunny-Side'],
    low: ['always expects the worst', 'Doomer', 'Told-You', 'Doomsayer'],
  },
  CURIOUS: {
    high: ['pokes {their} nose into everything', 'Curious George', 'Nosy', 'Pokes'],
    low: ['has no curiosity whatsoever', 'Why-Bother', 'Unasked'],
  },
  BASHFUL: {
    high: ['is painfully shy', 'Blush', 'Mumbles'],
    low: ['is utterly shameless', 'No Shame', 'Brass Neck', 'Shameless'],
  },
  PRIVACY: {
    high: ['is intensely private', 'Witness Protection', 'Closed Door', 'Locked'],
    low: ['tells everyone everything', 'TMI', 'Overshare', 'Open Book'],
  },
  PERFECTIONIST: {
    high: ['is a perfectionist', 'Pixel Perfect', 'Once-More', 'Redo'],
    low: ['is sloppy', 'Close-Enough', 'Slapdash'],
  },
  CLOSEMINDED: {
    high: ['is stubbornly closed-minded', 'Boomer', 'Brick Ears', 'Already-Decided'],
    low: ['is open to any idea', 'Open Ears', 'Why-Not'],
  },
  TOLERANT: {
    high: ['puts up with anyone', 'Saint Patience', 'Suffers-Fools', 'Patience'],
    low: ['tolerates nothing and nobody', 'Karen', 'Tut-Tut', 'Scowl'],
  },
  EMOTIONALLY_OBSESSIVE: {
    high: ['obsesses over every feeling', 'Overthinker', 'Broods', 'Clingy'],
    low: ['shrugs off feelings in a moment', 'Goldfish', 'Moves-On', 'Short Memory'],
  },
  SWAYED_BY_EMOTIONS: {
    high: ['is ruled by {their} feelings', 'Drama Queen', 'Weathervane', 'Heart-First'],
    low: ['is never swayed by feelings', 'Spock', 'Level Head', 'Cold Chisel'],
  },
  ALTRUISM: {
    high: ['helps everyone', 'Good Samaritan', 'Soft Touch', 'Gives-a-Hand'],
    low: ['will not lift a finger for anyone', 'Not My Problem', 'Not-My-Job', 'Busy'],
  },
  DUTIFULNESS: {
    high: ['is dutiful', 'Hall Monitor', 'By-the-Book', 'Rulebook'],
    low: ['has no sense of duty', 'Out of Office', 'Shirks', 'Not-Now'],
  },
  THOUGHTLESSNESS: {
    high: ['acts without thinking', 'YOLO', 'Oops', 'Leaps-First'],
    low: ['thinks everything through twice', 'Measure-Twice', 'Ponders'],
  },
  ORDERLINESS: {
    high: ['is fanatically orderly', 'Marie Kondo', 'Neat Stack', 'Tidy'],
    low: ['lives in total disorder', 'Hoarder', 'Clutter', 'Heap'],
  },
  TRUST: {
    high: ['trusts everyone', 'Gullible', 'Easy Mark', 'Believes-It'],
    low: ['trusts nobody', 'Trust Issues', 'Side-Eye', 'Squints'],
  },
  GREGARIOUSNESS: {
    high: ['loves a crowd', 'Party Animal', 'Chatter', 'Party'],
    low: ['avoids company', 'Introvert', 'Hermit', 'Corner Seat'],
  },
  ASSERTIVENESS: {
    high: ['is pushy', 'Speak to the Manager', 'Shove', 'Loud'],
    low: ['is a pushover', 'Pushover', 'Whatever-You-Say'],
  },
  ACTIVITY_LEVEL: {
    high: ['is always on the go', 'Sonic', 'Fidget', 'Zoom'],
    low: ['barely moves', 'Couch Potato', 'Lump', 'Slow Pour'],
  },
  EXCITEMENT_SEEKING: {
    high: ['craves thrills', 'Adrenaline Junkie', 'Double-Dare', 'Dares'],
    low: ['avoids any excitement', 'Slippers', 'Quiet Life'],
  },
  IMAGINATION: {
    high: ['has a wild imagination', 'Space Cadet', 'Daydream', 'Faraway'],
    low: ['has no imagination', 'Literal', 'Plain Mug'],
  },
  ABSTRACT_INCLINED: {
    high: ['loves abstract ideas', 'Galaxy Brain', 'Head-in-Clouds', 'Theory'],
    low: ['is practical to the bone', 'Smooth Brain', 'Nuts-and-Bolts', 'Hammer-Brain'],
  },
  ART_INCLINED: {
    high: ['loves art', 'Gallery Snob', 'Easel', 'Fine Taste'],
    low: ['has no feeling for art', 'Philistine', 'Wall-Is-Wall'],
  },
}

const VALUES: Record<string, { pos: Entry; neg: Entry }> = {
  LAW: {
    pos: ['respects the law above all', 'Narc', 'Hall Monitor', 'By-Law'],
    neg: ['thinks laws are for other dwarves', 'Loophole', 'Outlaw'],
  },
  LOYALTY: {
    pos: ['is loyal to a fault', 'Ride or Die', 'Staunch', 'Faithful'],
    neg: ['sees no point in loyalty', 'Snake', 'Fairweather', 'Turncoat'],
  },
  FAMILY: {
    pos: ['lives for {their} family', 'Family Guy', 'Kinfolk'],
    neg: ['has no time for family', 'Orphan Energy', 'No-Kin'],
  },
  FRIENDSHIP: {
    pos: ['lives for {their} friends', 'Bestie', 'Pal'],
    neg: ['thinks friendship is a waste of time', 'Lone Wolf', 'Party of One', 'No-Pals'],
  },
  POWER: {
    pos: ['craves power', 'Supervillain', 'Throne-Eyes', 'Next-Baron'],
    neg: ['despises power', 'Anarchist', 'No-Crown'],
  },
  TRUTH: {
    pos: ['cannot abide a lie', 'No Cap', 'Blunt', 'Honest Pick'],
    neg: ['thinks the truth is overrated', 'Cap', 'Tall Tales', 'Fibs'],
  },
  CUNNING: {
    pos: ['admires cunning', 'Big Brain', 'Angles', 'Sly'],
    neg: ['despises cunning', 'Plainspoke'],
  },
  ELOQUENCE: {
    pos: ['loves fine words', 'Thesaurus', 'Wordy', 'Silver'],
    neg: ['distrusts fine words', 'Caveman', 'Grunts'],
  },
  FAIRNESS: {
    pos: ['is fair to a fault', 'The Ref', 'Even Scales'],
    neg: ['thinks fairness is for fools', 'Cheat Codes', 'Loaded Dice', 'Cheats'],
  },
  DECORUM: {
    pos: ['insists on decorum', 'Pinky Up', 'Prim', 'Manners'],
    neg: ['has no use for decorum', 'Gremlin', 'Elbows-on-Table'],
  },
  TRADITION: {
    pos: ['holds to tradition', 'Boomer', 'Old Ways'],
    neg: ['scorns tradition', 'Zoomer', 'New Ways'],
  },
  ARTWORK: {
    pos: ['loves artwork', 'Art Critic', 'Gallery'],
    neg: ['thinks art is a waste of good stone', 'Waste-of-Stone', 'Philistine'],
  },
  COOPERATION: {
    pos: ['believes in working together', 'Team Player', 'Team Pick'],
    neg: ['would rather work alone', 'Solo Queue', 'Lone Pick', 'Solo'],
  },
  INDEPENDENCE: {
    pos: ['prizes {their} independence', 'Sigma', 'Own-Way'],
    neg: ['distrusts independence', 'Sheep', 'Follows'],
  },
  STOICISM: {
    pos: ['thinks feelings should stay hidden', 'Marcus Aurelius', 'Stoneface'],
    neg: ['thinks feelings should be shown', 'Crybaby', 'Sleeve-Heart', 'Weeps'],
  },
  INTROSPECTION: {
    pos: ['loves examining {self}', 'Dear Diary', 'Navel-Gazer'],
    neg: ['refuses to look inward', 'No-Mirror'],
  },
  SELF_CONTROL: {
    pos: ['prizes self-control', 'Tight Lid'],
    neg: ['thinks self-control is for the weak', 'Feral', 'Unhinged', 'No-Lid'],
  },
  TRANQUILITY: {
    pos: ['loves peace and quiet', 'Library Voice', 'Quiet Please'],
    neg: ['loves noise and bustle', 'Air Horn', 'Racket', 'Din'],
  },
  HARMONY: {
    pos: ['values harmony', 'Even Keel'],
    neg: ['finds harmony boring', 'Agent of Chaos', 'Stirrer', 'Discord'],
  },
  MERRIMENT: {
    pos: ['lives for merriment', 'Party Animal', 'Revel', 'Jolly'],
    neg: ['thinks merriment is a waste of time', 'Fun Police', 'Wet Blanket', 'Killjoy'],
  },
  CRAFTSMANSHIP: {
    pos: ['lives for fine craftsmanship', 'Artisanal', 'Just-So', 'Fine Grain'],
    neg: ['does not care about craftsmanship', 'Duct Tape', 'Bodger'],
  },
  MARTIAL_PROWESS: {
    pos: ['admires martial prowess', 'Gym Bro', 'Swordtalk', 'Warbook'],
    neg: ['despises fighting skill', 'Butterknife'],
  },
  SKILL: {
    pos: ['admires skill above all', 'Git Gud', 'Show-Me'],
    neg: ['thinks skill is overrated', 'Skill Issue', 'Winging-It'],
  },
  HARD_WORK: {
    pos: ['lives for hard work', 'Grindset', 'Grindstone', 'Overtime'],
    neg: ['thinks hard work is for fools', 'Quiet Quitter', 'Nap Time', 'Loafer'],
  },
  SACRIFICE: {
    pos: ['believes in sacrifice', 'Martyr'],
    neg: ['thinks sacrifice is pointless', 'Me-First'],
  },
  COMPETITION: {
    pos: ['loves competition', 'Tryhard', 'Race-You', 'Scorekeeper'],
    neg: ['hates competition', 'Participation Trophy', 'Everybody-Wins'],
  },
  PERSEVERANCE: {
    pos: ['values perseverance', 'Keeps-Digging'],
    neg: ['thinks perseverance is foolish', 'Why-Try', 'Quitter'],
  },
  LEISURE_TIME: {
    pos: ['lives for time off', 'Lunch Break', 'Hammock', 'Tea Break'],
    neg: ['thinks time off is wasted time', 'Workaholic', 'No-Breaks', 'Always-On'],
  },
  COMMERCE: {
    pos: ['loves trade', 'Crypto Bro', 'Price-Check', 'Haggle'],
    neg: ['despises trade', 'No-Sale'],
  },
  ROMANCE: {
    pos: ['lives for romance', 'Hopeless Romantic', 'Sweetheart'],
    neg: ['thinks romance is silly', 'Unromantic'],
  },
  NATURE: {
    pos: ['loves nature, like an elf', 'Elf Friend', 'Treehugger', 'Leafy'],
    neg: ['hates nature', 'Elf Fister', 'Treekicker', 'Anti-Leaf'],
  },
  PEACE: {
    pos: ['values peace', 'Hippie', 'Dove'],
    neg: ['thinks war is the answer', 'Warmonger', 'Itchy Axe'],
  },
  KNOWLEDGE: {
    pos: ['lives for knowledge', 'Nerd', 'Footnote', 'Bookish'],
    neg: ['thinks learning is a waste of time', 'Smooth Brain', 'Proud Dunce', 'Unread'],
  },
}

interface ThoughtLex {
  weight: number
  /** Overrides the chronicle's phrase. */
  phrase?: string
  names?: string[]
  /** Usually unpleasant, so a happy emotion about it is the joke. */
  bad?: boolean
  /** Names for when they enjoyed it anyway. */
  enjoyed?: string[]
}

const t = (
  weight: number,
  names: string[] = [],
  extra: Omit<ThoughtLex, 'weight' | 'names'> = {},
): ThoughtLex => ({ weight, names, ...extra })

const ROUTINE = t(0.2)

const THOUGHTS: Record<string, ThoughtLex> = {
  SatisfiedAtWork: ROUTINE,
  ImproveSkill: ROUTINE,
  Talked: ROUTINE,
  AdmireBuilding: ROUTINE,
  AdmireArrangedBuilding: ROUTINE,
  AdmireOwnBuilding: ROUTINE,
  AdmireOwnArrangedBuilding: ROUTINE,
  WatchPerform: ROUTINE,
  DiningQuality: ROUTINE,
  BedroomQuality: ROUTINE,
  DiscussOthersProblems: ROUTINE,
  DiscussProblems: ROUTINE,
  IntellectualDiscussion: ROUTINE,
  ReceivedComplaint: ROUTINE,
  LearnTopic: ROUTINE,
  PonderTopic: ROUTINE,
  NeedsUnfulfilled: t(0.4),
  MadeFriend: t(0.5),
  Prayer: t(0.5),
  MakeMasterwork: t(0.9),
  MasterSkill: t(0.8),
  Drowsy: t(0.6),
  Thirsty: t(0.6),
  Hungry: t(0.6),
  Spar: t(0.8),
  MinorInjuries: t(0.8, ['Band-Aid', 'Scrapes']),
  Syndrome: t(1.2),
  Trauma: t(1.2, [], { bad: true }),
  EatVermin: t(2.6, ['Rat Muncher', 'Ratsnack', 'Crunchy'], {
    enjoyed: ['Rat Sommelier', 'Rat Gourmet'],
  }),
  EatLikeAnimal: t(1.8, ['Feral', 'Floor-Supper', 'Lap-Plate']),
  DrinkWithoutCup: t(1.4, ['Barrel Slurper', 'Cupless', 'Two-Hands']),
  AteRotten: t(2.4, ['Trash Panda', 'Iron Belly', 'Rotgut'], {
    phrase: 'ate rotten food',
    bad: true,
  }),
  DrankSpoiled: t(2.2, ['Expired Milk', 'Sour Sip'], {
    phrase: 'drank something spoiled',
    bad: true,
  }),
  NastyWater: t(2, ['Puddle Slurper', 'Puddle-Sip'], { phrase: 'drank nasty water', bad: true }),
  DrinkVomit: t(3, ['Vomit Comet', 'Second-Hand Sip'], { phrase: 'drank vomit' }),
  DrinkBlood: t(2.6, ['Count Dwarfula', 'Bloodsip', 'Vampire'], { phrase: 'drank blood' }),
  DrinkSlime: t(2.6, ['Slimer', 'Slimesip'], { phrase: 'drank slime' }),
  DrinkGoo: t(2.6, ['Goo Guzzler', 'Gooey'], { phrase: 'drank goo' }),
  DrinkIchor: t(2.6, ['Ichor Chugger', 'Ichorsip'], { phrase: 'drank ichor' }),
  DrinkPus: t(2.8, ['Pus Slurper', 'Pus-Sip'], { phrase: 'drank pus' }),
  SameFood: t(1.3, ['Picky Eater', 'Same-Again'], { phrase: 'got sick of eating the same thing' }),
  SameBooze: t(1.3, ['Booze Snob', 'Same-Barrel'], {
    phrase: 'got sick of drinking the same booze',
  }),
  EatPet: t(3, ['Ate the Dog', 'Petmeal'], { phrase: 'ate a former pet' }),
  SleptMud: t(2.4, ['Shrek', 'Swamp Thing', 'Mudbed'], { phrase: 'slept in the mud' }),
  SleptFloor: t(1.6, ['Floor Goblin', 'Floorbed'], { phrase: 'slept on the floor' }),
  SleptRoughFloor: t(1.6, ['Rockpillow'], { phrase: 'slept on a rough stone floor' }),
  SleptRocks: t(1.8, ['Pet Rock', 'Pebblebed', 'Rockpillow'], { phrase: 'slept on rocks' }),
  SleptGrass: t(1.8, ['Touch Grass', 'Grassbed'], { phrase: 'slept in the grass' }),
  SleptIce: t(2.4, ['Ice Cube', 'Icebed', 'Frostpillow'], { phrase: 'slept on ice' }),
  SleptDirt: t(1.8, ['Dirtnap'], { phrase: 'slept in the dirt' }),
  SleptDriftwood: t(2, ['Driftwood Snoozer', 'Driftbed'], { phrase: 'slept on driftwood' }),
  SleepNoiseWake: t(1.4, ['Light Sleeper', 'Earplugs']),
  SleepNoiseMajorWake: t(1.4, ['Light Sleeper', 'Earplugs']),
  VeryDrowsy: t(1.4, ['Narcoleptic', 'Yawns', 'Nods-Off']),
  Dehydrated: t(1.8, ['Raisin', 'Parched', 'Dry Throat']),
  Starving: t(2, ['Skeletor', 'Hollow', 'Rumbles']),
  Rain: t(1.2, ['Soggy', 'Drizzle'], {
    bad: true,
    enjoyed: ['Singin in the Rain', 'Puddles', 'Rain-Glad'],
  }),
  SnowStorm: t(1.6, ['Frostnose', 'Snowcap'], { bad: true, enjoyed: ['Let It Snow', 'Snowglee'] }),
  FreakishWeather: t(1.8, ['Stormbitten'], { bad: true, enjoyed: ['Storm Chaser', 'Storm-Glee'] }),
  Miasma: t(1.8, ['Stinkface', 'Whiff'], {
    bad: true,
    enjoyed: ['Gremlin', 'Stinklover', 'Sniffs-Rot'],
  }),
  Smoke: t(1.6, ['Smokey', 'Kipper', 'Sooty'], { bad: true, enjoyed: ['Smokesniffer'] }),
  Dust: t(1.2, ['Dust Bunny', 'Dusty'], { phrase: 'got covered in dust', bad: true }),
  Waterfall: t(1.4, ['Mist-Face'], { phrase: 'stood in the spray of a waterfall' }),
  SunNausea: t(1.8, ['Basement Dweller', 'Cave-Pale', 'Sunsick'], {
    phrase: 'was sickened by the sun',
    bad: true,
  }),
  SunIrritated: t(1.4, ['Sunscowl'], { phrase: 'was irritated by the sun', bad: true }),
  SawDeadBody: t(1.4, ['Bodyfinder'], {
    bad: true,
    enjoyed: ['True Crime Fan', 'Morbid', 'Grave Fan'],
  }),
  NoShoes: t(1.8, ['Hobbit', 'Barefoot', 'Tenderfoot']),
  NoShirt: t(1.8, ['Magic Mike', 'Shirtless']),
  OldClothing: t(1.2, ['Threadbare']),
  TatteredClothing: t(1.6, ['Rags', 'Threadbare']),
  RottedClothing: t(2.2, ['Moth-Snack', 'Rags']),
  Uncovered: t(2.4, ['Birthday Suit', 'Starkers'], { phrase: 'went about uncovered' }),
  GhostHaunt: t(2.2, ['Ghostbuster', 'Haunted', 'Ghost-Pal'], { bad: true }),
  GhostNightmare: t(2, ['Haunted'], { bad: true }),
  Cavein: t(2.6, ['OSHA Violation', 'Rubble', 'Flat-Hat'], {
    bad: true,
    enjoyed: ['Rubble-Glad'],
  }),
  SparringAccident: t(2.4, ['Friendly Fire', 'Oops-Spear'], { phrase: 'had a sparring accident' }),
  LackWork: t(1.6, ['Unemployed', 'Idle Hands', 'Loafs']),
  MajorInjuries: t(1.6, ['Test Dummy', 'Stitches', 'Patchwork']),
  Complained: t(1.2, ['Karen', 'Complaint Desk', 'Grumbles']),
  Bath: t(1.2, ['Soapy', 'Squeaky']),
  SoapyBath: t(1.4, ['Bubble Bath', 'Bubbles'], { phrase: 'took a soapy bath' }),
  NewRomance: t(1.4, ['Down Bad', 'Lovestruck', 'Swoons']),
  Argument: t(1.3, ['Squabble', 'Snaps'], {
    bad: true,
    enjoyed: ['Reply Guy', 'Argues-for-Fun', 'Relishes-a-Row'],
  }),
  FistFight: t(2, ['Fight Club', 'Knuckles', 'Brawl'], { phrase: 'got into a fist fight' }),
  GaveBeating: t(2.2, ['Fists of Fury', 'Knuckles'], { phrase: 'gave someone a beating' }),
  GotBeaten: t(2.2, ['Punching Bag', 'Bruises'], { phrase: 'got beaten', bad: true }),
  GaveHammering: t(2.2, ['Judge Dredd', 'Gavel'], { phrase: 'hammered a criminal as punishment' }),
  GotHammered: t(2.6, ['Hammered'], {
    phrase: 'got hammered as a punishment',
    bad: true,
    enjoyed: ['Likes-the-Hammer'],
  }),
  Jailed: t(2.4, ['Convict', 'Jailbird'], { phrase: 'was jailed' }),
  JailReleased: t(1.6, ['Parole'], { phrase: 'was let out of jail' }),
  Kill: t(2.2, ['Body Count', 'Bloodied', 'Tally']),
  FirstKill: t(2, ['Rambo', 'First Blood']),
  Attacked: t(1.6, ['Test Dummy', 'Punching Bag'], { bad: true }),
  AttackedByDead: t(2.4, ['Zombie Snack', 'Zombie-Chew', 'Corpse-Kicked'], {
    bad: true,
    enjoyed: ['Walking Dead Fan', 'Zombie Fan'],
  }),
  LostPet: t(1.4, ['Petless']),
  MadeArtifact: t(2.6, ['One-Hit Wonder', 'Heirloom', 'Fey Hands']),
  AnnoyedVermin: t(1.8, ['Rat King', 'Rat-Magnet', 'Fleabag'], {
    phrase: 'was pestered by vermin',
  }),
  PesteredVermin: t(1.8, ['Rat King', 'Rat-Magnet', 'Fleabag'], {
    phrase: 'was pestered by vermin',
  }),
  NearVermin: t(1.2, ['Rat-Magnet'], { phrase: 'was bothered by vermin nearby' }),
  Taxed: t(1.4, ['Taxpayer', 'Taxed'], { phrase: 'got taxed', bad: true }),
  Elected: t(1.6, ['Elected Official', 'Ballot']),
  Reelected: t(1.8, ['Four More Years', 'Ballot-Again'], { phrase: 'was re-elected' }),
  Demands: t(1.6, ['Entitled', 'Wants-More']),
  Perform: t(1.2, ['Rockstar', 'Encore']),
  ResearchBreakthrough: t(1.8, ['Big Brain', 'Eureka']),
  ThrownStuff: t(2.4, ['Rage Quit', 'Table-Flipper', 'Throws'], {
    phrase: 'threw things in a tantrum',
  }),
  ToppledStuff: t(2.4, ['Table-Flipper', 'Rage Quit'], {
    phrase: 'toppled furniture in a tantrum',
  }),
  Decay: t(1.6, ['Smells'], { phrase: 'caught the smell of decay' }),
  MeetingInBedroom: t(1.8, ['Work From Home', 'Bedroom Office'], {
    phrase: 'held a meeting in a bedroom',
  }),
  ReceivedFood: t(1.4, ['Room Service', 'Spoon-Fed'], { phrase: 'was fed in bed by a fortmate' }),
  ReceivedWater: t(1.4, ['Room Service', 'Spoon-Fed'], {
    phrase: 'was given water in bed by a fortmate',
  }),
}

// ---------------------------------------------------------------------------
// Skills and jobs

const SKILL_LABELS: Record<string, string> = {
  CONSOLE: 'consoling people',
  PACIFY: 'calming people down',
  JUDGING_INTENT: 'reading people',
  SPEAKING: 'speechmaking',
  MAKE_MUSIC: 'making music',
  SING_MUSIC: 'singing',
  PLAY_STRINGED_INSTRUMENT: 'playing strings',
  PLAY_KEYBOARD_INSTRUMENT: 'playing keys',
  PLAY_WIND_INSTRUMENT: 'playing wind instruments',
  PLAY_PERCUSSION_INSTRUMENT: 'drumming',
  PROCESSFISH: 'cleaning fish',
  PROCESSPLANTS: 'processing plants',
  CUT_STONE: 'cutting stone',
  CARVE_STONE: 'engraving stone',
  CUTGEM: 'cutting gems',
  ENCRUSTGEM: 'setting gems',
  FISH: 'fishing',
  PLANT: 'farming',
  COOK: 'cooking',
  SMELT: 'smelting',
  FORGE_WEAPON: 'forging weapons',
  FORGE_ARMOR: 'forging armour',
  FORGE_FURNITURE: 'forging metal goods',
  GLASSMAKER: 'glassmaking',
  STONECRAFT: 'stone crafts',
  WOODCRAFT: 'wood crafts',
  METALCRAFT: 'metal crafts',
  BONECARVE: 'bone carving',
  LEATHERWORK: 'leatherworking',
  EXTRACT_STRAND: 'extracting adamantine',
  ANIMALTRAIN: 'training animals',
  ANIMALCARE: 'caring for animals',
  DESIGNBUILDING: 'architecture',
  SIEGEOPERATE: 'operating siege engines',
  OPERATE_PUMP: 'pumping',
  KNOWLEDGE_ACQUISITION: 'studying',
  SITUATIONAL_AWARENESS: 'watching {their} back',
  CRUTCH_WALK: 'walking on a crutch',
  RECORD_KEEPING: 'keeping records',
  STANCE_STRIKE: 'kicking',
  MISC_WEAPON: 'fighting with whatever is to hand',
}

/** Skills that have nothing to do with a dwarf's trade: being best at one is the joke. */
const ODD_SKILLS: Record<string, string[]> = {
  COMEDY: ['Class Clown', 'Punchline', 'Heckles'],
  FLATTERY: ['Brown Nose', 'Honeytongue', 'Sweet-Talk'],
  LYING: ['Pinocchio', 'Fibber', 'Tall Tale'],
  INTIMIDATION: ['Death Stare', 'The Stare', 'Glower'],
  PERSUASION: ['Sales Pitch', 'Silver Tongue', 'Talks-You-Round'],
  NEGOTIATION: ['Art of the Deal', 'Final Offer', 'Haggle'],
  CONSOLE: ['Therapist', 'There-There', 'Shoulder'],
  PACIFY: ['Hostage Negotiator', 'Hush-Now', 'Calm-Down'],
  CONVERSATION: ['Podcast Bro', 'Chatterbox', 'Natter'],
  JUDGING_INTENT: ['Sherlock', 'Reads-You', 'Knowing Look'],
  SPEAKING: ['TED Talk', 'Speechify'],
  DANCE: ['Tiny Dancer', 'Twinkletoes', 'Jig'],
  SING_MUSIC: ['Karaoke', 'Warble', 'Hums'],
  MAKE_MUSIC: ['Plinks'],
  PLAY_STRINGED_INSTRUMENT: ['Air Guitar', 'Twang', 'Plinks'],
  PLAY_KEYBOARD_INSTRUMENT: ['Keys'],
  PLAY_WIND_INSTRUMENT: ['Toot'],
  PLAY_PERCUSSION_INSTRUMENT: ['Drum Solo', 'Drumroll', 'Thump'],
  POETRY: ['Slam Poet', 'Rhymes', 'Verse'],
  PROSE: ['Fanfic', 'Scribbles'],
  WRITING: ['Ghostwriter', 'Inkfingers'],
  READING: ['Book Club', 'Bookworm'],
  SWIMMING: ['Aquadwarf', 'Splash', 'Floats'],
  CLIMBING: ['Spider-Dwarf', 'Handholds', 'Up-the-Wall'],
  DODGING: ['Neo', 'Duck', 'Sidestep'],
  SNEAK: ['Solid Snake', 'Tiptoe', 'Creeps'],
  MILK: ['Milkman', 'Udders'],
  GELD: ['Nutcracker', 'Snip-Snip'],
  CHEESEMAKING: ['Big Cheese', 'Curds', 'Whey'],
  SOAP_MAKING: ['Tyler Durden', 'Lather'],
  SHEARING: ['Barber', 'Clippers'],
  BEEKEEPING: ['Bee Movie', 'Buzz'],
  WAX_WORKING: ['Wax On', 'Waxy'],
  PRESSING: ['Squish'],
  CRUTCH_WALK: ['Hopalong'],
  STANCE_STRIKE: ['Karate Kid', 'Kicks'],
  SITUATIONAL_AWARENESS: ['Spidey Sense', 'Eyes-Behind'],
}

/** Names for whoever is legendary at a skill, or the fortress's best at it. */
const SKILL_NAMES: Record<string, string[]> = {
  MINING: ['Diggy Diggy Hole', 'Human Drill'],
  WOODCUTTING: ['Lumberjack', 'Treeslayer'],
  CARPENTRY: ['Woodworker Supreme'],
  DETAILSTONE: ['Smooth Operator'],
  MASONRY: ['The Rock', 'Rock Solid'],
  ENGRAVE_STONE: ['Wall Scribbler'],
  CARVE_STONE: ['Wall Scribbler'],
  BREWING: ['Heisenberg', 'Brewmaster'],
  COOK: ['Remy', 'Chef Kiss'],
  FISH: ['Captain Ahab', 'Fish Whisperer'],
  PROCESSFISH: ['Fish Gutter'],
  BUTCHER: ['Sweeney Todd', 'Meat Guy'],
  TANNER: ['Skin Collector'],
  MECHANICS: ['Lever Enjoyer', 'Gear Head'],
  PLANT: ['Farmer Joe', 'Green Thumb'],
  HERBALISM: ['Weed McGee', 'Herb Nerd'],
  POTTERY: ['Clayborn', 'Pot Head'],
  GLASSMAKER: ['Glass Cannon'],
  SMELT: ['Hot Stuff'],
  FORGE_WEAPON: ['Hattori Hanzo'],
  FORGE_ARMOR: ['Tin Man'],
  BONECARVE: ['Bone Collector'],
  ANIMALTRAIN: ['Beastmaster'],
  ANIMALCARE: ['Dr. Dolittle'],
  DIAGNOSE: ['House MD'],
  SURGERY: ['Dr. Stitches, PhD'],
  SET_BONE: ['Bone Zone'],
  SUTURE: ['Stitch Witch'],
  WEAVING: ['Spinster'],
  CLOTHESMAKING: ['Project Runway'],
  GEM_CUTTING: ['Shiny Rock Guy'],
  CUTGEM: ['Shiny Rock Guy'],
  ENCRUSTGEM: ['Bling'],
  SIEGEOPERATE: ['Artillery Andy'],
  OPERATE_PUMP: ['Pump It Up'],
  WRESTLING: ['Hulk Hogan', 'Suplex'],
  AXE: ["Here's Johnny"],
  HAMMER: ['Hammer Time'],
  CROSSBOW: ['Hawkeye'],
  BOW: ['Legolas'],
  SWORD: ['Highlander'],
  SPEAR: ['Shish Kebab'],
  MACE: ['Maceface'],
  DAGGER: ['Stabby'],
  PIKE: ['Pikachu'],
  WHIP: ['Indiana Jones'],
  SHIELD: ['Captain Shield'],
  DODGING: ['Neo'],
}

/** Offices that come with a joke of their own. */
const POSITION_NAMES: [post: RegExp, names: string[]][] = [
  [/mayor/i, ['Mayor McCheese', 'Big Boss']],
  [/manager/i, ['Middle Management', 'Clipboard']],
  [/bookkeeper/i, ['Number Cruncher', 'Spreadsheet']],
  [/broker/i, ['Wolf of Wall Street', 'Salesdwarf']],
  [/medical/i, ['Dr. Feelgood', 'Doc']],
  [/sheriff|captain of the guard/i, ['Robocop', 'The Law']],
  [/militia commander/i, ['Armchair General', 'General']],
  [/expedition leader/i, ['Team Lead', 'Boss Dwarf']],
  [/hammerer/i, ['Hammer Time']],
  [/baron|count|duke|monarch|king|queen/i, ['Your Grace', 'Big Cheese']],
]

/** Weapons civilians carry about, by the word ending the item's name. */
const WEAPON_NAMES: Record<string, string[]> = {
  axe: ['Axe Murderer', "Here's Johnny"],
  sword: ['Highlander', 'Sword Guy'],
  spear: ['Shish Kebab', 'Pointy'],
  mace: ['Maceface'],
  hammer: ['Hammer Time'],
  crossbow: ['Hawkeye'],
  bow: ['Legolas'],
  dagger: ['Stabby', 'Shiv'],
  whip: ['Indiana Jones'],
  pike: ['Pikachu'],
  scimitar: ['Aladdin'],
  flail: ['Flail Whale'],
}

const SOCIAL_SKILLS = new Set([
  'COMEDY',
  'FLATTERY',
  'LYING',
  'INTIMIDATION',
  'PERSUASION',
  'NEGOTIATION',
  'CONSOLE',
  'PACIFY',
  'CONVERSATION',
  'JUDGING_INTENT',
  'SPEAKING',
])

const MILITARY_SKILLS = [
  'AXE',
  'SWORD',
  'MACE',
  'HAMMER',
  'SPEAR',
  'DAGGER',
  'PIKE',
  'WHIP',
  'CROSSBOW',
  'BOW',
  'MELEE_COMBAT',
  'RANGED_COMBAT',
  'WRESTLING',
  'BITE',
  'GRASP_STRIKE',
  'STANCE_STRIKE',
  'SHIELD',
  'ARMOR',
  'DODGING',
  'MISC_WEAPON',
]

/** A post, the skills it needs, and what it means to hold it without any. */
const UNQUALIFIED: [post: RegExp, skills: string[], entry: Entry][] = [
  [
    /medical/i,
    ['DIAGNOSE', 'SURGERY', 'SET_BONE', 'SUTURE', 'DRESS_WOUNDS'],
    [
      'is the chief medical dwarf without a single medical skill',
      'Dr. Guesswork, PhD',
      'WebMD',
      'Doctor Maybe',
      'Leeches',
    ],
  ],
  [
    /bookkeeper/i,
    ['RECORD_KEEPING'],
    [
      'keeps the fortress books without knowing how to keep records',
      'Creative Accountant',
      'Counts-on-Fingers',
      'Roughly',
    ],
  ],
  [
    /broker/i,
    ['APPRAISAL'],
    [
      'trades for the fortress with no idea what anything is worth',
      'Scammed',
      'Bad Bargain',
      'Overpays',
    ],
  ],
  [
    /manager/i,
    ['ORGANIZATION'],
    [
      'manages the fortress without any head for organisation',
      'Middle Management',
      'Lost Memo',
      'Whose Order',
    ],
  ],
  [
    /commander|captain|lieutenant|sheriff/i,
    MILITARY_SKILLS,
    [
      'leads soldiers without knowing how to fight',
      'Armchair General',
      'Paper Sword',
      'Behind-You',
    ],
  ],
]

// ---------------------------------------------------------------------------
// Looks and wardrobe

interface LookExtreme {
  /** `body:HEIGHT` for body-wide modifiers, `CATEGORY:TYPE` for body part ones. */
  key: string
  high?: Entry
  low?: Entry
  /** How far from the fort's median the extreme must sit to be worth a remark. */
  spread?: number
}

const LOOKS: LookExtreme[] = [
  {
    key: 'body:HEIGHT',
    high: ['is the tallest dwarf in the fortress', 'Tall Boy', 'Rafters', 'Lofty'],
    low: ['is the shortest dwarf in the fortress', 'Fun Size', 'Knee-High', 'Pebble'],
    spread: 5,
  },
  {
    key: 'body:BROADNESS',
    high: ['is the broadest dwarf in the fortress', 'Thicc', 'Doorframe', 'Barrel'],
    low: ['is the narrowest dwarf in the fortress', 'Noodle', 'Sliver', 'Plank'],
    spread: 5,
  },
  {
    key: 'NOSE:BROADNESS',
    high: ['has the broadest nose in the fortress', 'Honker', 'Snout', 'Nostrils'],
    low: ['has the narrowest nose in the fortress', 'Needle-Nose'],
  },
  {
    key: 'NOSE:LENGTH',
    high: ['has the longest nose in the fortress', 'Schnozz', 'Beak', 'Nosey'],
    low: ['has the shortest nose in the fortress', 'Button'],
  },
  { key: 'NOSE:UPTURNED', high: ['has the most upturned nose in the fortress', 'Snoot', 'Piggy'] },
  { key: 'NOSE:CONVEX', high: ['has the most hooked nose in the fortress', 'Hook', 'Crag'] },
  {
    key: 'EAR:SPLAYED_OUT',
    high: ['has the most sticking-out ears in the fortress', 'Dumbo', 'Jugs', 'Sails'],
  },
  {
    key: 'EAR:HANGING_LOBES',
    high: ['has the droopiest earlobes in the fortress', 'Lobes', 'Danglers'],
  },
  {
    key: 'EAR:BROADNESS',
    high: ['has the widest ears in the fortress', 'Satellite Dish', 'Flaps'],
  },
  {
    key: 'EYE:CLOSE_SET',
    high: ['has the most close-set eyes in the fortress', 'Squinch'],
    low: ['has the widest-set eyes in the fortress', 'Hammerhead', 'Wide-Eyes'],
  },
  {
    key: 'EYE:DEEP_SET',
    high: ['has the most deep-set eyes in the fortress', 'Cave-Eyes', 'Hollows'],
    low: ['has the most bulging eyes in the fortress', 'Gollum', 'Goggles', 'Boggle'],
  },
  {
    key: 'EYE:LARGE_IRIS',
    high: ['has the biggest irises in the fortress', 'Anime Eyes', 'Saucers'],
  },
  {
    key: 'LIP:THICKNESS',
    high: ['has the thickest lips in the fortress', 'Duck Face', 'Pout'],
    low: ['has the thinnest lips in the fortress', 'Thin-Lip'],
  },
  {
    key: 'TOOTH:GAPS',
    high: ['has the gappiest teeth in the fortress', 'Gap Year', 'Whistles', 'Gap'],
  },
  {
    key: 'TOOTH:LENGTH',
    high: ['has the longest teeth in the fortress', 'Bugs Bunny', 'Tusks', 'Fangs'],
  },
  {
    key: 'SKULL:JUTTING_CHIN',
    high: ['has the most jutting chin in the fortress', 'Jay Leno', 'Lanternjaw', 'Shovel'],
  },
  { key: 'SKULL:SQUARE_CHIN', high: ['has the squarest chin in the fortress', 'Brickjaw'] },
  {
    key: 'SKULL:HIGH_CHEEKBONES',
    high: ['has the highest cheekbones in the fortress', 'Zoolander', 'Cheekbones'],
  },
  {
    key: 'THROAT:DEEP_VOICE',
    high: ['has the deepest voice in the fortress', 'Barry White', 'Rumble', 'Gravel'],
    low: ['has the highest voice in the fortress', 'Chipmunk', 'Squeak', 'Piccolo'],
  },
  {
    key: 'THROAT:RASPY_VOICE',
    high: ['has the raspiest voice in the fortress', 'Smoker Voice', 'Rasp', 'Croak'],
  },
  {
    key: 'HEAD:BROADNESS',
    high: ['has the widest head in the fortress', 'Big Head Mode', 'Anvilhead', 'Melon'],
  },
]

const HAIR_LAYERS: Record<string, string> = {
  HAIR: 'hair',
  CHIN_WHISKERS: 'beard',
  MOUSTACHE: 'moustache',
  SIDEBURNS: 'sideburns',
}

const LONGEST_NAMES: Record<string, string[]> = {
  HAIR: ['Rapunzel', 'Mop', 'Curtains'],
  CHIN_WHISKERS: ['Floorsweeper', 'Beard-Trip', 'Gandalf'],
  MOUSTACHE: ['Mario', 'Walrus', 'Handlebars'],
  SIDEBURNS: ['Wolverine', 'Muttonchops'],
}

const STYLE_WORDS: Record<string, string> = {
  BRAIDED: 'braided',
  DOUBLE_BRAIDS: 'in double braids',
  PONY_TAIL: 'in a ponytail',
  PONY_TAILS: 'in ponytails',
}

const STYLE_NAMES: Record<string, string[]> = {
  'SIDEBURNS:BRAIDED': ['Tassels', 'Ropecheeks'],
  'SIDEBURNS:DOUBLE_BRAIDS': ['Tassels', 'Ropecheeks'],
  'MOUSTACHE:BRAIDED': ['Tassel-Lip', 'Ropelip'],
  'MOUSTACHE:DOUBLE_BRAIDS': ['Tassel-Lip', 'Forklip'],
  'CHIN_WHISKERS:BRAIDED': ['Ropebeard'],
  'CHIN_WHISKERS:DOUBLE_BRAIDS': ['Forkbeard'],
  'HAIR:DOUBLE_BRAIDS': ['Pigtails'],
}

/** Worn item subtypes worth a remark: what to call it, how much, and names. */
const GARMENTS: Record<string, [text: string, weight: number, ...names: string[]]> = {
  ITEM_HELM_MASK: ['wears a mask', 1.6, 'Zorro', 'Masked', 'Who-Is-That'],
  ITEM_HELM_VEIL_FACE: ['wears a face veil', 1.4, 'Veiled'],
  ITEM_HELM_VEIL_HEAD: ['wears a head veil', 1.2, 'Veiled'],
  ITEM_HELM_TURBAN: ['wears a turban', 1.2, 'Turban'],
  ITEM_HELM_HOOD: ['wears a hood', 1, 'Little Red', 'Hooded'],
  ITEM_HELM_SCARF_HEAD: ['wears a headscarf', 0.8],
  ITEM_ARMOR_CAPE: ['wears a cape', 1.6, 'No Capes', 'Swoosh', 'Cape'],
  ITEM_ARMOR_CLOAK: ['wears a cloak', 1.2, 'Cloak and Dagger', 'Cloak'],
  ITEM_ARMOR_ROBE: ['wears a robe', 1.2, 'Bathrobe Boss', 'Robes'],
  ITEM_ARMOR_TOGA: ['wears a toga', 1.8, 'Toga Party', 'Toga'],
  ITEM_ARMOR_VEST: ['wears a vest', 1, 'Waistcoat'],
  ITEM_PANTS_LOINCLOTH: ['wears a loincloth', 2, 'Tarzan', 'Loincloth'],
  ITEM_PANTS_THONG: ['wears a thong', 2.4, 'Thong Song', 'Thong'],
  ITEM_PANTS_SKIRT_SHORT: ['wears a short skirt', 1],
  ITEM_SHOES_SANDAL: ['wears sandals', 1.4, 'Socks and Sandals', 'Sandals'],
  ITEM_GLOVES_MITTENS: ['wears mittens', 1.8, 'Bernie', 'Mittens'],
}

const CIVILIAN_ARMOR = new Set([
  'ITEM_ARMOR_BREASTPLATE',
  'ITEM_ARMOR_MAIL_SHIRT',
  'ITEM_HELM_HELM',
  'ITEM_PANTS_GREAVES',
  'ITEM_GLOVES_GAUNTLETS',
])

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

const MOOD_NAMES: Record<string, string[]> = {
  Fey: ['Main Character', 'Workshop Thief', 'Fey-Eyed'],
  Secretive: ['Workshop Thief', 'Hush-Hush'],
  Possessed: ['The Exorcist', 'Possessed'],
  Macabre: ['Edgelord', 'Bonewright', 'Morbid'],
  Fell: ['Serial Killer', 'Fell-Eyed'],
  Melancholy: ['Emo Phase', 'Moper'],
  Raving: ['Unhinged', 'Raving'],
  Berserk: ['Hulk Smash', 'Berserk'],
  Traumatized: ['Thousand-Yard Stare', 'Hollow-Eyed'],
}

// ---------------------------------------------------------------------------
// Helpers

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function fill(text: string, unit: Pick<FortUnit, 'sex'>): string {
  const p = pronouns(unit)
  return text
    .replace(/\{their\}/g, p.their)
    .replace(/\{them\}/g, p.them)
    .replace(/\{self\}/g, p.self)
}

/** "has a temper like a dropped lantern", for a facet far enough from the middle; null otherwise. */
export function facetPhrase(unit: FortUnit, facet: string, value: number): string | null {
  const lex = FACETS[facet]
  if (!lex || (value > 24 && value < 76)) return null
  return fill((value >= 76 ? lex.high : lex.low)[0], unit)
}

/** "cannot abide a lie", for a belief held or rejected strongly enough; null otherwise. */
export function valuePhrase(unit: FortUnit, value: string, strength: number): string | null {
  const lex = VALUES[value]
  if (!lex || Math.abs(strength) < 21) return null
  return fill((strength > 0 ? lex.pos : lex.neg)[0], unit)
}

function entry(unit: FortUnit, key: string, weight: number, [text, ...names]: Entry): Draft {
  return { key, text: fill(text, unit), weight, names }
}

/** "engraving stone" for CARVE_STONE: a skill as it reads in a sentence. */
export function skillLabel(token: string, unit: Pick<FortUnit, 'sex'>): string {
  return fill(SKILL_LABELS[token] ?? humanize(token).toLowerCase(), unit)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "two-grain wheat" -> "Two-Grain Wheat". */
function titleCase(text: string): string {
  return text.replace(
    /(^|[\s-])(\p{L})/gu,
    (_, sep: string, letter: string) => `${sep}${letter.toUpperCase()}`,
  )
}

function lastWords(text: string, n: number): string {
  return text.split(/\s+/).slice(-n).join(' ')
}

const IRREGULAR: Record<string, string> = {
  geese: 'goose',
  mice: 'mouse',
  men: 'man',
  women: 'woman',
  oxen: 'ox',
  wolves: 'wolf',
  elves: 'elf',
  dwarves: 'dwarf',
  axes: 'axe',
  shoes: 'shoe',
  teeth: 'tooth',
  children: 'child',
}

/** "giant cassowaries" -> "giant cassowary", "moth men" -> "moth man". */
function singular(phrase: string): string {
  const words = phrase.trim().split(/\s+/)
  const word = words.at(-1) ?? ''
  const lower = word.toLowerCase()
  words[words.length - 1] = IRREGULAR[lower]
    ? IRREGULAR[lower]
    : /(us|ss|is|ops)$/.test(lower)
      ? word
      : /ies$/.test(lower)
        ? `${word.slice(0, -3)}y`
        : /(ches|shes|xes|sses|zes|uses)$/.test(lower)
          ? word.slice(0, -2)
          : /s$/.test(lower)
            ? word.slice(0, -1)
            : word
  return words.join(' ')
}

/** Mr., Ms. or Mx., by the dwarf's sex. */
function honorific(unit: Pick<FortUnit, 'sex'>): string {
  return unit.sex === 0 ? 'Ms.' : unit.sex === 1 ? 'Mr.' : 'Mx.'
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`
}

function listing(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** ITEM_WEAPON_AXE_BATTLE -> "battle axe". */
function weaponName(subtype: string): string {
  const [base, mod] = subtype
    .replace(/^ITEM_WEAPON_/, '')
    .toLowerCase()
    .split('_')
  if (!mod) return base
  return `${mod === '2h' ? 'two-handed' : mod} ${base}`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface DwarfName {
  /** Their own first name. A nickname hides it from the dump; null when the chronicle does not give it away either. */
  given: string | null
  surname: string
  /** What the surname means in English. */
  meaning: string
}

/** "Pepe Berbûnem", or "`Argues-for-Fun' Berbûnem" once the game shows a nickname in place of the first name. */
function splitName(name: string): { given: string | null; surname: string } {
  const nicknamed = /^`.*' (.+)$/.exec(name.trim())
  if (nicknamed) return { given: null, surname: nicknamed[1] }
  const [given, ...rest] = name.trim().split(/\s+/)
  return { given: given || null, surname: rest.join(' ') }
}

function surnamePattern(surname: string, flags = 'u'): RegExp {
  return new RegExp(`(?:^|[\\s'(])${escapeRegExp(surname)}(?=[\\s,.!:;'?)]|$)`, flags)
}

/**
 * Every citizen's name as the game had it before any nickname. A nicknamed
 * dwarf's first name comes back from announcements made before the nickname,
 * which still say "Pepe Berbûnem".
 */
function dwarfNames(citizens: FortUnit[], events: ChronicleEvent[]): Map<number, DwarfName> {
  const out = new Map<number, DwarfName>()
  for (const unit of citizens) {
    let { given, surname } = splitName(unit.name)
    if (!given && surname) {
      const before = new RegExp(
        `(?:^|[\\s(])(\\p{Lu}\\p{Ll}+) ${escapeRegExp(surname)}(?=[\\s,.!:;?]|$)`,
        'u',
      )
      for (const event of events) {
        const found = before.exec(event.text)?.[1]
        if (found) {
          given = found
          break
        }
      }
    }
    out.set(unit.id, { given, surname, meaning: splitName(unit.name_english).surname })
  }
  return out
}

/** What to call the dwarf in a sentence: their first name, or their surname when that is lost. */
export function callName(name: DwarfName | undefined, unit: FortUnit): string {
  return name?.given || name?.surname || unit.readable
}

// ---------------------------------------------------------------------------
// The fortress as a yardstick

interface Yardstick {
  size: number
  /** Look key -> unit id -> value, for everyone the key applies to. */
  looks: Map<string, Map<number, number>>
  /** Hair layer -> unit id -> length. */
  hair: Map<string, Map<number, number>>
  /** Skill -> unit id of its clear best, when that dwarf is any good. */
  bestAt: Map<string, number>
  oldest: number | null
  youngest: number | null
  happiest: number | null
  unhappiest: number | null
  /** The most wounded, when hurt at all. */
  woundiest: number | null
  /** The most kills, when any. */
  deadliest: number | null
  /** The most friends, and everyone grown with none. */
  popular: number | null
  friendless: Set<number>
  /** The most devout, when worship runs high. */
  devout: number | null
}

function sheetOf(unit: FortUnit): UnitSheet | null {
  return unit.sheet && !unit.sheet.error ? unit.sheet : null
}

/** People this dwarf counts as a friend, by the game's own threshold. */
function friendCount(sheet: UnitSheet): number {
  return sheet.people.filter((p) => p.kind === 'known' && (p.love ?? 0) > 49).length
}

function lookValues(unit: FortUnit): Map<string, number> {
  const out = new Map<string, number>()
  const look = unit.look
  if (!look) return out
  for (const [type, value] of look.body_modifiers ?? []) out.set(`body:${type}`, value)
  const sums = new Map<string, [number, number]>()
  for (const [, cat, type, value] of look.bp_modifiers ?? []) {
    const key = `${cat}:${type}`
    const [sum, n] = sums.get(key) ?? [0, 0]
    sums.set(key, [sum + value, n + 1])
  }
  for (const [key, [sum, n]] of sums) out.set(key, sum / n)
  return out
}

function hairLayers(
  unit: FortUnit,
): Map<string, { length: number; style: string | null; color: string | null }> {
  const out = new Map<string, { length: number; style: string | null; color: string | null }>()
  for (const tissue of unit.look?.tissues ?? []) {
    if (!HAIR_LAYERS[tissue.layer] || tissue.cat !== 'HEAD' || out.has(tissue.layer)) continue
    out.set(tissue.layer, {
      length: tissue.length ?? 0,
      style: tissue.style ?? null,
      color: tissue.color ?? null,
    })
  }
  return out
}

/** The unit that stands alone at the top (or bottom) of `values`. */
function standout(values: Map<number, number>, dir: 1 | -1): number | null {
  let best: [number, number] | null = null
  let second: number | null = null
  for (const [id, raw] of values) {
    const v = raw * dir
    if (!best || v > best[1]) {
      if (best) second = best[1]
      best = [id, v]
    } else if (second === null || v > second) second = v
  }
  if (!best || (second !== null && best[1] === second)) return null
  return best[0]
}

function yardstick(citizens: FortUnit[]): Yardstick {
  const looks = new Map<string, Map<number, number>>()
  const hair = new Map<string, Map<number, number>>()
  const skills = new Map<string, Map<number, number>>()
  for (const unit of citizens) {
    for (const [key, value] of lookValues(unit)) {
      const map = looks.get(key) ?? new Map<number, number>()
      map.set(unit.id, value)
      looks.set(key, map)
    }
    for (const [layer, h] of hairLayers(unit)) {
      if (h.length <= 0) continue
      const map = hair.get(layer) ?? new Map<number, number>()
      map.set(unit.id, h.length)
      hair.set(layer, map)
    }
    for (const [skill, rating] of unit.skills) {
      const map = skills.get(skill) ?? new Map<number, number>()
      map.set(unit.id, rating)
      skills.set(skill, map)
    }
  }
  const bestAt = new Map<string, number>()
  for (const [skill, ratings] of skills) {
    const top = standout(ratings, 1)
    if (top === null) continue
    const sorted = [...ratings.values()].sort((a, b) => b - a)
    if (sorted[0] >= 6 && sorted[0] - (sorted[1] ?? 0) >= 2) bestAt.set(skill, top)
  }
  const adults = citizens.filter((u) => !u.flags.includes('child') && !u.flags.includes('baby'))
  const ages = new Map(adults.map((u) => [u.id, u.age]))
  const stress = new Map(adults.map((u) => [u.id, u.stress]))
  const enough = adults.length >= 5
  const wounds = new Map<number, number>()
  const kills = new Map<number, number>()
  const friends = new Map<number, number>()
  const faith = new Map<number, number>()
  for (const unit of adults) {
    const sheet = sheetOf(unit)
    const hurt = sheet ? sheet.wounds.length : unit.wounds
    if (hurt > 0) wounds.set(unit.id, hurt)
    if (!sheet) continue
    if (sheet.kills) kills.set(unit.id, sheet.kills)
    friends.set(unit.id, friendCount(sheet))
    const devotion = sheet.deities[0]?.[1] ?? 0
    if (devotion >= 75) faith.set(unit.id, devotion)
  }
  const friendless = new Set<number>()
  if (enough && friends.size >= 5) {
    for (const [id, n] of friends) if (n === 0) friendless.add(id)
    if (friendless.size > Math.max(2, friends.size / 6)) friendless.clear()
  }
  return {
    size: citizens.length,
    looks,
    hair,
    bestAt,
    oldest: enough ? standout(ages, 1) : null,
    youngest: enough ? standout(ages, -1) : null,
    happiest: enough ? standout(stress, -1) : null,
    unhappiest: enough ? standout(stress, 1) : null,
    woundiest: enough ? standout(wounds, 1) : null,
    deadliest: enough ? standout(kills, 1) : null,
    popular: enough && friends.size >= 5 ? standout(friends, 1) : null,
    friendless,
    devout: enough ? standout(faith, 1) : null,
  }
}

// ---------------------------------------------------------------------------
// Facts

function workFacts(unit: FortUnit, fort: Yardstick): Draft[] {
  const out: Draft[] = []
  for (const post of unit.positions) {
    out.push({
      key: `position:${post.toLowerCase()}`,
      text: `is the fortress's ${post.toLowerCase()}`,
      weight: 1.3,
      names: POSITION_NAMES.find(([re]) => re.test(post))?.[1] ?? [],
    })
  }
  const rating = new Map(unit.skills)
  for (const [post, needed, lex] of UNQUALIFIED) {
    if (!unit.positions.some((p) => post.test(p))) continue
    if (needed.some((skill) => (rating.get(skill) ?? 0) > 0)) continue
    out.push(entry(unit, `unqualified:${post.source}`, 3, lex))
  }

  const skills = [...unit.skills].sort((a, b) => b[1] - a[1])
  const [best, bestRating] = skills[0] ?? ['', 0]
  const grown = !unit.flags.includes('child') && !unit.flags.includes('baby')
  if (grown && bestRating <= 1) {
    out.push({
      key: 'unskilled',
      text: 'has no skill worth the name',
      weight: 2,
      names: ['Unpaid Intern', 'Spare Hands', 'Apprentice-for-Life'],
    })
  }
  if (best && bestRating >= 3 && ODD_SKILLS[best]) {
    out.push({
      key: `oddskill:${best}`,
      text: `is better at ${skillLabel(best, unit)} than at anything else (${skillRank(bestRating).toLowerCase()})`,
      weight: 2.4,
      names: ODD_SKILLS[best],
    })
  }
  const top3 = skills.slice(0, 3)
  if (top3.length === 3 && bestRating >= 3 && top3.every(([s]) => SOCIAL_SKILLS.has(s))) {
    out.push({
      key: 'alltalk',
      text: `is good at nothing but talk: ${listing(top3.map(([s]) => skillLabel(s, unit)))}`,
      weight: 2.6,
      names: ['Ideas Guy', 'All Talk', 'Chinwag'],
    })
  }
  for (const [skill, r] of skills) {
    if (r < 15) break
    out.push({
      key: `legendary:${skill}`,
      text: `is ${skillRank(r)} at ${skillLabel(skill, unit)}`,
      weight: r >= 20 ? 2 : 1.6,
      names: SKILL_NAMES[skill] ?? [],
    })
  }
  let bests = 0
  for (const [skill, r] of skills) {
    if (bests >= 2) break
    if (r >= 15 || fort.bestAt.get(skill) !== unit.id) continue
    bests++
    out.push({
      key: `bestat:${skill}`,
      text: `is the fortress's best at ${skillLabel(skill, unit)}`,
      weight: SKILL_NAMES[skill] ? 1.2 : 1,
      names: SKILL_NAMES[skill] ?? [],
    })
  }

  if (!unit.squad) {
    for (const item of unit.look?.worn ?? []) {
      if (item.mode !== 'Weapon' || item.type !== 'WEAPON' || !item.subtype) continue
      if (/PICK/.test(item.subtype)) continue
      const weapon = weaponName(item.subtype)
      const names = WEAPON_NAMES[weapon.split(' ').at(-1) ?? ''] ?? []
      out.push({
        key: `weapon:${item.subtype}`,
        text: `carries ${article(weapon)} around the fortress`,
        weight: names.length ? 1.8 : 1.3,
        names,
      })
      break
    }
  } else {
    out.push({ key: 'squad', text: `serves in the ${unit.squad}`, weight: 0.9, names: [] })
  }
  return out
}

function mindFacts(unit: FortUnit, fort: Yardstick): Draft[] {
  const out: Draft[] = []
  for (const [facet, value] of unit.traits ?? []) {
    const lex = FACETS[facet]
    if (!lex || (value > 24 && value < 76)) continue
    const extreme = value <= 9 || value >= 91
    const [text, ...names] = value >= 76 ? lex.high : lex.low
    out.push({
      key: `facet:${facet}:${value >= 76 ? 'high' : 'low'}`,
      text: fill(extreme ? `${text} (off the scale)` : text, unit),
      weight: extreme ? 1.8 : 1.2,
      names,
    })
  }
  for (const [value, strength] of unit.values ?? []) {
    const lex = VALUES[value]
    if (!lex || Math.abs(strength) < 21) continue
    out.push(
      entry(
        unit,
        `value:${value}:${strength > 0 ? 'pos' : 'neg'}`,
        Math.abs(strength) >= 41 ? 1.5 : 1,
        strength > 0 ? lex.pos : lex.neg,
      ),
    )
  }

  const felt = new Map<string, { thought: string; emotion: string; count: number }>()
  for (const [thought, emotion] of unit.thoughts ?? []) {
    const key = `${thought}:${emotion}`
    const seen = felt.get(key)
    if (seen) seen.count++
    else felt.set(key, { thought, emotion, count: 1 })
  }
  for (const { thought, emotion, count } of felt.values()) {
    const lex = THOUGHTS[thought] ?? t(1.2)
    if (lex.weight < 0.3) continue
    const phrase = fill(lex.phrase ?? thoughtPhrase(thought), unit)
    const times = count > 1 ? ` ${count} times` : ''
    const feeling = humanize(emotion).toLowerCase()
    const enjoyed = Boolean(lex.bad && emotion && emotionTone(emotion) === 'good')
    const obvious = !feeling || phrase.includes(feeling.slice(0, 4))
    out.push({
      key: `thought:${thought}:${enjoyed ? 'enjoyed' : emotionTone(emotion)}`,
      text: enjoyed
        ? `${phrase}${times}, and enjoyed it (${feeling})`
        : `${phrase}${times}${obvious ? '' : ` and felt ${feeling}`}`,
      weight: lex.weight + (enjoyed ? 1.2 : 0) + (count > 2 ? 0.3 : 0),
      names: (enjoyed ? lex.enjoyed : undefined) ?? lex.names ?? [],
    })
  }

  if (unit.mood && unit.mood !== 'Baby' && unit.mood !== 'None') {
    out.push({
      key: `mood:${unit.mood}`,
      text: `is in the grip of a ${unit.mood.toLowerCase()} mood`,
      weight: 3,
      names: MOOD_NAMES[unit.mood] ?? [],
    })
  }
  if (unit.flags.includes('insane') || unit.flags.includes('crazed')) {
    out.push({
      key: 'insane',
      text: 'has lost {their} mind',
      weight: 3,
      names: ['Lost the Plot', 'Unhinged', 'Cracked'],
    })
  }
  if (unit.stress_category <= 0) {
    out.push({
      key: 'miserable',
      text: 'is miserable',
      weight: 1.4,
      names: ['Eeyore', 'Stormcloud', 'Sulk'],
    })
  } else if (fort.unhappiest === unit.id) {
    out.push({
      key: 'unhappiest',
      text: 'is the unhappiest dwarf in the fortress',
      weight: 1.2,
      names: ['Big Sad', 'Raincloud'],
    })
  }
  if (fort.happiest === unit.id) {
    out.push({
      key: 'happiest',
      text: 'is the happiest dwarf in the fortress',
      weight: 0.9,
      names: ['Vibe Check', 'Beaming', 'Sunny'],
    })
  }
  return out.map((f) => ({ ...f, text: fill(f.text, unit) }))
}

function bodyFacts(unit: FortUnit, fort: Yardstick): Draft[] {
  const out: Draft[] = []
  const age = Math.floor(unit.age)
  if (unit.flags.includes('baby')) {
    out.push({
      key: 'baby',
      text: 'is a baby',
      weight: 0.8,
      names: ['Baby Yoda', 'Bundle', 'Squall'],
    })
  } else if (unit.flags.includes('child')) {
    out.push({
      key: 'child',
      text: `is a child of ${age}`,
      weight: 0.8,
      names: ['Gremlin', 'Ankle-Biter', 'Tadpole'],
    })
  }
  if (fort.oldest === unit.id) {
    out.push({
      key: 'oldest',
      text: `is the oldest dwarf in the fortress, at ${age}`,
      weight: 1.4,
      names: ['OG', unit.sex === 0 ? 'Granny' : unit.sex === 1 ? 'Gramps' : 'Elder', 'Old Flint'],
    })
  }
  if (fort.youngest === unit.id) {
    out.push({
      key: 'youngest',
      text: `is the youngest grown dwarf in the fortress, at ${age}`,
      weight: 1.1,
      names: ['The Intern', 'Zoomer', 'Fresh Face'],
    })
  }
  if (age >= 150) {
    out.push({
      key: 'ancient',
      text: `is ${age} years old`,
      weight: 1.6,
      names: ['Ancient One', 'Fossil', 'Relic'],
    })
  }

  if (fort.size >= 5) {
    for (const look of LOOKS) {
      const values = fort.looks.get(look.key)
      const mine = values?.get(unit.id)
      if (!values || mine === undefined || values.size < 5) continue
      const mid = median([...values.values()])
      const spread = look.spread ?? 15
      if (look.high && standout(values, 1) === unit.id && mine - mid >= spread)
        out.push(entry(unit, `look:${look.key}:high`, 1.4, look.high))
      if (look.low && standout(values, -1) === unit.id && mid - mine >= spread)
        out.push(entry(unit, `look:${look.key}:low`, 1.4, look.low))
    }
  }

  const hair = hairLayers(unit)
  for (const [layer, h] of hair) {
    const word = HAIR_LAYERS[layer]
    if (h.style === 'CLEAN_SHAVEN') {
      if (layer === 'HAIR') {
        out.push({
          key: 'shaved:HAIR',
          text: `shaves ${pronouns(unit).their} head`,
          weight: 1.1,
          names: ['Cue Ball', 'Mr. Clean', 'Egghead'],
        })
      } else if (layer === 'CHIN_WHISKERS') {
        out.push({
          key: 'shaved:CHIN_WHISKERS',
          text: `keeps ${pronouns(unit).their} chin clean-shaven, which for a dwarf is a statement`,
          weight: 2,
          names: ['Baby Face', 'Beardless Wonder', 'Smoothjaw'],
        })
      }
      continue
    }
    if (h.style && STYLE_WORDS[h.style]) {
      out.push({
        key: `style:${layer}:${h.style}`,
        text: `wears ${pronouns(unit).their} ${word} ${STYLE_WORDS[h.style]}`,
        weight: layer === 'HAIR' ? 0.7 : layer === 'CHIN_WHISKERS' ? 1.2 : 1.6,
        names: STYLE_NAMES[`${layer}:${h.style}`] ?? [],
      })
    } else if (!h.style && h.length >= 100) {
      out.push({
        key: `unkempt:${layer}`,
        text: `lets ${pronouns(unit).their} ${word} grow wild`,
        weight: 1.1,
        names: ['Tangles', 'Nest'],
      })
    }
    const lengths = fort.hair.get(layer)
    if (lengths && lengths.size >= 3 && h.length >= 150 && standout(lengths, 1) === unit.id) {
      const sorted = [...lengths.values()].sort((a, b) => b - a)
      if (sorted[0] - sorted[1] >= 10) {
        out.push({
          key: `longest:${layer}`,
          text: `has the longest ${word} in the fortress`,
          weight: 1.4,
          names: LONGEST_NAMES[layer] ?? [],
        })
      }
    }
  }
  const grown = (layer: string) => {
    const h = hair.get(layer)
    return h?.color && h.length > 0 && h.style !== 'CLEAN_SHAVEN' ? h : null
  }
  const head = grown('HAIR')
  const colorOf = head ?? grown('CHIN_WHISKERS')
  if (colorOf?.color) {
    out.push({
      key: `color:${colorOf.color}`,
      text: `has ${humanize(colorOf.color).toLowerCase()} ${colorOf === head ? 'hair' : 'whiskers'}`,
      weight: 0.6,
      names: [],
    })
  }

  const missing = new Map<string, string[]>()
  for (const [token, cat, gone] of unit.look?.parts ?? []) {
    if (!gone) continue
    missing.set(cat, [...(missing.get(cat) ?? []), token])
  }
  if (missing.has('HEAD') || missing.has('BODY_UPPER')) missing.clear()
  const lostLimb = (re: RegExp) => [...missing.keys()].some((cat) => re.test(cat))
  if (lostLimb(/^ARM_/)) {
    out.push({
      key: 'lost:arm',
      text: 'has lost an arm',
      weight: 3,
      names: ['Tis But a Scratch', 'One-Arm', 'Lefty'],
    })
  } else if (missing.has('HAND')) {
    const right = (missing.get('HAND') ?? []).some((t) => /^R/.test(t))
    out.push({
      key: 'lost:hand',
      text: 'has lost a hand',
      weight: 3,
      names: ['Captain Hook', right ? 'Lefty' : 'Righty', 'One-Hand'],
    })
  } else if (missing.has('FINGER')) {
    const n = missing.get('FINGER')?.length ?? 0
    out.push({
      key: 'lost:finger',
      text: `is missing ${n === 1 ? 'a finger' : `${n} fingers`}`,
      weight: 3,
      names:
        n < 10 ? [`${NUMBER_WORDS[10 - n] ?? 'Few'}fingers`, 'Fingers McGee', 'Stubs'] : ['Stubs'],
    })
  }
  if (lostLimb(/^LEG_/) || missing.has('FOOT')) {
    out.push({
      key: 'lost:leg',
      text: 'has lost a leg',
      weight: 3,
      names: ['Peg Leg', 'Hopalong', 'Peg'],
    })
  } else if (missing.has('TOE')) {
    const n = missing.get('TOE')?.length ?? 0
    out.push({
      key: 'lost:toe',
      text: `is missing ${n === 1 ? 'a toe' : `${n} toes`}`,
      weight: 2.5,
      names: n < 10 ? ['Tiny Toes', `${NUMBER_WORDS[10 - n] ?? 'Few'}toes`] : ['Tiny Toes'],
    })
  }
  if (missing.has('EYE')) {
    const both = (missing.get('EYE')?.length ?? 0) >= 2
    out.push({
      key: 'lost:eye',
      text: both ? 'has lost both eyes' : 'has lost an eye',
      weight: 3,
      names: both ? ['Daredevil', 'Feels-the-Way'] : ['Cyclops', 'Pirate', 'One-Eye'],
    })
  }
  if (missing.has('EAR'))
    out.push({
      key: 'lost:ear',
      text: 'has lost an ear',
      weight: 2.5,
      names: ['Van Gogh', 'One-Ear', 'Lopside'],
    })
  if (missing.has('NOSE'))
    out.push({
      key: 'lost:nose',
      text: 'has lost {their} nose',
      weight: 3,
      names: ['Voldemort', 'Noseless'],
    })
  if (missing.has('TOOTH')) {
    const n = missing.get('TOOTH')?.length ?? 0
    out.push({
      key: 'lost:tooth',
      text: `is missing ${n === 1 ? 'a tooth' : `${n} teeth`}`,
      weight: 2.2,
      names: ['Hockey Player', 'Gums', 'Whistles'],
    })
  }
  if (fort.woundiest === unit.id) {
    out.push({
      key: 'woundiest',
      text: 'carries more wounds than anyone else in the fortress',
      weight: 2,
      names: ['OSHA Supervisor', 'Test Dummy', 'Crash Test Dwarf'],
    })
  }
  if (unit.wounds > 0 && missing.size === 0) {
    out.push({ key: 'wounded', text: 'is nursing a wound', weight: 0.5, names: [] })
  }

  const worn = unit.look?.worn
  if (unit.look && worn && !unit.flags.includes('baby')) {
    const types = new Set(worn.map((item) => item.type))
    if (worn.length === 0) {
      out.push({
        key: 'naked',
        text: 'wears nothing at all',
        weight: 3,
        names: ['Birthday Suit', 'Nudist', 'Starkers'],
      })
    } else {
      if (!types.has('SHOES'))
        out.push({
          key: 'barefoot',
          text: 'goes barefoot',
          weight: 2,
          names: ['Hobbit', 'Barefoot', 'Tenderfoot'],
        })
      if (!types.has('PANTS'))
        out.push({
          key: 'trouserless',
          text: 'wears no trousers',
          weight: 2.2,
          names: ['Winnie the Pooh', 'No Pants', 'Breezy'],
        })
      if (!types.has('ARMOR'))
        out.push({
          key: 'shirtless',
          text: 'wears no shirt',
          weight: 2,
          names: ['Magic Mike', 'Shirtless'],
        })
    }
    const seen = new Set<string>()
    for (const item of worn) {
      const subtype = item.subtype ?? ''
      if (seen.has(subtype)) continue
      seen.add(subtype)
      const garment = GARMENTS[subtype]
      if (garment) {
        const [text, weight, ...names] = garment
        out.push({ key: `garment:${subtype}`, text, weight, names })
      } else if (!unit.squad && CIVILIAN_ARMOR.has(subtype)) {
        const piece = humanize(subtype.replace(/^ITEM_[A-Z]+_/, '')).toLowerCase()
        out.push({
          key: `armor:${subtype}`,
          text: `wears ${article(piece)} to work, though ${pronouns(unit).they} ${pronouns(unit).is} no soldier`,
          weight: 1.4,
          names: ['Cosplayer', 'Tin Can', 'Clank'],
        })
      }
      if (item.flags.includes('IS_CRAFTED_ARTIFACT')) {
        out.push({
          key: `artifact:${subtype}`,
          text: 'wears an artifact',
          weight: 2,
          names: ['Drip Lord', 'Heirloom'],
        })
      }
    }
  }
  return out.map((f) => ({ ...f, text: fill(f.text, unit) }))
}

// ---------------------------------------------------------------------------
// Tastes, dreams and people, from the unit's sheet

/** Organ meats as the game names them, the word to call them by, and names for those who prefer them. */
const ORGANS: Record<string, [word: string, ...names: string[]]> = {
  brain: ['Brain', 'Brain Muncher', 'Zombie Mode'],
  eye: ['Eyeball', 'Eyeball Slurper', 'Eye Candy'],
  gut: ['Guts', 'Gut Gobbler'],
  intestine: ['Guts', 'Gut Gobbler'],
  liver: ['Liver', 'Liver Lover'],
  kidney: ['Kidney', 'Kidney Bean'],
  spleen: ['Spleen', 'Spleen Machine'],
  lung: ['Lung', 'Lung Muncher'],
  heart: ['Heart', 'Heart Eater'],
  stomach: ['Tripe', 'Tripe Hound'],
  pancreatic: ['Pancreas', 'Pancreas Enjoyer'],
  gizzard: ['Gizzard', 'Gizzard Wizard'],
  fat: ['Lard', 'Lard Lord'],
}

const VERMIN =
  /\b(rat|mouse|spider|snail|slug|worm|roach|cockroach|maggot|toad|frog|bat|gnat|fly|leech|mosquito|tick|louse|lizard|beetle|scorpion)\b/i
const PREHISTORIC = /saur|ceratops|raptor|gnathus|dactyl/i
const MONSTROUS = /nightmare|gloom|brute|devil|demon|horror|beast|blob|fiend|spirit|serpent/i
const CUTE =
  /hamster|rabbit|bunny|butterfl|kitten|puppy|\bcats?\b|\bdogs?\b|duck|mussel|oyster|squirrel|hedgehog|sheep|lamb|chick/i
const DRINKS =
  /\b(beer|wine|ale|mead|rum|cider|perry|spirits|brew|cruor|milk|liquor|whiskey|vodka|sake|grog)\b/i
const BOOZE_VERBS: Record<string, string> = {
  B: 'Boozer',
  C: 'Chugger',
  D: 'Drinker',
  G: 'Guzzler',
  P: 'Pounder',
  S: 'Sipper',
  T: 'Tippler',
  W: 'Wino',
  R: 'Rummy',
  M: 'Mixologist',
}

const FOOD_NAMES: [RegExp, string[]][] = [
  [/potato/i, ['Space Potato', 'Couch Potato']],
  [/rat weed/i, ['Weed McGee']],
  [/plump helmet/i, ['Helmet Muncher']],
  [/flour/i, ['Flour Child']],
  [/sugar/i, ['Sugar Rush']],
  [/cheese/i, ['Big Cheese', 'Cheese Louise']],
  [/milk/i, ['Got Milk', 'Milk Mustache']],
  [/sewer brew/i, ['Sewer Rat', 'Sewer Sipper']],
  [/gutter cruor/i, ['Gutter Punk', 'Gutter Guzzler']],
  [/\brum\b/i, ['Captain Morgan']],
  [/\bmead\b/i, ['Mead Hall']],
  [/spirits/i, ['Moonshine']],
  [/cacao|chocolate/i, ['Willy Wonka']],
  [/durian/i, ['Stinky Fruit']],
  [/^fish$/i, ['Fish Breath']],
]

/** Items nobody sensible gets excited about, so liking them is the joke. */
const ODD_ITEMS =
  /hatch cover|millstone|quern|bucket|crutch|splint|traction bench|chain|cage|\bbins?\b|\bbox|\bbags?\b|slab|table|door|\bballs?\b|loincloth|catapult|bolt thrower|ballista|weapon rack|cabinet|backpack|goblet|figurine|pipe|anvil|coffin|barrel|\btoys?\b|\bbeds?\b|chair|floodgate|grate|\bbars?\b|wheel|screw|gear|lever|mug|flask|pot\b/i

const ITEM_NAMES: [RegExp, (unit: FortUnit) => string[]][] = [
  [/crown/i, (u) => [u.sex === 0 ? 'Wannabe Queen' : 'Wannabe King', 'Crown Collector']],
  [/scepter/i, () => ['Scepter Collector']],
  [/crutch/i, () => ['Crutch Enjoyer', 'Crutch Life']],
  [/\bball/i, () => ['Ball Enjoyer', 'Has Balls']],
  [/chain/i, () => ['Chain Enjoyer', 'Kinky']],
  [/cage/i, () => ['Cage Fighter', 'Cage Enjoyer']],
  [/loincloth/i, () => ['Tarzan']],
  [/bucket/i, (u) => [`${honorific(u)} Buckets`, 'Bucket List']],
  [/millstone|quern/i, () => ['Grindset', 'Millstone Enjoyer']],
  [/\bdoor/i, () => ['Door Enjoyer', 'Doorman']],
  [/\bbin/i, () => ['Bin Diver']],
  [/\bbag/i, (u) => [u.sex === 0 ? 'Bag Lady' : 'Bag Man']],
  [/backpack/i, () => ['Backpacker']],
  [/goblet/i, () => ['Goblet of Fire']],
  [/figurine/i, () => ['Action Figure']],
  [/\bring/i, () => ['Lord of the Rings']],
  [/earring|bracelet|amulet|large gem/i, () => ['Bling']],
  [/war hammer/i, () => ['Hammer Time']],
  [/gauntlet/i, () => ['Infinity Gauntlet']],
  [/\bpick/i, () => ['Pick Me']],
  [/cabinet/i, () => ['Cabinet Minister']],
  [/helm/i, () => ['Helmet Head']],
  [/quiver/i, () => ['Quiver Enjoyer']],
  [/box/i, () => ['Boxer', 'Box Enjoyer']],
]

const CREATURE_NAMES: [RegExp, (unit: FortUnit) => string[]][] = [
  [/\bcat\b/i, (u) => [u.sex === 0 ? 'Cat Lady' : 'Cat Dad']],
  [/\bdog\b/i, (u) => [u.sex === 0 ? 'Dog Mom' : 'Dog Dad']],
  [/horse/i, (u) => [u.sex === 0 ? 'Horse Girl' : 'Horse Guy']],
  [/\bgoat/i, () => ['GOAT']],
  [/llama/i, () => ['Llama Drama']],
  [/chicken/i, () => ['Chicken Little']],
  [/goose/i, () => ['Untitled Goose']],
  [/cassowary/i, () => ['Murder Bird Fan']],
  [/nightmare/i, () => ['Nightmare Fuel']],
  [/honey badger/i, () => ["Honey Badger Don't Care"]],
  [/moth man/i, () => ['Mothman Truther']],
  [/spider/i, () => ['Spider Hugger', 'Arachnophile']],
]

const HATE_NAMES: [RegExp, string[]][] = [
  [/\bfl(y|ies)\b/i, ['Fly Swatter', 'Lord of the Flies']],
  [/\bbat/i, ['Batman']],
  [/snake|serpent/i, ['Indiana Jones']],
  [/spider/i, ['Arachnophobe']],
  [/mussel/i, ['No Mussels']],
  [/snail/i, ['Escargot']],
  [/lizard/i, ['Lizard People Truther']],
  [/\belf|elves/i, ['Elf Fister']],
  [/mosquito|gnat/i, ['Bug Zapper']],
]

const SHAPE_NAMES: [RegExp, string[]][] = [
  [/icosahedr/i, ['D20', 'Nat Twenty']],
  [/dodecahedr/i, ['D12']],
  [/octahedr/i, ['D8']],
  [/tetrahedr/i, ['D4']],
  [/gizzard stone/i, ['Gizzard Wizard']],
  [/cloud/i, ['Head in the Clouds']],
  [/\bstar/i, ['Starchild']],
  [/\bmoon/i, ['Moon Child']],
  [/crescent/i, ['Croissant']],
  [/diamond/i, ['Diamond Hands']],
]

const DREAM_NAMES: Record<
  string,
  { what: string; open: string[]; done?: string[]; weight?: number }
> = {
  START_A_FAMILY: {
    what: 'raising a family',
    open: ['Baby Fever', 'Wants Kids'],
    done: ['Proud Parent'],
  },
  CREATE_A_GREAT_WORK_OF_ART: {
    what: 'creating a great work of art',
    open: ['Starving Artist'],
    done: ['Art Star'],
  },
  CRAFT_A_MASTERWORK: {
    what: 'crafting a masterwork',
    open: ['Masterwork Pending'],
    done: ['Peaked'],
  },
  MASTER_A_SKILL: { what: 'mastering a skill', open: ['Level Grinder'], done: ['Max Level'] },
  MAKE_A_GREAT_DISCOVERY: {
    what: 'making a great discovery',
    open: ['Eureka Pending'],
    done: ['Eureka'],
  },
  RULE_THE_WORLD: {
    what: 'ruling the world',
    open: ['World Domination', 'Pinky and the Brain'],
    weight: 2.2,
  },
  BRING_PEACE_TO_THE_WORLD: {
    what: 'bringing peace to the world',
    open: ['Miss Universe', 'World Peace'],
    weight: 1.8,
  },
  BECOME_A_LEGENDARY_WARRIOR: {
    what: 'becoming a legendary warrior',
    open: ['Wannabe Hero', 'Main Character'],
    weight: 1.6,
  },
  FALL_IN_LOVE: {
    what: 'falling in love',
    open: ['Hopeless Romantic', 'Down Bad'],
    done: ['Lovebird'],
  },
  SEE_THE_GREAT_NATURAL_SITES: {
    what: 'seeing the great natural sites',
    open: ['Tourist', 'Wanderlust'],
    weight: 1.4,
  },
  IMMORTALITY: { what: 'living forever', open: ['Forever Young', 'Vampire Wannabe'], weight: 2.2 },
  ATTAINING_RANK_IN_SOCIETY: {
    what: 'rising in society',
    open: ['Social Climber'],
    weight: 1.4,
  },
  BATHE_WORLD_IN_CHAOS: {
    what: 'bathing the world in chaos',
    open: ['Agent of Chaos', 'Joker'],
    weight: 2.6,
  },
}

/** "giant brown recluse spiders" -> "Recluse Spider", "rhesus macaque men" -> "Macaque Man". */
function creatureWord(plural: string): string {
  const people = / men$/i.test(plural)
  if (PREHISTORIC.test(plural)) return people ? 'Dino Man' : 'Dino'
  const one = titleCase(singular(plural.replace(/^(giant|gigantic|large|common) /i, '')))
  return people ? `${one.split(' ').at(-2) ?? ''} Man`.trim() : lastWords(one, 2)
}

function tasteFacts(unit: FortUnit, sheet: UnitSheet): Draft[] {
  const out: Draft[] = []
  const mr = honorific(unit)
  for (const [kind, what] of sheet.preferences) {
    const key = `pref:${kind}:${what.toLowerCase()}`
    if (kind === 'LikeFood') {
      const special = FOOD_NAMES.find(([re]) => re.test(what))?.[1] ?? []
      if (/\(meat\)/.test(what)) {
        const words = what
          .replace(/\(meat\)/, '')
          .replace(/\btissue\b/, '')
          .trim()
          .split(/\s+/)
        const organ = (words.at(-1) ?? '').toLowerCase()
        const creature = lastWords(titleCase(words.slice(0, -1).join(' ')), 2)
        const lex = ORGANS[organ]
        const dino = PREHISTORIC.test(what)
        const meat = dino ? 'Dino' : creature
        out.push({
          key,
          text: `prefers to eat ${what.replace(/ \(meat\)/, '')}`,
          weight: lex ? 2 : dino ? 2 : VERMIN.test(what) ? 1.8 : 0.9,
          names: [
            ...(dino ? ['Dino Nuggie'] : []),
            ...(lex
              ? [...lex.slice(1), `${meat} ${lex[0]}`]
              : [`${meat} Steak`, `${meat} Muncher`]),
          ],
        })
        continue
      }
      const drink = DRINKS.exec(what)?.[1]
      if (drink) {
        const base = titleCase(what.replace(DRINKS, '').trim())
        const verb = BOOZE_VERBS[base.charAt(0)] ?? 'Chugger'
        const odd = /sewer|gutter|blood|slime/i.test(what)
        out.push({
          key,
          text: `prefers to drink ${what}`,
          weight: odd ? 2 : /milk/i.test(drink) ? 1.3 : 1,
          names: [
            ...special,
            ...(base ? [`${base} ${verb}`] : []),
            ...(/wine/i.test(drink) && base
              ? [`${lastWords(base, 1)} Wine ${unit.sex === 0 ? 'Mom' : 'Dad'}`]
              : []),
          ],
        })
        continue
      }
      const base = titleCase(what.replace(/\b(plant|seed|fruit|leaf|oil)\b/gi, '').trim())
      out.push({
        key,
        text: `prefers to eat ${what}`,
        weight: special.length ? 1.6 : 0.9,
        names: [
          ...special,
          ...(base && !/\s/.test(base) ? [`${base} McGee`] : []),
          ...(base ? [`${lastWords(base, 2)} Muncher`] : []),
        ],
      })
    } else if (kind === 'LikeItem') {
      const machine = what.replace(/ parts$/i, '')
      const one = titleCase(singular(machine))
      const special = ITEM_NAMES.find(([re]) => re.test(what))?.[1](unit) ?? []
      const odd = ODD_ITEMS.test(what)
      out.push({
        key,
        text: odd ? `likes ${what}, of all things` : `likes ${what}`,
        weight: odd ? 1.7 : 1,
        names: [...special, `${one} Enjoyer`, `${mr} ${titleCase(machine)}`],
      })
    } else if (kind === 'LikeCreature') {
      const word = creatureWord(what)
      const dino = PREHISTORIC.test(what)
      const special = CREATURE_NAMES.find(([re]) => re.test(singular(what)))?.[1](unit) ?? []
      const odd = dino || VERMIN.test(what) || MONSTROUS.test(what) || / men$/i.test(what)
      out.push({
        key,
        text: `likes ${what}`,
        weight: odd ? 1.5 : special.length ? 1.3 : 0.8,
        names: [
          ...(dino ? ['Jurassic Park'] : []),
          ...special,
          `${word} Hugger`,
          `${word} Fancier`,
        ],
      })
    } else if (kind === 'HateCreature') {
      const word = creatureWord(what)
      const special = HATE_NAMES.find(([re]) => re.test(what))?.[1] ?? []
      out.push({
        key,
        text: `absolutely detests ${what}`,
        weight: CUTE.test(what) ? 1.6 : special.length ? 1.4 : 1,
        names: [...special, `${word} Puncher`, `${word} Stomper`],
      })
    } else if (kind === 'LikeShape') {
      const special = SHAPE_NAMES.find(([re]) => re.test(what))?.[1] ?? []
      out.push({
        key,
        text: `is fond of the shape of ${what}`,
        weight: special.length ? 1.5 : 0.6,
        names: special,
      })
    } else if (kind === 'LikeColor') {
      out.push({
        key,
        text: `has a soft spot for the colour ${what}`,
        weight: 0.6,
        names: [`${mr} ${titleCase(what)}`],
      })
    } else if (kind === 'LikePlant' || kind === 'LikeTree') {
      const word = lastWords(titleCase(singular(what.replace(/ (plants|trees)$/i, ''))), 2)
      out.push({ key, text: `likes ${what}`, weight: 0.8, names: [`${word} Whisperer`] })
    }
  }
  for (const [goal, realised] of sheet.dreams) {
    const lex = DREAM_NAMES[goal]
    if (!lex) continue
    out.push({
      key: `dream:${goal}:${realised ? 'done' : 'open'}`,
      text: realised
        ? `has realised ${pronouns(unit).their} dream of ${lex.what}`
        : `dreams of ${lex.what}`,
      weight: lex.weight ?? 0.9,
      names: realised ? (lex.done ?? []) : lex.open,
    })
  }
  return out
}

function lifeFacts(unit: FortUnit, sheet: UnitSheet, fort: Yardstick): Draft[] {
  const out: Draft[] = []
  const p = pronouns(unit)
  const kills = sheet.kills ?? 0
  if (fort.deadliest === unit.id) {
    out.push({
      key: 'deadliest',
      text: `has more kills than anyone else in the fortress (${kills})`,
      weight: 2,
      names: ['Body Count', 'John Wick'],
    })
  }
  if (kills > 0 && !unit.squad) {
    out.push({
      key: 'civilian-kills',
      text: `has ${kills === 1 ? 'a kill' : `${kills} kills`} to ${p.their} name, though ${p.they} ${p.is} no soldier`,
      weight: 2.2,
      names: ['Murder Hobo', 'Accidental Hero'],
    })
  }
  if (fort.popular === unit.id) {
    out.push({
      key: 'popular',
      text: 'has more friends than anyone else in the fortress',
      weight: 1.4,
      names: [`${honorific(unit)} Popular`, 'Influencer'],
    })
  }
  if (fort.friendless.has(unit.id)) {
    out.push({
      key: 'friendless',
      text: 'has not made a single friend in the fortress',
      weight: 1.8,
      names: ['Forever Alone', 'Lone Wolf'],
    })
  }
  if (fort.devout === unit.id && sheet.deities[0]) {
    out.push({
      key: 'devout',
      text: `is the most devout dwarf in the fortress, devoted to ${sheet.deities[0][0]}`,
      weight: 1.3,
      names: ['Holy Roller', unit.sex === 0 ? 'Church Lady' : 'Choir Boy'],
    })
  }
  return out
}

/** A person from a sheet as the fortress knows them: their nickname if any, otherwise their first name. */
function personName(
  person: SheetPerson,
  units: Map<number, FortUnit>,
): {
  nick: string | null
  called: string
} {
  const unit = person.unit !== null ? units.get(person.unit) : undefined
  const nick = unit?.nickname?.trim() || /^`([^`']+)'/.exec(person.name ?? '')?.[1] || null
  const called = nick ?? (person.name ?? '').split(/\s+/)[0] ?? 'someone'
  return { nick, called }
}

function kinFacts(unit: FortUnit, sheet: UnitSheet, units: Map<number, FortUnit>): Draft[] {
  const out: Draft[] = []
  const young = unit.flags.includes('baby') || unit.flags.includes('child')
  const childWord = unit.sex === 0 ? 'daughter' : unit.sex === 1 ? 'son' : 'child'
  let children = 0
  for (const person of sheet.people) {
    const kind = person.kind.toUpperCase()
    if (kind === 'CHILD') children++
    const { nick, called } = personName(person, units)
    if ((kind === 'MOTHER' || kind === 'FATHER') && nick) {
      const core = nicknameCore(nick)
      const late = person.alive ? '' : 'the late '
      out.push({
        key: `kin:junior:${person.hf}`,
        text: `is the ${childWord} of ${late}${nick}`,
        weight: 2.4,
        names: [`${nick} Jr.`, young ? `Baby ${core}` : `Lil ${core}`, `${core} the Younger`],
        why: `${capitalize(childWord)} of ${late}${nick}. The name runs in the family.`,
      })
    } else if ((kind === 'SPOUSE' || kind === 'LOVER') && nick) {
      const core = nicknameCore(nick)
      const married = kind === 'SPOUSE'
      out.push({
        key: `kin:${married ? 'spouse' : 'lover'}:${person.hf}`,
        text: married ? `is married to ${nick}` : `is ${nick}'s lover`,
        weight: married ? 1.5 : 1.4,
        names: married
          ? [
              `${unit.sex === 0 ? 'Mrs.' : unit.sex === 1 ? 'Mr.' : 'Mx.'} ${core}`,
              `${core}'s Plus-One`,
            ]
          : [`${core}'s Boo`, `${core}'s Plus-One`],
      })
    }
    const rank = person.rank ?? ''
    if (/grudge|rival/.test(rank)) {
      const core = nick ? nicknameCore(nick) : called
      out.push({
        key: `kin:grudge:${person.hf}`,
        text: `holds a grudge against ${nick ?? called}`,
        weight: 1.8,
        names: [`${core}'s Nemesis`, `${core} Hater`],
      })
    } else if (/jealous_obsession/.test(rank)) {
      const core = nick ? nicknameCore(nick) : called
      out.push({
        key: `kin:obsession:${person.hf}`,
        text: `is jealously obsessed with ${nick ?? called}`,
        weight: 2,
        names: [`${core}'s Stalker`, `${core} Superfan`],
      })
    }
  }
  if (children >= 3) {
    out.push({
      key: 'kin:brood',
      text: `has ${children} children`,
      weight: 1.2 + Math.min(children - 3, 4) * 0.2,
      names:
        unit.sex === 0
          ? ['Mother of Dwarves', 'Brood Mother']
          : unit.sex === 1
            ? ['Father of Dwarves', 'Big Daddy']
            : ['Parent of Dwarves'],
    })
  }
  return out
}

/** A nicknamed citizen who is gone: dead, missing or a ghost. */
export interface Departed {
  nickname: string
  profession: string
  /** "starved to death", "went missing". */
  fate: string
}

const DEPARTED_EVENT = /^`([^`']+)' \S+, (?:Ghostly )?([^,]+?) has (.+?)[.!]*$/u

function fateOf(rest: string): string {
  const found = /^been found, (.+)$/.exec(rest)?.[1]
  if (found) return found === 'dead' ? 'was found dead' : found
  if (/^been missing/.test(rest)) return 'went missing'
  if (/^gone /.test(rest)) return rest.replace(/^gone /, 'went ')
  return 'died'
}

/** Nicknamed citizens who left the fortress for good, from the dump and the chronicle. */
export function departedCitizens(
  everyone: FortUnit[],
  living: FortUnit[],
  events: ChronicleEvent[],
): Departed[] {
  const alive = new Set(living.map((u) => u.nickname?.trim().toLowerCase()).filter(Boolean))
  const out = new Map<string, Departed>()
  const ghosts = new Set<string>()
  for (const unit of everyone) {
    const nickname = unit.nickname?.trim()
    if (!nickname || !unit.flags.includes('citizen')) continue
    if (!unit.flags.includes('dead') && !unit.flags.includes('ghost')) continue
    if (unit.flags.includes('ghost')) ghosts.add(nickname.toLowerCase())
    out.set(nickname.toLowerCase(), {
      nickname,
      profession: unit.profession.replace(/^Ghostly /, ''),
      fate: 'died',
    })
  }
  for (const event of events) {
    const type = event.type ?? ''
    if (type !== 'CITIZEN_DEATH' && type !== 'CITIZEN_MISSING') continue
    const m = DEPARTED_EVENT.exec(event.text.trim())
    if (!m) continue
    const [, nickname, profession, rest] = m
    const key = nickname.toLowerCase()
    if (alive.has(key)) continue
    const known = out.get(key)
    if (type === 'CITIZEN_MISSING' && known) continue
    if (known && known.fate !== 'died') continue
    out.set(key, { nickname, profession, fate: fateOf(rest) })
  }
  for (const key of ghosts) {
    const d = out.get(key)
    if (d) d.fate = `${d.fate} and now haunts the fortress`
  }
  return [...out.values()]
}

function legacyFacts(unit: FortUnit, departed: Departed[]): Draft[] {
  const trade = unit.profession.toLowerCase()
  const p = pronouns(unit)
  return departed
    .filter((d) => d.profession.toLowerCase() === trade)
    .map((d) => {
      const core = nicknameCore(d.nickname)
      return {
        key: `legacy:${d.nickname.toLowerCase()}`,
        text: `is the fortress's ${trade} now that ${d.nickname} ${d.fate}`,
        weight: 2.6,
        names: [`${d.nickname} II`, `${core} 2 Unleashed`, `${core} Reborn`],
        why: `${d.nickname}, a ${trade} before ${p.them}, ${d.fate}. Time for the sequel.`,
      }
    })
}

const DULL_EVENTS =
  /^(CANCEL_JOB|MASTERPIECE_CRAFTED|PROFESSION_CHANGES|QUOTA_FILLED|STRUCK_|SEASON_|WEATHER_|CONSTRUCTION_SUSPENDED|DIG_CANCEL|NOTHING_TO_CATCH|D_MIGRANTS_ARRIVAL|LIAISON_ARRIVAL|CARAVAN|MERCHANT)/

const EVENT_NAMES: [RegExp, string[]][] = [
  [/VERMIN_BITE/, ['Chew Toy', 'Ratbitten', 'Chewed']],
  [/STRANGE_MOOD|MOOD_BUILDING_CLAIMED/, ['Workshop Thief', 'Main Character', 'Fey-Eyed']],
  [/ARTIFACT/, ['One-Hit Wonder', 'Heirloom']],
  [/MARRIAGE/, ['Just Married', 'Newlywed']],
  [/ELECTION/, ['Four More Years', 'Elected Official']],
  [/BIRTH_CITIZEN/, ['Baby Factory', 'New Parent']],
  [/CITIZEN_STUCK/, ['Lost Again', 'Wrong Turn']],
  [/GHOST/, ['Ghostbuster']],
]

/** Announcement text with decorations dropped and this dwarf's nickname put back to their name. */
function cleanText(text: string, name: DwarfName): string {
  const renamed = name.surname
    ? text.replace(
        new RegExp(`\`[^\`']*' (?=${escapeRegExp(name.surname)})`, 'g'),
        name.given ? `${name.given} ` : '',
      )
    : text
  return renamed
    .replace(/[☼≡«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Facts from the fortress's own announcements that name this dwarf, newest first. */
function eventFacts(name: DwarfName, events: ChronicleEvent[]): Draft[] {
  const out: Draft[] = []
  const masterpieces: string[] = []
  const trades: string[] = []
  const cancels = new Map<string, number>()
  const others = new Map<string, string>()
  for (const event of events) {
    const type = event.type ?? ''
    const text = cleanText(event.text, name)
    if (type === 'MASTERPIECE_CRAFTED') {
      const item = /masterpiece (.+?)!?$/i.exec(text)?.[1]
      if (item) masterpieces.push(item)
    } else if (type === 'PROFESSION_CHANGES') {
      const trade = /has become an? (.+?)\.?$/i.exec(text)?.[1]
      if (trade) trades.unshift(trade)
    } else if (type === 'CANCEL_JOB') {
      const reason = text.split(': ').at(-1)?.replace(/\.$/, '') ?? ''
      if (!reason || /^needs\b|item blocking|construction suspended/i.test(reason)) continue
      cancels.set(reason, (cancels.get(reason) ?? 0) + 1)
    } else if (type && !DULL_EVENTS.test(type) && !others.has(type)) {
      others.set(type, text)
    }
  }
  if (masterpieces.length) {
    const nouns = masterpieces.map((item) => item.split(/\s+/).at(-1)?.toLowerCase() ?? item)
    const counts = new Map<string, number>()
    for (const noun of nouns) counts.set(noun, (counts.get(noun) ?? 0) + 1)
    const [favourite, times] = [...counts].sort((a, b) => b[1] - a[1])[0]
    const distinct = [...new Set(masterpieces)].slice(0, 4)
    out.push({
      key: 'event:masterpiece',
      text:
        masterpieces.length === 1
          ? `made a masterpiece ${distinct[0]}`
          : `has made ${masterpieces.length} masterpieces, among them ${listing(distinct.map((i) => article(i)))}`,
      weight: 1.6 + (times >= 2 ? 0.6 : 0),
      names: [
        ...(favourite === 'coffin' ? ['Undertaker'] : []),
        ...(times >= 2 ? [`${capitalize(favourite)} Enjoyer`] : []),
        `${capitalize(favourite)}wright`,
      ],
    })
  }
  if (trades.length >= 2) {
    out.push({
      key: 'event:jobs',
      text: `has changed trade ${trades.length} times: ${trades.join(', then ')}`,
      weight: 1.2 + 0.3 * Math.min(trades.length, 4),
      names: ['Gig Economy', 'Jobhopper', 'Next-Trade'],
    })
  }
  for (const [reason, count] of [...cancels].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const creature = /interrupted by (.+)/i.exec(reason)?.[1]
    const beast = creature ? titleCase(singular(creature.replace(/^(an?|the) /i, ''))) : ''
    out.push({
      key: `cancel:${reason.toLowerCase()}`,
      text: `gave up ${count === 1 ? 'a job' : `${count} jobs`} with the excuse "${reason}"`,
      weight: 1.2 + Math.min(count, 5) * 0.2,
      names: creature
        ? [`Scared of ${lastWords(beast, 2)}`, `${lastWords(beast, 1)}-Shy`]
        : /dangerous terrain/i.test(reason)
          ? ['Floor Is Lava', 'Tiptoe']
          : count >= 3
            ? ['Flake', 'Union Rep']
            : [],
    })
  }
  for (const [type, text] of [...others].slice(0, 4)) {
    out.push({
      key: `event:${type}`,
      text: `is in the chronicle: "${text}"`,
      weight: 2.2,
      names: EVENT_NAMES.find(([re]) => re.test(type))?.[1] ?? [],
      why: `The chronicle: "${text}"`,
    })
  }
  return out
}

/** Announcements naming this dwarf under any nickname, or none, by their surname. */
function eventsNaming(unit: FortUnit, name: DwarfName, events: ChronicleEvent[]): ChronicleEvent[] {
  if (!name.surname) {
    const needles = mentionNeedles(unit.name).map((n) => n.toLowerCase())
    return events.filter((event) => needles.some((n) => event.text.toLowerCase().includes(n)))
  }
  const pattern = surnamePattern(name.surname, 'iu')
  return events.filter((event) => pattern.test(event.text))
}

export interface Dossiers {
  /** Each citizen's facts, strongest first. */
  facts: Map<number, DwarfFact[]>
  names: Map<number, DwarfName>
}

/**
 * Every citizen's facts and name. `events` are the fortress's announcements;
 * without them the dossiers keep to the dump. `everyone` is every unit in the
 * dump, for parents, partners and the dead the citizens are named after.
 */
export function buildDossiers(
  citizens: FortUnit[],
  events: ChronicleEvent[] = [],
  everyone: FortUnit[] = citizens,
): Dossiers {
  const fort = yardstick(citizens)
  const names = dwarfNames(citizens, events)
  const units = new Map(everyone.map((u) => [u.id, u]))
  const departed = departedCitizens(everyone, citizens, events)
  const drafts = new Map<number, Draft[]>()
  const shared = new Map<string, number>()
  for (const unit of citizens) {
    const name = names.get(unit.id) ?? { given: null, surname: '', meaning: '' }
    const sheet = sheetOf(unit)
    const facts = [
      ...workFacts(unit, fort),
      ...mindFacts(unit, fort),
      ...bodyFacts(unit, fort),
      ...(sheet
        ? [
            ...tasteFacts(unit, sheet),
            ...lifeFacts(unit, sheet, fort),
            ...kinFacts(unit, sheet, units),
          ]
        : []),
      ...legacyFacts(unit, departed),
      ...eventFacts(name, eventsNaming(unit, name, events)),
    ]
    const unique = [...new Map(facts.map((f) => [f.key, f])).values()]
    drafts.set(unit.id, unique)
    for (const fact of unique) shared.set(fact.key, (shared.get(fact.key) ?? 0) + 1)
  }
  const n = Math.max(1, citizens.length)
  const facts = new Map<number, DwarfFact[]>()
  for (const [id, list] of drafts) {
    facts.set(
      id,
      list
        .map((fact) => {
          const count = shared.get(fact.key) ?? 1
          const rarity = Math.log2(1 + n / count) / Math.log2(1 + n)
          return { ...fact, shared: count, score: fact.weight * rarity }
        })
        .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)),
    )
  }
  return { facts, names }
}

// ---------------------------------------------------------------------------
// Nicknames without a model

interface Candidate extends NicknameIdea {
  score: number
  factKey: string
  shape: NameShape
}

/**
 * The comic form a name takes. A roster reads funnier when the forms are
 * mixed, so no form gets to name the whole fortress.
 */
export type NameShape = 'sequel' | 'title' | 'fan' | 'doer' | 'mc' | 'word' | 'phrase'

const DOERS =
  /(er|or|ist|Muncher|Puncher|Gobbler|Slurper|Stomper|Swatter|Guzzler|Sipper|Chugger|Boozer|Hound|Lover|Eater)$/

export function nameShape(nickname: string): NameShape {
  const words = nickname.trim().split(/\s+/)
  if (/\b(Jr\.|II|2|Reborn|the Younger|Lil|Baby)(?!\w)/.test(nickname)) return 'sequel'
  if (
    /^(Dr\.|Mr\.|Ms\.|Mrs\.|Mx\.|Sir|Dame|Captain|Saint|Mayor|Professor|Count)\s|, PhD$/.test(
      nickname,
    )
  )
    return 'title'
  if (/\bMc[A-Z]/.test(nickname)) return 'mc'
  if (
    words.length >= 2 &&
    /(Enjoyer|Fan|Fancier|Hugger|Hater|Truther|Superfan|Whisperer)$/.test(nickname)
  )
    return 'fan'
  if (words.length >= 2 && DOERS.test(words.at(-1) ?? '')) return 'doer'
  return words.length === 1 ? 'word' : 'phrase'
}

/** What sort of fact a key is, so no one sort names the whole fortress: "pref:LikeFood", "facet", "kin". */
function factFamily(key: string): string {
  const parts = key.split(':')
  return parts[0] === 'pref' ? `${parts[0]}:${parts[1]}` : parts[0]
}

function candidates(unit: FortUnit, facts: DwarfFact[], name: DwarfName | undefined): Candidate[] {
  const called = callName(name, unit)
  const current = unit.nickname?.trim()
  const seen = new Set(
    [name?.given, current, current ? nicknameCore(current) : null]
      .filter((n): n is string => Boolean(n))
      .map((n) => n.toLowerCase()),
  )
  const out: Candidate[] = []
  for (const fact of facts) {
    if (!fact.names.length) continue
    const offset = stableHash(`${unit.id}:${fact.key}`) % fact.names.length
    const rotated = [...fact.names.slice(offset), ...fact.names.slice(0, offset)]
    rotated.forEach((nickname, i) => {
      const key = nickname.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push({
        nickname,
        why: fact.why ?? `${called} ${fact.text}.`,
        source: 'facts',
        score: fact.score * (i === 0 ? 1 : 0.7),
        factKey: fact.key,
        shape: nameShape(nickname),
      })
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Up to `perDwarf` ideas for each citizen, each on a different fact. No two
 * dwarves get the same first idea, nor one another citizen already goes by.
 * First ideas spread across the name shapes: once a shape has named its share
 * of the fortress, the next dwarf has to be a lot funnier in it to get it.
 */
export function factIdeas(
  citizens: FortUnit[],
  dossiers: Dossiers,
  perDwarf = 5,
): Map<number, NicknameIdea[]> {
  const pools = new Map(
    citizens.map((u) => [
      u.id,
      candidates(u, dossiers.facts.get(u.id) ?? [], dossiers.names.get(u.id)),
    ]),
  )
  const nicknamed = new Map<string, number>()
  for (const u of citizens) {
    const nick = u.nickname?.trim()
    if (!nick) continue
    nicknamed.set(nick.toLowerCase(), u.id)
    nicknamed.set(nicknameCore(nick).toLowerCase(), u.id)
  }
  const firsts = new Map<string, number>()
  const order = [...citizens].sort(
    (a, b) =>
      (pools.get(b.id)?.[0]?.score ?? 0) - (pools.get(a.id)?.[0]?.score ?? 0) || a.id - b.id,
  )
  const share = Math.max(2, Math.ceil(citizens.length / 7))
  const familyShare = Math.max(2, Math.ceil(citizens.length / 10))
  const used = new Map<string, number>()
  const handicap = (c: Candidate) => {
    const shapes = used.get(c.shape) ?? 0
    const families = used.get(factFamily(c.factKey)) ?? 0
    const quota = c.shape === 'word' || c.shape === 'phrase' ? share * 2 : share
    return 0.7 ** Math.floor(shapes / quota) * 0.7 ** Math.floor(families / familyShare)
  }
  const free = (c: Candidate, unitId: number) => {
    const key = c.nickname.toLowerCase()
    const owner = nicknamed.get(key) ?? firsts.get(key)
    return owner === undefined || owner === unitId
  }
  const firstOf = new Map<number, Candidate>()
  for (const unit of order) {
    let pick: Candidate | null = null
    let best = -1
    for (const c of pools.get(unit.id) ?? []) {
      if (!free(c, unit.id)) continue
      const score = c.score * handicap(c)
      if (score > best) {
        best = score
        pick = c
      }
    }
    if (!pick) continue
    firsts.set(pick.nickname.toLowerCase(), unit.id)
    firstOf.set(unit.id, pick)
    for (const key of [pick.shape, factFamily(pick.factKey)])
      used.set(key, (used.get(key) ?? 0) + 1)
  }
  const out = new Map<number, NicknameIdea[]>()
  for (const unit of citizens) {
    const first = firstOf.get(unit.id)
    const ideas: Candidate[] = first ? [first] : []
    const facts = new Set(ideas.map((c) => c.factKey))
    const names = new Set(ideas.map((c) => c.nickname.toLowerCase()))
    const shapes = new Set(ideas.map((c) => c.shape))
    const families = new Set(ideas.map((c) => factFamily(c.factKey)))
    const rest = (pools.get(unit.id) ?? [])
      .filter((c) => free(c, unit.id))
      .map((c) => ({
        c,
        score:
          c.score *
          (shapes.has(c.shape) ? 0.75 : 1) *
          (families.has(factFamily(c.factKey)) ? 0.75 : 1),
      }))
      .sort((a, b) => b.score - a.score)
    for (const { c } of rest) {
      if (ideas.length >= perDwarf) break
      const key = c.nickname.toLowerCase()
      if (facts.has(c.factKey) || names.has(key)) continue
      facts.add(c.factKey)
      names.add(key)
      ideas.push(c)
    }
    out.set(
      unit.id,
      ideas.map(({ nickname, why, source }) => ({ nickname, why, source })),
    )
  }
  return out
}
