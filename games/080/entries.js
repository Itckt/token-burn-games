"use strict";

// Classic scripts let the webpage load these same records directly from disk.
const StreetLexicon = (() => {
  const topics = {
    talk: "Conversation",
    people: "People & feelings",
    plans: "Out & about",
    work: "Work & play",
    food: "Food & spending",
  };

  function example(zh, jyutping, en) {
    return { zh, jyutping, en };
  }

  // These short objects can sit after the first character of a separable expression.
  const pronouns = ["我", "你", "佢", "我哋", "你哋", "佢哋"];

  const groups = {
    talk: [
      {
        term: "吹水", jyutping: "ceoi1 seoi2", meaning: "Have a casual chat",
        infixes: ["陣", "阵", "吓", "下"],
        note: "Use it for an easy, aimless conversation among friends. In a more sceptical tone it can also suggest someone is spinning a yarn.",
        keywords: ["chatting", "chitchat", "shoot the breeze", "banter"],
        example: example("我哋坐低吹陣水。", "ngo5 dei6 co5 dai1 ceoi1 zan6 seoi2", "Let's sit down and chat for a bit."),
      },
      {
        term: "吹雞", jyutping: "ceoi1 gai1", meaning: "Call in the crew",
        note: "Use it when someone rounds up a group at short notice. The image is of blowing a whistle to summon everyone.",
        forms: ["吹鸡"], keywords: ["rally", "reinforcements", "gather friends"],
        example: example("你吹雞，我搵位。", "nei5 ceoi1 gai1 ngo5 wan2 wai2", "You round everyone up. I'll find us seats."),
      },
      {
        term: "八卦", jyutping: "baat3 gwaa3", meaning: "Be nosy",
        note: "It can describe someone prying into other people's business. Calling a person this to their face can sound sharp.",
        keywords: ["gossip", "snoop", "pry"],
        example: example("我都係八卦問吓啫。", "ngo5 dou1 hai6 baat3 gwaa3 man6 haa5 ze1", "I was just being nosy and asking."),
      },
      {
        term: "嘥氣", jyutping: "saai1 hei3", meaning: "Waste your breath",
        note: "Say it when another explanation or argument would get you nowhere.",
        forms: ["嘥气"], keywords: ["pointless", "futile", "waste of time"],
        example: example("佢唔肯聽，講都嘥氣。", "keoi5 m4 hang2 teng1 gong2 dou1 saai1 hei3", "He won't listen. I'd be wasting my breath."),
      },
      {
        term: "認叻", jyutping: "jing6 lek1", meaning: "Show off how clever you are",
        note: "A dig at someone eager to claim credit or act like the expert.",
        forms: ["认叻"], keywords: ["boast", "brag", "know-it-all"],
        example: example("我唔識，唔敢認叻。", "ngo5 m4 sik1 m4 gam2 jing6 lek1", "I don't know about it, so I won't play the expert."),
      },
      {
        term: "食花生", jyutping: "sik6 faa1 sang1", meaning: "Watch the drama unfold",
        note: "The spectator is figuratively eating peanuts while other people have a row. It's common in group chats.",
        keywords: ["spectate", "bystander", "popcorn", "watch drama"],
        example: example("佢哋鬧交，我喺旁邊食花生。", "keoi5 dei6 naau6 gaau1 ngo5 hai2 pong4 bin1 sik6 faa1 sang1", "They were arguing. I just watched from the sidelines."),
      },
      {
        term: "潛水", jyutping: "cim4 seoi2", meaning: "Go quiet in a chat",
        note: "Literally to dive underwater. Online, someone who stops posting or reads in silence has gone underwater.",
        forms: ["潜水"], keywords: ["lurk", "disappear", "silent", "offline"],
        example: example("你近排潛水呀？", "nei5 gan6 paai2 cim4 seoi2 aa3", "Have you been lying low lately?"),
      },
      {
        term: "已讀不回", jyutping: "ji5 duk6 bat1 wui4", meaning: "Leave someone on read",
        note: "The read receipt has appeared and a reply still hasn't arrived.",
        forms: ["已读不回"], keywords: ["ignore message", "read receipt", "no reply"],
        example: example("佢又已讀不回。", "keoi5 jau6 ji5 duk6 bat1 wui4", "They've left me on read again."),
      },
    ],
    people: [
      {
        term: "大頭蝦", jyutping: "daai6 tau4 haa1", meaning: "A scatterbrain",
        note: "An affectionate or exasperated name for someone who keeps forgetting things. Literally a big-headed prawn.",
        forms: ["大头虾"], keywords: ["absent-minded", "forgetful", "careless"],
        example: example("我真係大頭蝦，又唔記得帶遮。", "ngo5 zan1 hai6 daai6 tau4 haa1 jau6 m4 gei3 dak1 daai3 ze1", "I'm so forgetful. I've left my umbrella behind again."),
      },
      {
        term: "黐線", jyutping: "ci1 sin3", meaning: "Absolutely bonkers",
        note: "A blunt reaction to something outrageous. Aimed directly at a person, it can be insulting.",
        forms: ["痴線", "黐线", "痴线"], keywords: ["crazy", "ridiculous", "absurd"],
        example: example("一杯水都咁貴，黐線㗎！", "jat1 bui1 seoi2 dou1 gam3 gwai3 ci1 sin3 gaa3", "That much for a glass of water? That's bonkers!"),
      },
      {
        term: "醒目", jyutping: "sing2 muk6", meaning: "Quick on the uptake",
        note: "A compliment for someone alert enough to spot what needs doing without a prompt.",
        keywords: ["sharp", "smart", "observant", "alert"],
        example: example("你咁快就明，真係醒目。", "nei5 gam3 faai3 zau6 ming4 zan1 hai6 sing2 muk6", "You caught on so fast. That's sharp."),
      },
      {
        term: "扮嘢", jyutping: "baan6 je5", meaning: "Put on an act",
        note: "A teasing or critical way to call out a pose, an affected manner, or someone pretending.",
        keywords: ["pretend", "pose", "phony", "fake"],
        example: example("你明明識，唔好扮嘢啦。", "nei5 ming4 ming4 sik1 m4 hou2 baan6 je5 laa1", "You know how. Quit pretending."),
      },
      {
        term: "冇癮", jyutping: "mou5 jan5", meaning: "Be no fun",
        note: "Use it when something has lost its appeal or a letdown takes the fun out of it.",
        forms: ["冇瘾"], keywords: ["boring", "letdown", "dull", "lose interest"],
        example: example("得我一個玩，好冇癮。", "dak1 ngo5 jat1 go3 waan2 hou2 mou5 jan5", "It's no fun playing on my own."),
      },
      {
        term: "肉赤", jyutping: "juk6 cek3", meaning: "Wince at the cost",
        note: "A pang at spending money or seeing something precious go to waste.",
        keywords: ["expensive", "painful", "heartache", "money"],
        example: example("整部機用咗咁多錢，好肉赤。", "zing2 bou6 gei1 jung6 zo2 gam3 do1 cin2 hou2 juk6 cek3", "Spending that much on the repair really hurt."),
      },
      {
        term: "啱心水", jyutping: "ngaam1 sam1 seoi2", meaning: "Be just to your liking",
        infixes: pronouns,
        note: "Use it when a choice suits your personal taste particularly well.",
        keywords: ["favourite", "favorite", "taste", "preference"],
        example: example("呢隻色好啱我心水。", "ni1 zek3 sik1 hou2 ngaam1 ngo5 sam1 seoi2", "This colour is right up my street."),
      },
      {
        term: "老友鬼鬼", jyutping: "lou5 jau5 gwai2 gwai2", meaning: "Be very chummy",
        note: "Describes people acting like the closest of pals, sometimes with a hint of surprise at how well they get on.",
        keywords: ["pally", "close friends", "friendly"],
        example: example("佢哋一見面就老友鬼鬼。", "keoi5 dei6 jat1 gin3 min6 zau6 lou5 jau5 gwai2 gwai2", "They hit it off like old pals the moment they met."),
      },
    ],
    plans: [
      {
        term: "放飛機", jyutping: "fong3 fei1 gei1", meaning: "Stand someone up",
        infixes: pronouns,
        note: "Said when someone fails to turn up as agreed. The person left waiting can say they were stood up.",
        forms: ["放飞机"], keywords: ["no-show", "flake", "miss appointment", "bail"],
        example: example("你尋日放我飛機喎。", "nei5 cam4 jat6 fong3 ngo5 fei1 gei1 wo3", "Hey, you stood me up yesterday."),
      },
      {
        term: "鬆人", jyutping: "sung1 jan4", meaning: "Slip away",
        note: "A casual way to say you're making an exit, especially before things get awkward.",
        forms: ["松人"], keywords: ["leave", "depart", "take off", "escape"],
        example: example("趁未落雨，我哋鬆人啦。", "can3 mei6 lok6 jyu5 ngo5 dei6 sung1 jan4 laa1", "Let's head off before it rains."),
      },
      {
        term: "飛的", jyutping: "fei1 dik1", meaning: "Dash somewhere by taxi",
        note: "Use it when you're in a hurry and decide to hop in a cab.",
        forms: ["飞的"], keywords: ["cab", "taxi ride", "rush"],
        example: example("就嚟遲到，要飛的喇。", "zau6 lai4 ci4 dou3 jiu3 fei1 dik1 laa3", "We're running late. We'll have to grab a cab."),
      },
      {
        term: "打蛇餅", jyutping: "daa2 se4 beng2", meaning: "Form a winding queue",
        infixes: ["晒", "哂"],
        note: "Picture the line bending back on itself like a coiled snake.",
        forms: ["打蛇饼"], keywords: ["line up", "queue", "queuing", "queueing"],
        example: example("門口條人龍打晒蛇餅。", "mun4 hau2 tiu4 jan4 lung4 daa2 saai3 se4 beng2", "The queue outside winds back on itself."),
      },
      {
        term: "迫爆", jyutping: "bik1 baau3", meaning: "Be packed to bursting",
        note: "Describes somewhere so crowded you can barely squeeze in.",
        forms: ["逼爆"], keywords: ["crowded", "crammed", "rammed", "full"],
        example: example("九龍塘站個月台迫爆喇。", "gau2 lung4 tong4 zaam6 go3 jyut6 toi4 bik1 baau3 laa3", "The platform at Kowloon Tong station is packed."),
      },
      {
        term: "撐場", jyutping: "caang3 coeng4", meaning: "Turn up to show support",
        note: "Your presence helps a friend's event feel lively or gives the performer encouragement.",
        forms: ["撑场"], keywords: ["attend", "cheer", "support a friend"],
        example: example("你開檔，我一定嚟撐場。", "nei5 hoi1 dong3 ngo5 jat1 ding6 lai4 caang3 coeng4", "When you open your stall, I'll be there to support you."),
      },
      {
        term: "齊腳", jyutping: "cai4 goek3", meaning: "Have enough people to start",
        note: "The last spot has been filled, so the game or group activity can go ahead. Before a three-a-side match, 齊腳未？ (cai4 goek3 mei6) means “Have we got everyone yet?”",
        forms: ["齐脚"], keywords: ["full team", "enough players", "complete group", "three-a-side", "3v3"],
        example: example("三對三爭你一個，你嚟就齊腳。", "saam1 deoi3 saam1 zaang1 nei5 jat1 go3 nei5 lai4 zau6 cai4 goek3", "We're one short for three-a-side. Join us and we've got a full team."),
      },
      {
        term: "走寶", jyutping: "zau2 bou2", meaning: "Miss out on a gem",
        note: "Say it when a bargain or a particularly good opportunity slips past.",
        forms: ["走宝"], keywords: ["miss opportunity", "bargain", "overlook"],
        example: example("你冇去就真係走寶喇。", "nei5 mou5 heoi3 zau6 zan1 hai6 zau2 bou2 laa3", "You really missed out by skipping it."),
      },
    ],
    work: [
      {
        term: "搞掂", jyutping: "gaau2 dim6", meaning: "Get it sorted",
        note: "Use it for finishing a task or getting a problem under control. On its own it makes a brisk report that the job is done.",
        keywords: ["finish", "complete", "fix", "sort out", "done"],
        example: example("份報告搞掂，可以交喇。", "fan6 bou3 gou3 gaau2 dim6 ho2 ji5 gaau1 laa3", "The report's sorted. We can hand it in."),
      },
      {
        term: "執生", jyutping: "zap1 saang1", meaning: "Think on your feet",
        note: "Adapt to the situation as it unfolds, especially when the original plan falls through.",
        forms: ["执生"], keywords: ["improvise", "adapt", "wing it"],
        example: example("如果落雨，到時再執生。", "jyu4 gwo2 lok6 jyu5 dou3 si4 zoi3 zap1 saang1", "If it rains, we'll improvise when the time comes."),
      },
      {
        term: "蛇王", jyutping: "se4 wong4", meaning: "Skive off work",
        note: "Use it as a verb for slacking off on the job, or for the person who's always doing it.",
        keywords: ["slack off", "shirk", "loaf", "lazy"],
        example: example("做嘢嗰陣咪蛇王啦。", "zou6 je5 go2 zan6 mai5 se4 wong4 laa1", "Quit slacking off while you're working."),
      },
      {
        term: "開夜車", jyutping: "hoi1 je6 ce1", meaning: "Work late into the night",
        note: "A figurative night drive through a pile of studying or unfinished work.",
        forms: ["开夜车"], keywords: ["study late", "cram", "assignment deadline", "all-nighter"],
        example: example("浸大班同學今晚要開夜車趕功課。", "zam3 daai6 baan1 tung4 hok6 gam1 maan5 jiu3 hoi1 je6 ce1 gon2 gung1 fo3", "The HKBU students are working late tonight to finish an assignment."),
      },
      {
        term: "符碌", jyutping: "fu4 luk1", meaning: "Succeed by a fluke",
        note: "Downplay a lucky success of your own, or suggest that luck had a hand in someone else's.",
        forms: ["符轆", "符辘"], keywords: ["luck", "lucky break", "chance", "accident"],
        example: example("嗰球係符碌入嘅。", "go2 kau4 hai6 fu4 luk1 jap6 ge3", "That goal went in by pure luck."),
      },
      {
        term: "屈機", jyutping: "wat1 gei1", meaning: "Have an overpowering advantage",
        note: "Players say this when a move or a setup feels almost impossible to beat. Friends also use it to tease someone exceptionally skilled.",
        forms: ["屈机"], keywords: ["overpowered", "unfair", "gaming", "unbeatable"],
        example: example("你副牌鋪鋪都贏，太屈機喇。", "nei5 fu3 paai2 pou1 pou1 dou1 jeng4 taai3 wat1 gei1 laa3", "Your deck wins every round. That's ridiculously strong."),
      },
      {
        term: "出貓", jyutping: "ceot1 maau1", meaning: "Cheat in a test or game",
        note: "Often heard about someone peeking at answers or breaking the rules to win.",
        forms: ["出猫"], keywords: ["cheating", "exam", "copy answers"],
        example: example("估唔到就講，唔准出貓。", "gu2 m4 dou2 zau6 gong2 m4 zeon2 ceot1 maau1", "Say so if you can't guess. No cheating."),
      },
      {
        term: "拍住上", jyutping: "paak3 zyu6 soeng5", meaning: "Tackle something together",
        note: "Two people working side by side, each backing the other up.",
        keywords: ["team up", "collaborate", "work together", "partners"],
        example: example("今次我哋兩個拍住上。", "gam1 ci3 ngo5 dei6 loeng5 go3 paak3 zyu6 soeng5", "This time the two of us will tackle it together."),
      },
    ],
    food: [
      {
        term: "埋單", jyutping: "maai4 daan1", meaning: "Settle the bill",
        note: "A short, everyday way to ask for the bill at the end of a meal.",
        forms: ["埋单"], keywords: ["pay", "check please", "restaurant bill"],
        example: example("唔該，埋單。", "m4 goi1 maai4 daan1", "The bill, please."),
      },
      {
        term: "搭枱", jyutping: "daap3 toi2", meaning: "Share a table with strangers",
        note: "A server might ask this when there are empty seats at an occupied table.",
        forms: ["搭檯", "搭台"], keywords: ["communal seating", "restaurant", "share table"],
        example: example("得返兩個位，介唔介意搭枱？", "dak1 faan1 loeng5 go3 wai2 gaai3 m4 gaai3 ji3 daap3 toi2", "Only two seats left. Would you mind sharing a table?"),
      },
      {
        term: "夾錢", jyutping: "gaap3 cin2", meaning: "Chip in together",
        note: "Everyone contributes some money towards a shared cost or gift.",
        forms: ["夹钱"], keywords: ["split cost", "pool money", "contribute"],
        example: example("不如大家夾錢買份禮物。", "bat1 jyu4 daai6 gaa1 gaap3 cin2 maai5 fan6 lai5 mat6", "How about we all chip in for a present?"),
      },
      {
        term: "打邊爐", jyutping: "daa2 bin1 lou4", meaning: "Have hot pot",
        note: "Use it for a meal spent cooking ingredients together in a bubbling pot at the table.",
        forms: ["打边炉"], keywords: ["hotpot", "dinner", "shared meal"],
        example: example("天氣凍，今晚打邊爐啦。", "tin1 hei3 dung3 gam1 maan5 daa2 bin1 lou4 laa1", "It's cold. Let's have hot pot tonight."),
      },
      {
        term: "走青", jyutping: "zau2 ceng1", meaning: "Hold the green garnish",
        note: "An ordering shorthand for leaving off garnishes such as spring onion or coriander.",
        keywords: ["no scallions", "spring onion", "coriander", "cilantro", "order food"],
        example: example("碗麵唔該走青。", "wun2 min6 m4 goi1 zau2 ceng1", "No green garnish on my noodles, please."),
      },
      {
        term: "抵到爛", jyutping: "dai2 dou3 laan6", meaning: "Be an absolute steal",
        note: "An enthusiastic verdict on something that's exceptionally good value.",
        forms: ["抵到烂"], keywords: ["bargain", "cheap", "good deal", "inexpensive"],
        example: example("兩件都係十蚊，抵到爛。", "loeng5 gin6 dou1 hai6 sap6 man1 dai2 dou3 laan6", "Ten dollars for both. What a steal."),
      },
      {
        term: "中伏", jyutping: "zung3 fuk6", meaning: "Get stung by a bad deal",
        note: "Literally to fall into an ambush. Use it when a promising purchase or recommendation turns out badly.",
        keywords: ["trap", "rip-off", "disappointment", "bad buy"],
        example: example("張相好靚，買返嚟先知中伏。", "zoeng1 soeng2 hou2 leng3 maai5 faan1 lai4 sin1 zi1 zung3 fuk6", "The photo looked lovely. Only after buying it did I realise I'd been had."),
      },
      {
        term: "搭單", jyutping: "daap3 daan1", meaning: "Tag onto someone else's order",
        note: "Ask to add your own item to an order someone else is already placing.",
        forms: ["搭单"], keywords: ["piggyback", "add to order", "join an order"],
        example: example("你叫外賣呀？我想搭單。", "nei5 giu3 ngoi6 maai6 aa3 ngo5 soeng2 daap3 daan1", "Are you ordering takeaway? I'd like to add something."),
      },
    ],
  };

  const entries = Object.entries(groups).flatMap(([topic, records]) =>
    records.map(record => ({ forms: [], ...record, topic })),
  );
  return { topics, entries };
})();

if (typeof module === "object" && module.exports) module.exports = StreetLexicon;
