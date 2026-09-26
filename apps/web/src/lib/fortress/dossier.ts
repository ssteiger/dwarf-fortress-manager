import type { FortUnit } from '@fortress/db-drizzle/fortress-types'

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
  source: 'facts' | 'model'
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
    high: ['falls in love at the drop of a helmet', 'Swoons', 'Moon-Eyes'],
    low: ['has never quite managed to love anyone', 'Cold Hearth', 'Unsmitten'],
  },
  HATE_PROPENSITY: {
    high: ['nurses hatreds like pets', 'Grudgekeeper', 'Keeps-a-List'],
    low: ['cannot manage to hate anybody', 'Hates-Nobody', 'Soft Anvil'],
  },
  ENVY_PROPENSITY: {
    high: ['wants whatever anyone else has', 'Wants-Yours', 'Greeneye'],
    low: ['has never envied anybody anything', 'Got-Enough'],
  },
  CHEER_PROPENSITY: {
    high: ['stays cheerful no matter what', 'Sunbeam', 'Chirps'],
    low: ['is almost never cheerful', 'Grimface', 'Rainface'],
  },
  DEPRESSION_PROPENSITY: {
    high: ['sinks into gloom at the slightest excuse', 'Gloom', 'Sighs'],
    low: ['cannot be brought down by anything', 'Cork', 'Unsinkable'],
  },
  ANGER_PROPENSITY: {
    high: ['has a temper like a dropped lantern', 'Short Fuse', 'Kettle'],
    low: ['never loses {their} temper', 'Cool Mug', 'Unboiled'],
  },
  ANXIETY_PROPENSITY: {
    high: ['is a bundle of nerves', 'Jitters', 'Flinch'],
    low: ['is never anxious about anything', 'Shrugs', 'Unbothered'],
  },
  LUST_PROPENSITY: {
    high: ['is a shameless flirt', 'Winks', 'Eyebrows'],
    low: ['has no interest in romance at all', 'Unwooable', 'Not-Tonight'],
  },
  STRESS_VULNERABILITY: {
    high: ['cracks under the slightest pressure', 'Eggshell', 'Glass Jaw'],
    low: ['is immune to stress', 'Deadpan', 'Bedrock'],
  },
  GREED: {
    high: ['is greedy', 'Pocketful', 'Finders-Keepers'],
    low: ['has no interest in wealth', 'Gives-It-Away', 'Empty Purse'],
  },
  IMMODERATION: {
    high: ['cannot resist a temptation', 'Seconds', 'Another-Round'],
    low: ['is moderation itself', 'One-Mug', 'Half-Pint'],
  },
  VIOLENT: {
    high: ['loves a good brawl', 'Knuckles', 'Elbows'],
    low: ['shrinks from any violence', 'Hands-Off', 'Gentle'],
  },
  PERSEVERANCE: {
    high: ['never gives up on anything', 'Mule', 'Not-Yet'],
    low: ['gives up at the first snag', 'Half-Done', 'Quits'],
  },
  WASTEFULNESS: {
    high: ['is ruinously wasteful', 'Butterfingers', 'Spills'],
    low: ['wastes nothing, not even a crumb', 'Crumbs', 'Scrapsaver'],
  },
  DISCORD: {
    high: ['loves stirring up trouble', 'Pot-Stirrer', 'Stirs'],
    low: ['will do anything to avoid a quarrel', 'Hush', 'Peacemaker'],
  },
  FRIENDLINESS: {
    high: ['is friendly to absolutely everyone', 'Waves', 'Hugs'],
    low: ['is quite unfriendly', 'Nettles', 'Prickle'],
  },
  POLITENESS: {
    high: ['is exquisitely polite', 'After-You', 'Pardon'],
    low: ['is thoroughly rude', 'Belch', 'No-Thanks'],
  },
  DISDAIN_ADVICE: {
    high: ['ignores all advice', 'Knows-Better', 'Deaf Ear'],
    low: ['cannot decide anything without advice', 'Asks-Twice', 'Second Opinion'],
  },
  BRAVERY: {
    high: ['is utterly fearless', 'Hold-My-Mug', 'Front Row'],
    low: ['is a coward', 'Backline', 'Bolt'],
  },
  CONFIDENCE: {
    high: ['is supremely confident', 'Obviously', 'Of-Course'],
    low: ['has no confidence at all', 'Sorry', 'Maybe'],
  },
  VANITY: {
    high: ['is terribly vain', 'Mirror', 'Primp'],
    low: ['has not a shred of vanity', 'Mudcomb', 'Whatever-Fits'],
  },
  AMBITION: {
    high: ['is fiercely ambitious', 'Climber', 'Next-Mayor'],
    low: ['has no ambition whatsoever', 'Stays-Put', 'Good-Enough'],
  },
  GRATITUDE: {
    high: ['is grateful for everything', 'Much-Obliged', 'Thank-You'],
    low: ['is never grateful for anything', 'Ingrate', 'Took-It'],
  },
  IMMODESTY: {
    high: ['is shamelessly immodest', 'Look-at-Me', 'Brag'],
    low: ['is modest to a fault', 'Aw-Shucks', 'Oh-This'],
  },
  HUMOR: {
    high: ['has a great sense of humour', 'Punchline', 'Chuckles'],
    low: ['has no sense of humour', 'Unamused', 'Stoneface'],
  },
  VENGEFUL: {
    high: ['never forgets a slight', 'Payback', 'Tally'],
    low: ['forgives everyone everything', 'Clean Slate', 'Water-Under'],
  },
  PRIDE: {
    high: ['is very proud', 'Chin-Up', 'Peacock'],
    low: ['has no pride at all', 'Doormat', 'Humble Pie'],
  },
  CRUELTY: {
    high: ['is cruel', 'Pinch', 'Thumbscrew'],
    low: ['is soft-hearted', 'Softie', 'Tenderheart'],
  },
  SINGLEMINDED: {
    high: ['is single-minded to an alarming degree', 'Blinkers', 'One-Track'],
    low: ['is distracted by everything', 'Butterfly', 'Wanders'],
  },
  HOPEFUL: {
    high: ['is an incurable optimist', 'Sunny-Side', 'Surely-Fine'],
    low: ['always expects the worst', 'Told-You', 'Doomsayer'],
  },
  CURIOUS: {
    high: ['pokes {their} nose into everything', 'Nosy', 'Pokes'],
    low: ['has no curiosity whatsoever', 'Why-Bother', 'Unasked'],
  },
  BASHFUL: {
    high: ['is painfully shy', 'Blush', 'Mumbles'],
    low: ['is utterly shameless', 'Brass Neck', 'Shameless'],
  },
  PRIVACY: {
    high: ['is intensely private', 'Closed Door', 'Locked'],
    low: ['tells everyone everything', 'Overshare', 'Open Book'],
  },
  PERFECTIONIST: {
    high: ['is a perfectionist', 'Once-More', 'Redo'],
    low: ['is sloppy', 'Close-Enough', 'Slapdash'],
  },
  CLOSEMINDED: {
    high: ['is stubbornly closed-minded', 'Brick Ears', 'Already-Decided'],
    low: ['is open to any idea', 'Open Ears', 'Why-Not'],
  },
  TOLERANT: {
    high: ['puts up with anyone', 'Suffers-Fools', 'Patience'],
    low: ['tolerates nothing and nobody', 'Tut-Tut', 'Scowl'],
  },
  EMOTIONALLY_OBSESSIVE: {
    high: ['obsesses over every feeling', 'Broods', 'Clingy'],
    low: ['shrugs off feelings in a moment', 'Moves-On', 'Short Memory'],
  },
  SWAYED_BY_EMOTIONS: {
    high: ['is ruled by {their} feelings', 'Weathervane', 'Heart-First'],
    low: ['is never swayed by feelings', 'Level Head', 'Cold Chisel'],
  },
  ALTRUISM: {
    high: ['helps everyone', 'Soft Touch', 'Gives-a-Hand'],
    low: ['will not lift a finger for anyone', 'Not-My-Job', 'Busy'],
  },
  DUTIFULNESS: {
    high: ['is dutiful', 'By-the-Book', 'Rulebook'],
    low: ['has no sense of duty', 'Shirks', 'Not-Now'],
  },
  THOUGHTLESSNESS: {
    high: ['acts without thinking', 'Oops', 'Leaps-First'],
    low: ['thinks everything through twice', 'Measure-Twice', 'Ponders'],
  },
  ORDERLINESS: {
    high: ['is fanatically orderly', 'Neat Stack', 'Tidy'],
    low: ['lives in total disorder', 'Clutter', 'Heap'],
  },
  TRUST: {
    high: ['trusts everyone', 'Easy Mark', 'Believes-It'],
    low: ['trusts nobody', 'Side-Eye', 'Squints'],
  },
  GREGARIOUSNESS: {
    high: ['loves a crowd', 'Chatter', 'Party'],
    low: ['avoids company', 'Hermit', 'Corner Seat'],
  },
  ASSERTIVENESS: {
    high: ['is pushy', 'Shove', 'Loud'],
    low: ['is a pushover', 'Pushover', 'Whatever-You-Say'],
  },
  ACTIVITY_LEVEL: {
    high: ['is always on the go', 'Fidget', 'Zoom'],
    low: ['barely moves', 'Lump', 'Slow Pour'],
  },
  EXCITEMENT_SEEKING: {
    high: ['craves thrills', 'Double-Dare', 'Dares'],
    low: ['avoids any excitement', 'Slippers', 'Quiet Life'],
  },
  IMAGINATION: {
    high: ['has a wild imagination', 'Daydream', 'Faraway'],
    low: ['has no imagination', 'Literal', 'Plain Mug'],
  },
  ABSTRACT_INCLINED: {
    high: ['loves abstract ideas', 'Head-in-Clouds', 'Theory'],
    low: ['is practical to the bone', 'Nuts-and-Bolts', 'Hammer-Brain'],
  },
  ART_INCLINED: {
    high: ['loves art', 'Easel', 'Fine Taste'],
    low: ['has no feeling for art', 'Philistine', 'Wall-Is-Wall'],
  },
}

const VALUES: Record<string, { pos: Entry; neg: Entry }> = {
  LAW: {
    pos: ['respects the law above all', 'By-Law', 'Statute'],
    neg: ['thinks laws are for other dwarves', 'Loophole', 'Outlaw'],
  },
  LOYALTY: {
    pos: ['is loyal to a fault', 'Staunch', 'Faithful'],
    neg: ['sees no point in loyalty', 'Fairweather', 'Turncoat'],
  },
  FAMILY: {
    pos: ['lives for {their} family', 'Kinfolk'],
    neg: ['has no time for family', 'No-Kin'],
  },
  FRIENDSHIP: {
    pos: ['lives for {their} friends', 'Pal', 'Bosom'],
    neg: ['thinks friendship is a waste of time', 'Party of One', 'No-Pals'],
  },
  POWER: {
    pos: ['craves power', 'Throne-Eyes', 'Next-Baron'],
    neg: ['despises power', 'No-Crown'],
  },
  TRUTH: {
    pos: ['cannot abide a lie', 'Blunt', 'Honest Pick'],
    neg: ['thinks the truth is overrated', 'Tall Tales', 'Fibs'],
  },
  CUNNING: {
    pos: ['admires cunning', 'Angles', 'Sly'],
    neg: ['despises cunning', 'Plainspoke'],
  },
  ELOQUENCE: {
    pos: ['loves fine words', 'Wordy', 'Silver'],
    neg: ['distrusts fine words', 'Grunts'],
  },
  FAIRNESS: {
    pos: ['is fair to a fault', 'Even Scales'],
    neg: ['thinks fairness is for fools', 'Loaded Dice', 'Cheats'],
  },
  DECORUM: {
    pos: ['insists on decorum', 'Prim', 'Manners'],
    neg: ['has no use for decorum', 'Elbows-on-Table'],
  },
  TRADITION: {
    pos: ['holds to tradition', 'Old Ways'],
    neg: ['scorns tradition', 'New Ways'],
  },
  ARTWORK: {
    pos: ['loves artwork', 'Gallery'],
    neg: ['thinks art is a waste of good stone', 'Waste-of-Stone', 'Philistine'],
  },
  COOPERATION: {
    pos: ['believes in working together', 'Team Pick'],
    neg: ['would rather work alone', 'Lone Pick', 'Solo'],
  },
  INDEPENDENCE: {
    pos: ['prizes {their} independence', 'Own-Way'],
    neg: ['distrusts independence', 'Follows'],
  },
  STOICISM: {
    pos: ['thinks feelings should stay hidden', 'Stoneface'],
    neg: ['thinks feelings should be shown', 'Sleeve-Heart', 'Weeps'],
  },
  INTROSPECTION: {
    pos: ['loves examining {self}', 'Navel-Gazer'],
    neg: ['refuses to look inward', 'No-Mirror'],
  },
  SELF_CONTROL: {
    pos: ['prizes self-control', 'Tight Lid'],
    neg: ['thinks self-control is for the weak', 'No-Lid', 'Unhinged'],
  },
  TRANQUILITY: {
    pos: ['loves peace and quiet', 'Quiet Please'],
    neg: ['loves noise and bustle', 'Racket', 'Din'],
  },
  HARMONY: {
    pos: ['values harmony', 'Even Keel'],
    neg: ['finds harmony boring', 'Stirrer', 'Discord'],
  },
  MERRIMENT: {
    pos: ['lives for merriment', 'Revel', 'Jolly'],
    neg: ['thinks merriment is a waste of time', 'Wet Blanket', 'Killjoy'],
  },
  CRAFTSMANSHIP: {
    pos: ['lives for fine craftsmanship', 'Just-So', 'Fine Grain'],
    neg: ['does not care about craftsmanship', 'Bodger'],
  },
  MARTIAL_PROWESS: {
    pos: ['admires martial prowess', 'Swordtalk', 'Warbook'],
    neg: ['despises fighting skill', 'Butterknife'],
  },
  SKILL: {
    pos: ['admires skill above all', 'Show-Me'],
    neg: ['thinks skill is overrated', 'Winging-It'],
  },
  HARD_WORK: {
    pos: ['lives for hard work', 'Grindstone', 'Overtime'],
    neg: ['thinks hard work is for fools', 'Nap Time', 'Loafer'],
  },
  SACRIFICE: {
    pos: ['believes in sacrifice', 'Martyr'],
    neg: ['thinks sacrifice is pointless', 'Me-First'],
  },
  COMPETITION: {
    pos: ['loves competition', 'Race-You', 'Scorekeeper'],
    neg: ['hates competition', 'Everybody-Wins'],
  },
  PERSEVERANCE: {
    pos: ['values perseverance', 'Keeps-Digging'],
    neg: ['thinks perseverance is foolish', 'Why-Try', 'Quitter'],
  },
  LEISURE_TIME: {
    pos: ['lives for time off', 'Hammock', 'Tea Break'],
    neg: ['thinks time off is wasted time', 'No-Breaks', 'Always-On'],
  },
  COMMERCE: {
    pos: ['loves trade', 'Price-Check', 'Haggle'],
    neg: ['despises trade', 'No-Sale'],
  },
  ROMANCE: {
    pos: ['lives for romance', 'Sweetheart'],
    neg: ['thinks romance is silly', 'Unromantic'],
  },
  NATURE: {
    pos: ['loves nature, like an elf', 'Treehugger', 'Leafy'],
    neg: ['hates nature', 'Treekicker', 'Anti-Leaf'],
  },
  PEACE: {
    pos: ['values peace', 'Dove'],
    neg: ['thinks war is the answer', 'Itchy Axe', 'Warmonger'],
  },
  KNOWLEDGE: {
    pos: ['lives for knowledge', 'Footnote', 'Bookish'],
    neg: ['thinks learning is a waste of time', 'Proud Dunce', 'Unread'],
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
  MinorInjuries: t(0.8, ['Scrapes']),
  Syndrome: t(1.2),
  Trauma: t(1.2, [], { bad: true }),
  EatVermin: t(2.6, ['Ratsnack', 'Crunchy'], { enjoyed: ['Rat Gourmet'] }),
  EatLikeAnimal: t(1.8, ['Floor-Supper', 'Lap-Plate']),
  DrinkWithoutCup: t(1.4, ['Cupless', 'Two-Hands']),
  AteRotten: t(2.4, ['Rotgut', 'Iron Belly'], { phrase: 'ate rotten food', bad: true }),
  DrankSpoiled: t(2.2, ['Sour Sip'], { phrase: 'drank something spoiled', bad: true }),
  NastyWater: t(2, ['Puddle-Sip'], { phrase: 'drank nasty water', bad: true }),
  DrinkVomit: t(3, ['Second-Hand Sip'], { phrase: 'drank vomit' }),
  DrinkBlood: t(2.6, ['Bloodsip'], { phrase: 'drank blood' }),
  DrinkSlime: t(2.6, ['Slimesip'], { phrase: 'drank slime' }),
  DrinkGoo: t(2.6, ['Gooey'], { phrase: 'drank goo' }),
  DrinkIchor: t(2.6, ['Ichorsip'], { phrase: 'drank ichor' }),
  DrinkPus: t(2.8, ['Pus-Sip'], { phrase: 'drank pus' }),
  SameFood: t(1.3, ['Same-Again', 'Picky'], { phrase: 'got sick of eating the same thing' }),
  SameBooze: t(1.3, ['Same-Barrel', 'Picky'], {
    phrase: 'got sick of drinking the same booze',
  }),
  EatPet: t(3, ['Petmeal'], { phrase: 'ate a former pet' }),
  SleptMud: t(2.4, ['Mudbed', 'Mudpillow'], { phrase: 'slept in the mud' }),
  SleptFloor: t(1.6, ['Floorbed'], { phrase: 'slept on the floor' }),
  SleptRoughFloor: t(1.6, ['Rockpillow'], { phrase: 'slept on a rough stone floor' }),
  SleptRocks: t(1.8, ['Pebblebed', 'Rockpillow'], { phrase: 'slept on rocks' }),
  SleptGrass: t(1.8, ['Grassbed'], { phrase: 'slept in the grass' }),
  SleptIce: t(2.4, ['Icebed', 'Frostpillow'], { phrase: 'slept on ice' }),
  SleptDirt: t(1.8, ['Dirtnap'], { phrase: 'slept in the dirt' }),
  SleptDriftwood: t(2, ['Driftbed'], { phrase: 'slept on driftwood' }),
  SleepNoiseWake: t(1.4, ['Light Sleeper', 'Earplugs']),
  SleepNoiseMajorWake: t(1.4, ['Light Sleeper', 'Earplugs']),
  VeryDrowsy: t(1.4, ['Yawns', 'Nods-Off']),
  Dehydrated: t(1.8, ['Parched', 'Dry Throat']),
  Starving: t(2, ['Hollow', 'Rumbles']),
  Rain: t(1.2, ['Drizzle', 'Soggy'], { bad: true, enjoyed: ['Puddles', 'Rain-Glad'] }),
  SnowStorm: t(1.6, ['Frostnose', 'Snowcap'], { bad: true, enjoyed: ['Snowglee'] }),
  FreakishWeather: t(1.8, ['Stormbitten'], { bad: true, enjoyed: ['Storm-Glee'] }),
  Miasma: t(1.8, ['Whiff', 'Stinkface'], { bad: true, enjoyed: ['Stinklover', 'Sniffs-Rot'] }),
  Smoke: t(1.6, ['Kipper', 'Sooty'], { bad: true, enjoyed: ['Smokesniffer'] }),
  Dust: t(1.2, ['Dusty'], { phrase: 'got covered in dust', bad: true }),
  Waterfall: t(1.4, ['Mist-Face'], { phrase: 'stood in the spray of a waterfall' }),
  SunNausea: t(1.8, ['Cave-Pale', 'Sunsick'], { phrase: 'was sickened by the sun', bad: true }),
  SunIrritated: t(1.4, ['Sunscowl'], { phrase: 'was irritated by the sun', bad: true }),
  SawDeadBody: t(1.4, ['Bodyfinder'], { bad: true, enjoyed: ['Morbid', 'Grave Fan'] }),
  NoShoes: t(1.8, ['Barefoot', 'Tenderfoot']),
  NoShirt: t(1.8, ['Shirtless']),
  OldClothing: t(1.2, ['Threadbare']),
  TatteredClothing: t(1.6, ['Rags', 'Threadbare']),
  RottedClothing: t(2.2, ['Moth-Snack', 'Rags']),
  Uncovered: t(2.4, ['Starkers'], { phrase: 'went about uncovered' }),
  GhostHaunt: t(2.2, ['Haunted', 'Ghost-Pal'], { bad: true }),
  GhostNightmare: t(2, ['Haunted'], { bad: true }),
  Cavein: t(2.6, ['Rubble', 'Flat-Hat'], { bad: true, enjoyed: ['Rubble-Glad'] }),
  SparringAccident: t(2.4, ['Oops-Spear'], { phrase: 'had a sparring accident' }),
  LackWork: t(1.6, ['Idle Hands', 'Loafs']),
  MajorInjuries: t(1.6, ['Stitches', 'Patchwork']),
  Complained: t(1.2, ['Grumbles', 'Complaint Desk']),
  Bath: t(1.2, ['Soapy', 'Squeaky']),
  SoapyBath: t(1.4, ['Bubbles', 'Soapy'], { phrase: 'took a soapy bath' }),
  NewRomance: t(1.4, ['Lovestruck', 'Swoons']),
  Argument: t(1.3, ['Squabble', 'Snaps'], {
    bad: true,
    enjoyed: ['Argues-for-Fun', 'Relishes-a-Row'],
  }),
  FistFight: t(2, ['Knuckles', 'Brawl'], { phrase: 'got into a fist fight' }),
  GaveBeating: t(2.2, ['Knuckles'], { phrase: 'gave someone a beating' }),
  GotBeaten: t(2.2, ['Bruises'], { phrase: 'got beaten', bad: true }),
  GaveHammering: t(2.2, ['Gavel'], { phrase: 'hammered a criminal as punishment' }),
  GotHammered: t(2.6, ['Hammered'], {
    phrase: 'got hammered as a punishment',
    bad: true,
    enjoyed: ['Likes-the-Hammer'],
  }),
  Jailed: t(2.4, ['Jailbird'], { phrase: 'was jailed' }),
  JailReleased: t(1.6, ['Parole'], { phrase: 'was let out of jail' }),
  Kill: t(2.2, ['Bloodied', 'Tally']),
  FirstKill: t(2, ['First Blood']),
  Attacked: t(1.6, ['Punching Bag'], { bad: true }),
  AttackedByDead: t(2.4, ['Zombie-Chew', 'Corpse-Kicked'], {
    bad: true,
    enjoyed: ['Zombie Fan'],
  }),
  LostPet: t(1.4, ['Petless']),
  MadeArtifact: t(2.6, ['Heirloom', 'Fey Hands']),
  AnnoyedVermin: t(1.8, ['Rat-Magnet', 'Fleabag'], { phrase: 'was pestered by vermin' }),
  PesteredVermin: t(1.8, ['Rat-Magnet', 'Fleabag'], { phrase: 'was pestered by vermin' }),
  NearVermin: t(1.2, ['Rat-Magnet'], { phrase: 'was bothered by vermin nearby' }),
  Taxed: t(1.4, ['Taxed'], { phrase: 'got taxed', bad: true }),
  Elected: t(1.6, ['Ballot']),
  Reelected: t(1.8, ['Ballot-Again'], { phrase: 'was re-elected' }),
  Demands: t(1.6, ['Wants-More']),
  Perform: t(1.2, ['Encore']),
  ResearchBreakthrough: t(1.8, ['Eureka']),
  ThrownStuff: t(2.4, ['Throws', 'Table-Flipper'], { phrase: 'threw things in a tantrum' }),
  ToppledStuff: t(2.4, ['Table-Flipper'], { phrase: 'toppled furniture in a tantrum' }),
  Decay: t(1.6, ['Smells'], { phrase: 'caught the smell of decay' }),
  MeetingInBedroom: t(1.8, ['Bedroom Office'], { phrase: 'held a meeting in a bedroom' }),
  ReceivedFood: t(1.4, ['Spoon-Fed'], { phrase: 'was fed in bed by a fortmate' }),
  ReceivedWater: t(1.4, ['Spoon-Fed'], { phrase: 'was given water in bed by a fortmate' }),
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
  COMEDY: ['Punchline', 'Heckles'],
  FLATTERY: ['Honeytongue', 'Sweet-Talk'],
  LYING: ['Fibber', 'Tall Tale'],
  INTIMIDATION: ['Glower', 'The Stare'],
  PERSUASION: ['Talks-You-Round', 'Silver Tongue'],
  NEGOTIATION: ['Haggle', 'Final Offer'],
  CONSOLE: ['There-There', 'Shoulder'],
  PACIFY: ['Hush-Now', 'Calm-Down'],
  CONVERSATION: ['Natter', 'Chatterbox'],
  JUDGING_INTENT: ['Reads-You', 'Knowing Look'],
  SPEAKING: ['Speechify'],
  DANCE: ['Twinkletoes', 'Jig'],
  SING_MUSIC: ['Warble', 'Hums'],
  MAKE_MUSIC: ['Plinks'],
  PLAY_STRINGED_INSTRUMENT: ['Twang', 'Plinks'],
  PLAY_KEYBOARD_INSTRUMENT: ['Keys'],
  PLAY_WIND_INSTRUMENT: ['Toot'],
  PLAY_PERCUSSION_INSTRUMENT: ['Drumroll', 'Thump'],
  POETRY: ['Rhymes', 'Verse'],
  PROSE: ['Scribbles'],
  WRITING: ['Inkfingers'],
  READING: ['Bookworm'],
  SWIMMING: ['Splash', 'Floats'],
  CLIMBING: ['Handholds', 'Up-the-Wall'],
  DODGING: ['Duck', 'Sidestep'],
  SNEAK: ['Tiptoe', 'Creeps'],
  MILK: ['Udders'],
  GELD: ['Snip-Snip'],
  CHEESEMAKING: ['Curds', 'Whey'],
  SOAP_MAKING: ['Lather'],
  SHEARING: ['Clippers'],
  BEEKEEPING: ['Buzz'],
  WAX_WORKING: ['Waxy'],
  PRESSING: ['Squish'],
  CRUTCH_WALK: ['Hopalong'],
  STANCE_STRIKE: ['Kicks'],
  SITUATIONAL_AWARENESS: ['Eyes-Behind'],
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
      'Doctor Maybe',
      'Guesswork',
      'Leeches',
    ],
  ],
  [
    /bookkeeper/i,
    ['RECORD_KEEPING'],
    [
      'keeps the fortress books without knowing how to keep records',
      'Roughly',
      'Counts-on-Fingers',
    ],
  ],
  [
    /broker/i,
    ['APPRAISAL'],
    ['trades for the fortress with no idea what anything is worth', 'Overpays', 'Bad Bargain'],
  ],
  [
    /manager/i,
    ['ORGANIZATION'],
    ['manages the fortress without any head for organisation', 'Lost Memo', 'Whose Order'],
  ],
  [
    /commander|captain|lieutenant|sheriff/i,
    MILITARY_SKILLS,
    ['leads soldiers without knowing how to fight', 'Paper Sword', 'Behind-You'],
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
    high: ['is the tallest dwarf in the fortress', 'Rafters', 'Lofty'],
    low: ['is the shortest dwarf in the fortress', 'Knee-High', 'Pebble'],
    spread: 5,
  },
  {
    key: 'body:BROADNESS',
    high: ['is the broadest dwarf in the fortress', 'Doorframe', 'Barrel'],
    low: ['is the narrowest dwarf in the fortress', 'Sliver', 'Plank'],
    spread: 5,
  },
  {
    key: 'NOSE:BROADNESS',
    high: ['has the broadest nose in the fortress', 'Snout', 'Nostrils'],
    low: ['has the narrowest nose in the fortress', 'Needle-Nose'],
  },
  {
    key: 'NOSE:LENGTH',
    high: ['has the longest nose in the fortress', 'Beak', 'Nosey'],
    low: ['has the shortest nose in the fortress', 'Button'],
  },
  { key: 'NOSE:UPTURNED', high: ['has the most upturned nose in the fortress', 'Snoot', 'Piggy'] },
  { key: 'NOSE:CONVEX', high: ['has the most hooked nose in the fortress', 'Hook', 'Crag'] },
  {
    key: 'EAR:SPLAYED_OUT',
    high: ['has the most sticking-out ears in the fortress', 'Jugs', 'Sails'],
  },
  {
    key: 'EAR:HANGING_LOBES',
    high: ['has the droopiest earlobes in the fortress', 'Lobes', 'Danglers'],
  },
  { key: 'EAR:BROADNESS', high: ['has the widest ears in the fortress', 'Flaps'] },
  {
    key: 'EYE:CLOSE_SET',
    high: ['has the most close-set eyes in the fortress', 'Squinch'],
    low: ['has the widest-set eyes in the fortress', 'Wide-Eyes', 'Hammerhead'],
  },
  {
    key: 'EYE:DEEP_SET',
    high: ['has the most deep-set eyes in the fortress', 'Cave-Eyes', 'Hollows'],
    low: ['has the most bulging eyes in the fortress', 'Goggles', 'Boggle'],
  },
  { key: 'EYE:LARGE_IRIS', high: ['has the biggest irises in the fortress', 'Saucers'] },
  {
    key: 'LIP:THICKNESS',
    high: ['has the thickest lips in the fortress', 'Pout'],
    low: ['has the thinnest lips in the fortress', 'Thin-Lip'],
  },
  { key: 'TOOTH:GAPS', high: ['has the gappiest teeth in the fortress', 'Gap', 'Whistles'] },
  { key: 'TOOTH:LENGTH', high: ['has the longest teeth in the fortress', 'Tusks', 'Fangs'] },
  {
    key: 'SKULL:JUTTING_CHIN',
    high: ['has the most jutting chin in the fortress', 'Lanternjaw', 'Shovel'],
  },
  { key: 'SKULL:SQUARE_CHIN', high: ['has the squarest chin in the fortress', 'Brickjaw'] },
  {
    key: 'SKULL:HIGH_CHEEKBONES',
    high: ['has the highest cheekbones in the fortress', 'Cheekbones'],
  },
  {
    key: 'THROAT:DEEP_VOICE',
    high: ['has the deepest voice in the fortress', 'Rumble', 'Gravel'],
    low: ['has the highest voice in the fortress', 'Squeak', 'Piccolo'],
  },
  { key: 'THROAT:RASPY_VOICE', high: ['has the raspiest voice in the fortress', 'Rasp', 'Croak'] },
  { key: 'HEAD:BROADNESS', high: ['has the widest head in the fortress', 'Anvilhead', 'Melon'] },
]

const HAIR_LAYERS: Record<string, string> = {
  HAIR: 'hair',
  CHIN_WHISKERS: 'beard',
  MOUSTACHE: 'moustache',
  SIDEBURNS: 'sideburns',
}

const LONGEST_NAMES: Record<string, string[]> = {
  HAIR: ['Mop', 'Curtains'],
  CHIN_WHISKERS: ['Floorsweeper', 'Beard-Trip'],
  MOUSTACHE: ['Walrus', 'Handlebars'],
  SIDEBURNS: ['Muttonchops'],
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
  ITEM_HELM_MASK: ['wears a mask', 1.6, 'Masked', 'Who-Is-That'],
  ITEM_HELM_VEIL_FACE: ['wears a face veil', 1.4, 'Veiled'],
  ITEM_HELM_VEIL_HEAD: ['wears a head veil', 1.2, 'Veiled'],
  ITEM_HELM_TURBAN: ['wears a turban', 1.2, 'Turban'],
  ITEM_HELM_HOOD: ['wears a hood', 1, 'Hooded'],
  ITEM_HELM_SCARF_HEAD: ['wears a headscarf', 0.8],
  ITEM_ARMOR_CAPE: ['wears a cape', 1.6, 'Swoosh', 'Cape'],
  ITEM_ARMOR_CLOAK: ['wears a cloak', 1.2, 'Cloak'],
  ITEM_ARMOR_ROBE: ['wears a robe', 1.2, 'Robes'],
  ITEM_ARMOR_TOGA: ['wears a toga', 1.8, 'Toga'],
  ITEM_ARMOR_VEST: ['wears a vest', 1, 'Waistcoat'],
  ITEM_PANTS_LOINCLOTH: ['wears a loincloth', 2, 'Loincloth'],
  ITEM_PANTS_THONG: ['wears a thong', 2.4, 'Thong'],
  ITEM_PANTS_SKIRT_SHORT: ['wears a short skirt', 1],
  ITEM_SHOES_SANDAL: ['wears sandals', 1.4, 'Sandals'],
  ITEM_GLOVES_MITTENS: ['wears mittens', 1.8, 'Mittens'],
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
  Fey: ['Fey-Eyed', 'Workshop Thief'],
  Secretive: ['Hush-Hush', 'Workshop Thief'],
  Possessed: ['Possessed'],
  Macabre: ['Bonewright', 'Morbid'],
  Fell: ['Fell-Eyed'],
  Melancholy: ['Moper'],
  Raving: ['Raving'],
  Berserk: ['Berserk'],
  Traumatized: ['Hollow-Eyed'],
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

function fill(text: string, unit: FortUnit): string {
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
export function skillLabel(token: string, unit: FortUnit): string {
  return fill(SKILL_LABELS[token] ?? humanize(token).toLowerCase(), unit)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
  return {
    size: citizens.length,
    looks,
    hair,
    bestAt,
    oldest: enough ? standout(ages, 1) : null,
    youngest: enough ? standout(ages, -1) : null,
    happiest: enough ? standout(stress, -1) : null,
    unhappiest: enough ? standout(stress, 1) : null,
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
      names: [],
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
      names: ['Spare Hands', 'Apprentice-for-Life'],
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
      names: ['All Talk', 'Chinwag'],
    })
  }
  for (const [skill, r] of skills) {
    if (r < 15) break
    out.push({
      key: `legendary:${skill}`,
      text: `is ${skillRank(r)} at ${skillLabel(skill, unit)}`,
      weight: r >= 20 ? 2 : 1.6,
      names: [],
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
      weight: 1,
      names: [],
    })
  }

  if (!unit.squad) {
    for (const item of unit.look?.worn ?? []) {
      if (item.mode !== 'Weapon' || item.type !== 'WEAPON' || !item.subtype) continue
      if (/PICK/.test(item.subtype)) continue
      const weapon = weaponName(item.subtype)
      out.push({
        key: `weapon:${item.subtype}`,
        text: `carries ${article(weapon)} around the fortress`,
        weight: 1.3,
        names: [],
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
      weight: extreme ? 2.2 : 1.5,
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
        Math.abs(strength) >= 41 ? 1.7 : 1.1,
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

  if (unit.mood) {
    out.push({
      key: `mood:${unit.mood}`,
      text: `is in the grip of a ${unit.mood.toLowerCase()} mood`,
      weight: 3,
      names: MOOD_NAMES[unit.mood] ?? [],
    })
  }
  if (unit.flags.includes('insane') || unit.flags.includes('crazed')) {
    out.push({ key: 'insane', text: 'has lost {their} mind', weight: 3, names: ['Cracked'] })
  }
  if (unit.stress_category <= 0) {
    out.push({ key: 'miserable', text: 'is miserable', weight: 1.4, names: ['Stormcloud', 'Sulk'] })
  } else if (fort.unhappiest === unit.id) {
    out.push({
      key: 'unhappiest',
      text: 'is the unhappiest dwarf in the fortress',
      weight: 1.2,
      names: ['Raincloud'],
    })
  }
  if (fort.happiest === unit.id) {
    out.push({
      key: 'happiest',
      text: 'is the happiest dwarf in the fortress',
      weight: 0.9,
      names: ['Beaming', 'Sunny'],
    })
  }
  return out.map((f) => ({ ...f, text: fill(f.text, unit) }))
}

function bodyFacts(unit: FortUnit, fort: Yardstick): Draft[] {
  const out: Draft[] = []
  const age = Math.floor(unit.age)
  if (unit.flags.includes('baby')) {
    out.push({ key: 'baby', text: 'is a baby', weight: 0.8, names: ['Bundle', 'Squall'] })
  } else if (unit.flags.includes('child')) {
    out.push({
      key: 'child',
      text: `is a child of ${age}`,
      weight: 0.8,
      names: ['Tadpole', 'Ankle-Biter'],
    })
  }
  if (fort.oldest === unit.id) {
    out.push({
      key: 'oldest',
      text: `is the oldest dwarf in the fortress, at ${age}`,
      weight: 1.4,
      names: [unit.sex === 0 ? 'Granny' : unit.sex === 1 ? 'Gramps' : 'Elder', 'Old Flint'],
    })
  }
  if (fort.youngest === unit.id) {
    out.push({
      key: 'youngest',
      text: `is the youngest grown dwarf in the fortress, at ${age}`,
      weight: 1.1,
      names: ['Sprout', 'Fresh Face'],
    })
  }
  if (age >= 150) {
    out.push({
      key: 'ancient',
      text: `is ${age} years old`,
      weight: 1.6,
      names: ['Fossil', 'Relic'],
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
          names: ['Egghead', 'Polished'],
        })
      } else if (layer === 'CHIN_WHISKERS') {
        out.push({
          key: 'shaved:CHIN_WHISKERS',
          text: `keeps ${pronouns(unit).their} chin clean-shaven, which for a dwarf is a statement`,
          weight: 2,
          names: ['Bare-Chin', 'Smoothjaw'],
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
    out.push({ key: 'lost:arm', text: 'has lost an arm', weight: 3, names: ['One-Arm', 'Lefty'] })
  } else if (missing.has('HAND')) {
    const right = (missing.get('HAND') ?? []).some((t) => /^R/.test(t))
    out.push({
      key: 'lost:hand',
      text: 'has lost a hand',
      weight: 3,
      names: [right ? 'Lefty' : 'Righty', 'One-Hand'],
    })
  } else if (missing.has('FINGER')) {
    const n = missing.get('FINGER')?.length ?? 0
    out.push({
      key: 'lost:finger',
      text: `is missing ${n === 1 ? 'a finger' : `${n} fingers`}`,
      weight: 3,
      names: n < 10 ? [`${NUMBER_WORDS[10 - n] ?? 'Few'}fingers`, 'Stubs'] : ['Stubs'],
    })
  }
  if (lostLimb(/^LEG_/) || missing.has('FOOT')) {
    out.push({ key: 'lost:leg', text: 'has lost a leg', weight: 3, names: ['Hopalong', 'Peg'] })
  } else if (missing.has('TOE')) {
    const n = missing.get('TOE')?.length ?? 0
    out.push({
      key: 'lost:toe',
      text: `is missing ${n === 1 ? 'a toe' : `${n} toes`}`,
      weight: 2.5,
      names: n < 10 ? [`${NUMBER_WORDS[10 - n] ?? 'Few'}toes`] : [],
    })
  }
  if (missing.has('EYE')) {
    const both = (missing.get('EYE')?.length ?? 0) >= 2
    out.push({
      key: 'lost:eye',
      text: both ? 'has lost both eyes' : 'has lost an eye',
      weight: 3,
      names: both ? ['Feels-the-Way'] : ['One-Eye', 'Winks'],
    })
  }
  if (missing.has('EAR'))
    out.push({
      key: 'lost:ear',
      text: 'has lost an ear',
      weight: 2.5,
      names: ['One-Ear', 'Lopside'],
    })
  if (missing.has('NOSE'))
    out.push({ key: 'lost:nose', text: 'has lost {their} nose', weight: 3, names: ['Noseless'] })
  if (missing.has('TOOTH')) {
    const n = missing.get('TOOTH')?.length ?? 0
    out.push({
      key: 'lost:tooth',
      text: `is missing ${n === 1 ? 'a tooth' : `${n} teeth`}`,
      weight: 2.2,
      names: ['Gums', 'Whistles'],
    })
  }
  if (unit.wounds > 0 && missing.size === 0) {
    out.push({ key: 'wounded', text: 'is nursing a wound', weight: 0.5, names: [] })
  }

  const worn = unit.look?.worn
  if (unit.look && worn && !unit.flags.includes('baby')) {
    const types = new Set(worn.map((item) => item.type))
    if (worn.length === 0) {
      out.push({ key: 'naked', text: 'wears nothing at all', weight: 3, names: ['Starkers'] })
    } else {
      if (!types.has('SHOES'))
        out.push({
          key: 'barefoot',
          text: 'goes barefoot',
          weight: 2,
          names: ['Barefoot', 'Tenderfoot'],
        })
      if (!types.has('PANTS'))
        out.push({ key: 'trouserless', text: 'wears no trousers', weight: 2.2, names: ['Breezy'] })
      if (!types.has('ARMOR'))
        out.push({ key: 'shirtless', text: 'wears no shirt', weight: 2, names: ['Shirtless'] })
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
          names: ['Clank', 'Tin Hat'],
        })
      }
      if (item.flags.includes('IS_CRAFTED_ARTIFACT')) {
        out.push({
          key: `artifact:${subtype}`,
          text: 'wears an artifact',
          weight: 2,
          names: ['Heirloom'],
        })
      }
    }
  }
  return out.map((f) => ({ ...f, text: fill(f.text, unit) }))
}

const DULL_EVENTS =
  /^(CANCEL_JOB|MASTERPIECE_CRAFTED|PROFESSION_CHANGES|QUOTA_FILLED|STRUCK_|SEASON_|WEATHER_|CONSTRUCTION_SUSPENDED|DIG_CANCEL|NOTHING_TO_CATCH|D_MIGRANTS_ARRIVAL|LIAISON_ARRIVAL|CARAVAN|MERCHANT)/

const EVENT_NAMES: [RegExp, string[]][] = [
  [/VERMIN_BITE/, ['Ratbitten', 'Chewed']],
  [/STRANGE_MOOD|MOOD_BUILDING_CLAIMED/, ['Fey-Eyed', 'Workshop Thief']],
  [/ARTIFACT/, ['Heirloom']],
  [/MARRIAGE/, ['Newlywed']],
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
      names: [...(favourite === 'coffin' ? ['Undertaker'] : []), `${capitalize(favourite)}wright`],
    })
  }
  if (trades.length >= 2) {
    out.push({
      key: 'event:jobs',
      text: `has changed trade ${trades.length} times: ${trades.join(', then ')}`,
      weight: 1.2 + 0.3 * Math.min(trades.length, 4),
      names: ['Jobhopper', 'Next-Trade'],
    })
  }
  for (const [reason, count] of [...cancels].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    const creature = /interrupted by (.+)/i.exec(reason)?.[1]
    out.push({
      key: `cancel:${reason.toLowerCase()}`,
      text: `gave up ${count === 1 ? 'a job' : `${count} jobs`} with the excuse "${reason}"`,
      weight: 1.2 + Math.min(count, 5) * 0.2,
      names: creature
        ? [`${capitalize(creature.split(/\s+/).at(-1) ?? creature)}-Shy`]
        : /dangerous terrain/i.test(reason)
          ? ['Tiptoe']
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
 * without them the dossiers keep to the dump.
 */
export function buildDossiers(citizens: FortUnit[], events: ChronicleEvent[] = []): Dossiers {
  const fort = yardstick(citizens)
  const names = dwarfNames(citizens, events)
  const drafts = new Map<number, Draft[]>()
  const shared = new Map<string, number>()
  for (const unit of citizens) {
    const name = names.get(unit.id) ?? { given: null, surname: '', meaning: '' }
    const facts = [
      ...workFacts(unit, fort),
      ...mindFacts(unit, fort),
      ...bodyFacts(unit, fort),
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
}

function candidates(unit: FortUnit, facts: DwarfFact[], name: DwarfName | undefined): Candidate[] {
  const called = callName(name, unit)
  const given = name?.given?.toLowerCase()
  const out: Candidate[] = []
  for (const fact of facts) {
    if (!fact.names.length) continue
    const offset = stableHash(`${unit.id}:${fact.key}`) % fact.names.length
    const rotated = [...fact.names.slice(offset), ...fact.names.slice(0, offset)]
    rotated.forEach((nickname, i) => {
      if (nickname.toLowerCase() === given) return
      out.push({
        nickname,
        why: fact.why ?? `${called} ${fact.text}.`,
        source: 'facts',
        score: fact.score * (i === 0 ? 1 : 0.7),
        factKey: fact.key,
      })
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Up to `perDwarf` ideas for each citizen, each on a different fact. No two
 * dwarves get the same first idea, nor one another citizen already goes by.
 */
export function factIdeas(
  citizens: FortUnit[],
  dossiers: Dossiers,
  perDwarf = 4,
): Map<number, NicknameIdea[]> {
  const pools = new Map(
    citizens.map((u) => [
      u.id,
      candidates(u, dossiers.facts.get(u.id) ?? [], dossiers.names.get(u.id)),
    ]),
  )
  const nicknamed = new Map(
    citizens
      .filter((u) => u.nickname?.trim())
      .map((u) => [u.nickname?.trim().toLowerCase() ?? '', u.id]),
  )
  const firsts = new Map<string, number>()
  const order = [...citizens].sort(
    (a, b) =>
      (pools.get(b.id)?.[0]?.score ?? 0) - (pools.get(a.id)?.[0]?.score ?? 0) || a.id - b.id,
  )
  const firstOf = new Map<number, Candidate>()
  for (const unit of order) {
    const pick = pools.get(unit.id)?.find((c) => {
      const key = c.nickname.toLowerCase()
      const owner = nicknamed.get(key) ?? firsts.get(key)
      return owner === undefined || owner === unit.id
    })
    if (!pick) continue
    firsts.set(pick.nickname.toLowerCase(), unit.id)
    firstOf.set(unit.id, pick)
  }
  const out = new Map<number, NicknameIdea[]>()
  for (const unit of citizens) {
    const first = firstOf.get(unit.id)
    const ideas: Candidate[] = first ? [first] : []
    const facts = new Set(ideas.map((c) => c.factKey))
    const names = new Set(ideas.map((c) => c.nickname.toLowerCase()))
    for (const c of pools.get(unit.id) ?? []) {
      if (ideas.length >= perDwarf) break
      const key = c.nickname.toLowerCase()
      const owner = nicknamed.get(key) ?? firsts.get(key)
      if (facts.has(c.factKey) || names.has(key) || (owner !== undefined && owner !== unit.id))
        continue
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
